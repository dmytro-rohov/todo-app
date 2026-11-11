// Tasks on Mytko Kit (backend/vendor/mytko-kit, a copy made by the kit's tools/sync.mjs, never edited here): the copy is
// exactly what the kit wrote; the kit is bound to Tasks (cookie, connection names, Tasks' scrypt parameters and migration
// lock); the owner's env names (ADMIN_* or the earlier AUTH_*); unknown logins cost what the owner's check costs; failed
// sign-ins and failed "Zaloguj kontem Mytko" exchanges are limited as in the other Mytko apps.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");

const { startApp, fakePool, USERNAME, PASSWORD, SAME_ORIGIN_JSON } = require("./support");
const kit = require("../kit");
const { loadConfig } = require("../config");
const { createUserStore } = require("../users");
const { parsePasswordHash, hashPassword } = require("../security");

test("the vendored Mytko Kit is exactly what the kit's sync wrote", async () => {
  const { checkVendored } = await import("../vendor/mytko-kit/kit-check.mjs");
  const { problems, manifest } = checkVendored(path.join(__dirname, "..", "vendor", "mytko-kit"));
  assert.deepEqual(problems, []);
  assert.equal(manifest.part, "backend");
  assert.equal(manifest.dirty, false, "synced from a kit tree with uncommitted changes");
});

test("the kit is bound to Mytko Tasks: cookie and connection names, p=1 hashes, its own migration lock", async () => {
  assert.equal(kit.app.id, "tasks");
  assert.deepEqual(kit.cookieSettings("https://tasks.mytko.dev"), { name: "__Host-mytko-tasks-session", secure: true });
  assert.deepEqual(kit.cookieSettings("http://localhost:3000"), { name: "mytko-tasks-session", secure: false });
  assert.equal(kit.loadDatabaseConfig({ DATABASE_URL: "postgres://a@127.0.0.1/x" }).applicationName, "mytko-tasks-dev");
  assert.match(await hashPassword("a long enough password"), /^scrypt:32768:8:1:/); // every Tasks hash so far is p=1
  // every shipped migration already applied: nothing to do but take Tasks' lock and give it back
  const shipped = kit.listMigrations(path.join(__dirname, "..", "drizzle"));
  const locks = [];
  const pool = {
    async connect() { return { query: (sql, params) => pool.query(sql, params), release() {} }; },
    async query(sql, params = []) {
      if (sql.includes("advisory")) locks.push(params[0]);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("to_regclass")) return { rows: [{ name: "drizzle.__drizzle_migrations" }] };
      if (sql.includes("SELECT hash, created_at")) return { rows: shipped.map(m => ({ hash: m.hash, created_at: m.when })) };
      return { rows: [] };
    }
  };
  assert.deepEqual(await kit.runMigrations(pool, { dir: path.join(__dirname, "..", "drizzle"), appRole: "", log: () => {} }), []);
  assert.deepEqual(locks, [7243917461, 7243917461]);
});

test("the owner's names: ADMIN_LOGIN / ADMIN_PASSWORD_HASH, else AUTH_USERNAME / AUTH_PASSWORD_HASH (production today)", async () => {
  const hash = await hashPassword("owner password 123", { N: 1024, r: 8, p: 1, keyLength: 32 });
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://app@db/tasks", PUBLIC_ORIGIN: "https://tasks.mytko.dev" };
  const today = loadConfig({ ...base, AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: hash });
  assert.deepEqual([today.auth.username, today.auth.passwordHash], ["operator", hash]);
  const renamed = loadConfig({ ...base, ADMIN_LOGIN: "operator", ADMIN_PASSWORD_HASH: hash });
  assert.deepEqual([renamed.auth.username, renamed.auth.passwordHash], ["operator", hash]);
  // both set: the new names win
  assert.equal(loadConfig({ ...base, ADMIN_LOGIN: "new", ADMIN_PASSWORD_HASH: hash, AUTH_USERNAME: "old", AUTH_PASSWORD_HASH: "plain" }).auth.username, "new");
  // the login is taken exactly as written (no lowercasing), as before
  assert.equal(loadConfig({ ...base, ADMIN_LOGIN: "Operator", ADMIN_PASSWORD_HASH: hash }).auth.username, "Operator");
  assert.throws(() => loadConfig(base), /ADMIN_LOGIN and ADMIN_PASSWORD_HASH \(or AUTH_USERNAME and AUTH_PASSWORD_HASH\) are required/);
  assert.throws(() => loadConfig({ ...base, ADMIN_LOGIN: "x".repeat(81), ADMIN_PASSWORD_HASH: hash }), /at most 80/);
  assert.equal(today.auth.sso, null);
  assert.equal(loadConfig({ ...base, AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: hash, MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev",
    MYTKO_SSO_CLIENT_SECRET: "s".repeat(32), MYTKO_SSO_LOGIN: "operator" }).auth.sso.clientId, "tasks");
});

