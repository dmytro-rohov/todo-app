import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "sw.js"), "utf8");
const ORIGIN = "https://tasks.example";

// Runs sw.js against a fake server (`answer`) and a cache that already holds the app shell under "/".
function load(answer) {
  const listeners = {};
  const stored = new Map([["/", new Response("cached shell", { status: 200 })]]);
  const keyOf = key => (typeof key === "string" ? key : new URL(key.url).pathname);
  const cache = {
    match: async key => stored.get(keyOf(key)),
    put: async (key, response) => { stored.set(keyOf(key), response); },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting() {},
    clients: { claim: async () => undefined },
  };
  vm.runInNewContext(source, {
    self, URL, Response, console,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async () => answer(),
  });
  return async (path, mode) => {
    let reply;
    const waits = [];
    listeners.fetch({
      request: { url: ORIGIN + path, method: "GET", mode },
      respondWith: promise => { reply = promise; },
      waitUntil: promise => waits.push(promise),
    });
    const response = await reply;
    await Promise.all(waits);
    return { response, stored };
  };
}

const releasePage = () => new Response("release page", { status: 503, headers: { "X-Mytko-Maintenance": "release" } });

test("sw: a page load during a deploy shows the proxy's release page, not the cached shell", async () => {
  const { response } = await load(releasePage)("/", "navigate");
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "release page");
});

test("sw: a page load answered by any other 5xx still opens the cached shell", async () => {
  const { response } = await load(() => new Response("bad gateway", { status: 502 }))("/", "navigate");
  assert.equal(await response.text(), "cached shell");
});

test("sw: assets never take the release page; they fall back to the cache", async () => {
  await assert.rejects(load(releasePage)("/js/main.js", "no-cors"), /server unavailable/);
});

test("sw: a healthy page load is served and refreshes the cached shell; the release page is never cached", async () => {
  // a same-origin fetch gives a "basic" response; a Response built here is "default"
  const basic = () => Object.defineProperty(new Response("new shell", { status: 200 }), "type", { value: "basic" });
  const healthy = await load(basic)("/", "navigate");
  assert.equal(await healthy.response.text(), "new shell");
  assert.equal(await healthy.stored.get("/").text(), "new shell");
  const deploy = await load(releasePage)("/", "navigate");
  assert.equal(await deploy.stored.get("/").text(), "cached shell");
});
