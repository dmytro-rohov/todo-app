// The request limit counts the dynamic routes only (kit.limitDynamicRoutes on /api and /auth, RATE_LIMIT_MAX a minute
// per address): every route of the app — listed by the kit's testing.recordRoutes as the app is built, with every
// optional part on (Workflow agent, calendars, booking, "Zaloguj kontem Mytko", mail, AI) — answers 429 once the limit is
// used up, apart from liveness (/healthz); readiness (/readyz, it asks the database) stays limited as before. The app
// shell, its modules and index.html never count. A new route outside /api and /auth makes this fail.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createApp } = require("../app");
const { loadConfig } = require("../config");
const { LIMITED_PATHS } = require("../kit");
const { recordRoutes, samplePath } = require("../vendor/mytko-kit/testing");
const { startApp, fakePool, passwordHashPromise, USERNAME, ORIGIN, MIGRATIONS } = require("./support");

const ENV = {
  RATE_LIMIT_MAX: "3",
  WORKFLOW_TOKEN_SHA256: "a".repeat(64),
  GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TASKS_SECRET_KEY: crypto.randomBytes(32).toString("base64"),
  BOOKING_ORIGINS: "https://mytko.dev",
  MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev", MYTKO_SSO_CLIENT_SECRET: "s".repeat(40), MYTKO_SSO_LOGIN: "operator",
  MAIL_IMAP_HOST: "127.0.0.1", MAIL_IMAP_USER: "hello@mytko.dev", MAIL_IMAP_PASSWORD: "imap-test-only",
  AI_API_KEY: "test"
};
// a mailbox that is never opened (the mail sync's first run is far away and the app is stopped before it)
const APP_OPTIONS = { mailSource: { async fetch() { return []; } }, mailFirstRunMs: 3600000 };
// Outside /api and /auth: the health checks only. Not limited on purpose: liveness (the proxy's and the container's
// probes); readiness is limited (mounted with the dynamic paths).
const OUTSIDE = ["get /healthz", "get /readyz"];
const UNLIMITED = ["get /healthz"];
// What a page load fetches: never counted.
const STATIC = ["/", "/index.html", "/privacy.html", "/js/main.js", "/js/i18n.js", "/vendor/mytko-kit/js/core.js", "/vendor/mytko-kit/locales/texts.js",
  "/vendor/mytko-kit/js/sw-core.js", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"];

const under = path => LIMITED_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

test("every route of the app outside the health checks is under /api or /auth, and every one but liveness answers 429 once the limit is used up", async () => {
  const config = loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://unused@127.0.0.1/unused", AUTH_USERNAME: USERNAME,
    AUTH_PASSWORD_HASH: await passwordHashPromise, PUBLIC_ORIGIN: ORIGIN, ...ENV });
  const { result, routes } = await recordRoutes(() => createApp({ config, pool: fakePool(), migrationVersions: MIGRATIONS, ...APP_OPTIONS }));
  result.stop();
  assert.ok(routes.length > 100, `${routes.length} routes`);
  assert.deepEqual(routes.filter(r => !under(r.path)).map(r => `${r.method} ${r.path}`).sort(), OUTSIDE);
  for (const prefix of ["/api/auth/", "/api/tasks", "/api/agent/", "/api/public/booking", "/api/mail", "/api/calendar", "/auth/google", "/auth/mytko/"]) {
    assert.ok(routes.some(r => r.path.startsWith(prefix)), `a route under ${prefix}`);
  }

  const ctx = await startApp({ pool: fakePool(), env: ENV, appOptions: APP_OPTIONS });
  try {
    for (let i = 0; i < 3; i++) assert.notEqual((await ctx.request("/api/auth/session", { auth: null })).status, 429);
    const answers = [];
    for (const { method, path } of routes) {
      const verb = method === "all" ? "GET" : method.toUpperCase();
      const res = await ctx.request(samplePath(path), { method: verb, auth: null, redirect: "manual" });
      answers.push(`${verb} ${path} ${res.status === 429 ? 429 : "free"}`);
      assert.equal(res.status === 429, !UNLIMITED.includes(`${method} ${path}`), `${verb} ${path} -> ${res.status}`);
    }
    console.log(`limited: ${answers.filter(a => a.endsWith(" 429")).length} routes; free: ${answers.filter(a => a.endsWith(" free")).join(", ")}`);
    for (const path of STATIC) assert.equal((await ctx.request(path, { auth: null })).status, 200, path);
  } finally {
    await ctx.close();
  }
});

test("a page load uses none of the limit: after many static files every API request is still free", async () => {
  const ctx = await startApp({ pool: fakePool(), env: { RATE_LIMIT_MAX: "3" } });
  try {
    for (let i = 0; i < 4; i++) for (const path of STATIC) assert.equal((await ctx.request(path, { auth: null })).status, 200, path);
    for (let i = 0; i < 3; i++) assert.notEqual((await ctx.request("/api/auth/session", { auth: null })).status, 429);
    assert.equal((await ctx.request("/api/auth/session", { auth: null })).status, 429);
  } finally {
    await ctx.close();
  }
});