test("an unknown login costs a check with the owner's scrypt parameters (a member's login costs its own hash)", async () => {
  const ownerHash = parsePasswordHash(await hashPassword("owner password 123", { N: 1024, r: 8, p: 1, keyLength: 28 }));
  const users = createUserStore({ query: async () => ({ rows: [] }) }, { dummyLike: ownerHash });
  const before = kit.dummyHashFor({ N: 1024, r: 8, p: 1, keyLength: 28 });
  assert.equal(await users.verify("nobody", "whatever password"), null);
  assert.equal(kit.dummyHashFor({ N: 1024, r: 8, p: 1, keyLength: 28 }), before); // the same dummy: no other parameters made
  assert.match(await before, /^scrypt:1024:8:1:/);
});

test("failed sign-ins lock a login out from anywhere (5 x AUTH_FAIL_MAX), not only one address", async () => {
  const ctx = await startApp({ pool: fakePool(), env: { AUTH_FAIL_MAX: "1", TRUST_PROXY: "loopback" } });
  try {
    const login = (password, ip) => ctx.request("/api/auth/login", { method: "POST", auth: null,
      headers: { ...SAME_ORIGIN_JSON, "x-forwarded-for": ip }, body: JSON.stringify({ login: USERNAME, password }) });
    for (let n = 1; n <= 5; n += 1) assert.equal((await login(`guess-${n}`, `198.51.100.${n}`)).status, 401);
    const locked = await login(PASSWORD, "203.0.113.7"); // a new address, the right password: this login waits
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  } finally {
    await ctx.close();
  }
});

test("Zaloguj kontem Mytko: failed code exchanges are limited (5 per 15 minutes), so Workflow's shared limit is never hit", async () => {
  const secret = "synthetic-client-secret-" + "s".repeat(24);
  const workflow = http.createServer((req, res) => {
    if (req.url === "/api/v1/health") return res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    req.resume();
    req.on("end", () => res.writeHead(400, { "content-type": "application/json" }).end('{"detail":"invalid_grant"}'));
  });
  await new Promise(resolve => workflow.listen(0, "127.0.0.1", resolve));
  const ctx = await startApp({ pool: fakePool(), env: { MYTKO_SSO_ORIGIN: `http://127.0.0.1:${workflow.address().port}`, MYTKO_SSO_CLIENT_SECRET: secret,
    MYTKO_SSO_LOGIN: "operator" } });
  try {
    const outcomes = [];
    for (let n = 0; n < 6; n += 1) {
      const start = await ctx.request("/auth/mytko/start", { auth: null, redirect: "manual" });
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      const cookie = start.headers.get("set-cookie").split(";")[0];
      const back = await ctx.request(`/auth/mytko/callback?code=${crypto.randomBytes(16).toString("hex")}&state=${state}`,
        { auth: null, redirect: "manual", headers: { cookie } });
      outcomes.push(back.headers.get("location"));
    }
    assert.deepEqual(outcomes, [...Array(5).fill("/?sso=failed"), "/?sso=unavailable"]);
  } finally {
    await ctx.close();
    await new Promise(resolve => workflow.close(resolve));
  }
});
