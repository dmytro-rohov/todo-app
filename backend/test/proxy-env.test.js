// Regression: the Mytko validation executor sets NODE_USE_ENV_PROXY and
// HTTP(S)_PROXY without NO_PROXY, which routed loopback test requests through
// the proxy (fetch: "Proxy response (403)", node:http: 405). support.js must
// keep test traffic to 127.0.0.1 direct.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CHILD = `
const http = require("node:http");
require(${JSON.stringify(path.join(__dirname, "support.js"))});
const app = http.createServer((req, res) => { res.setHeader("x-origin", "app"); res.end("ok"); });
app.listen(0, "127.0.0.1", async () => {
  const url = "http://127.0.0.1:" + app.address().port + "/api/tasks/1";
  const viaFetch = await fetch(url, { method: "DELETE" }).then(r => r.status + " " + r.headers.get("x-origin"), e => "error " + e.message);
  const viaHttp = await new Promise(resolve => {
    const req = http.request(url, { method: "DELETE" }, res => { res.resume(); resolve(res.statusCode + " " + res.headers["x-origin"]); });
    req.on("error", e => resolve("error " + e.message));
    req.end();
  });
  console.log(JSON.stringify({ viaFetch, viaHttp }));
  app.close();
  process.exit(0);
});
`;

test("loopback test traffic bypasses an inherited environment proxy", async () => {
  let proxied = 0;
  const proxy = http.createServer((req, res) => { proxied++; res.writeHead(405).end(); });
  proxy.on("connect", (req, socket) => { proxied++; socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const env = { PATH: process.env.PATH, NODE_USE_ENV_PROXY: "1", HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl };
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", CHILD], { env, stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", chunk => { out += chunk; });
      child.on("error", reject);
      child.on("exit", code => (code === 0 ? resolve(out) : reject(new Error(`child exited ${code}`))));
    });
    assert.deepEqual(JSON.parse(output), { viaFetch: "200 app", viaHttp: "200 app" });
    assert.equal(proxied, 0, "no loopback request reached the proxy");
  } finally {
    await new Promise(resolve => proxy.close(resolve));
  }
});
