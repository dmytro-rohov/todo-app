// "Zaloguj kontem Mytko" against a fake Mytko Workflow token endpoint on loopback.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");

const { startApp, fakePool } = require("./support");
const { loadConfig } = require("../config");

const SECRET = "synthetic-client-secret-" + "s".repeat(24);

function fakeWorkflow() {
  const calls = [];
  const state = { status: 200, login: "operator", challenge: null, used: new Set(), down: false };
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v1/health") {
      res.writeHead(state.down ? 502 : 200, { "content-type": "application/json" });
      return res.end(state.down ? "" : '{"status":"ok"}');
    }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      calls.push({ path: req.url, headers: req.headers, data });
      const challenge = crypto.createHash("sha256").update(data.code_verifier || "").digest("base64url");
      // Codes are one-time, as in Workflow.
      const valid = state.status === 200 && data.client_secret === SECRET && data.code === "the-code-0123456789" &&
        challenge === state.challenge && !state.used.has(challenge);
      if (valid) state.used.add(challenge);
      res.writeHead(valid ? 200 : state.status === 200 ? 400 : state.status, { "content-type": "application/json" });
      res.end(JSON.stringify(valid ? { login: state.login } : { detail: "invalid_grant" }));
    });
  });
  return { server, calls, state };
}

describe("Zaloguj kontem Mytko", () => {
  let workflow;
  let origin;
  before(async () => {
    workflow = fakeWorkflow();
    await new Promise(resolve => workflow.server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${workflow.server.address().port}`;
  });
  after(() => new Promise(resolve => workflow.server.close(resolve)));

  const withApp = async (env, check) => {
    const ctx = await startApp({ pool: fakePool(), env: { MYTKO_SSO_ORIGIN: origin, MYTKO_SSO_CLIENT_SECRET: SECRET, MYTKO_SSO_LOGIN: "operator", ...env } });
    try { await check(ctx); } finally { await ctx.close(); }
  };
  const get = (ctx, path, cookie) => ctx.request(path, { auth: null, redirect: "manual", headers: cookie ? { cookie } : {} });

  async function begin(ctx) {
    const start = await get(ctx, "/auth/mytko/start");
    assert.equal(start.status, 303);
    const location = new URL(start.headers.get("location"));
    const pending = start.headers.get("set-cookie");
    workflow.state.challenge = location.searchParams.get("code_challenge");
    return { location, pending, cookie: pending.split(";")[0] };
  }

  test("start sends the browser to Workflow with an exact redirect, state and an S256 challenge", async () => {
    await withApp({}, async ctx => {
      const { location, pending } = await begin(ctx);
      assert.equal(`${location.origin}${location.pathname}`, `${origin}/api/v1/auth/sso/authorize`);
      assert.equal(location.searchParams.get("client_id"), "tasks");
      assert.equal(location.searchParams.get("redirect_uri"), "https://task.mytko.dev/auth/mytko/callback");
      assert.equal(location.searchParams.get("code_challenge_method"), "S256");
      assert.match(location.searchParams.get("state"), /^[A-Za-z0-9_-]{32}$/);
      assert.match(pending, /^__Host-mytko-tasks-sso=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
      for (const attribute of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\//]) assert.match(pending, attribute);
      const session = await (await ctx.request("/api/auth/session", { auth: null })).json();
      assert.deepEqual([session.mytkoLogin, session.mytkoAvailable], [true, true]);
    });
  });

  test("a valid code becomes a Mytko session after a server-to-server exchange", async () => {
    await withApp({}, async ctx => {
      const { location, cookie } = await begin(ctx);
      const state = location.searchParams.get("state");
      const back = await get(ctx, `/auth/mytko/callback?code=the-code-0123456789&state=${state}`, cookie);
      assert.equal(back.status, 303);
      assert.equal(back.headers.get("location"), "/");
      assert.match(back.headers.get("set-cookie"), /__Host-mytko-tasks-session=[A-Za-z0-9_-]{43};/);
      // Replaying the same callback (same pending cookie, same code) does not sign in again.
      const replay = await get(ctx, `/auth/mytko/callback?code=the-code-0123456789&state=${state}`, cookie);
      assert.equal(replay.headers.get("location"), "/?sso=failed");
      const exchange = workflow.calls.at(-2);
      assert.equal(exchange.path, "/api/v1/auth/sso/token");
      assert.equal(exchange.headers.origin, undefined);
      assert.equal(exchange.data.redirect_uri, "https://task.mytko.dev/auth/mytko/callback");
    });
  });

  test("every failure ends on the login screen with a reason and no session", async () => {
    await withApp({}, async ctx => {
      const expect = async (path, cookie, reason) => {
        const res = await get(ctx, path, cookie);
        assert.equal(res.headers.get("location"), `/?sso=${reason}`, path);
        assert.doesNotMatch(res.headers.get("set-cookie") || "", /mytko-tasks-session=[A-Za-z0-9]/);
      };
      let { location, cookie } = await begin(ctx);
      const state = location.searchParams.get("state");
      await expect(`/auth/mytko/callback?code=the-code-0123456789&state=${state}`, null, "failed"); // no pending cookie
      await expect(`/auth/mytko/callback?code=the-code-0123456789&state=${"x".repeat(32)}`, cookie, "failed");
      await expect(`/auth/mytko/callback?error=login_required&state=${state}`, cookie, "login_required");
      await expect(`/auth/mytko/callback?error=access_denied&state=${state}`, cookie, "failed");
      await expect(`/auth/mytko/callback?code=wrong-code-0123456789&state=${state}`, cookie, "failed");
      ({ location, cookie } = await begin(ctx));
      workflow.state.status = 503;
      await expect(`/auth/mytko/callback?code=the-code-0123456789&state=${location.searchParams.get("state")}`, cookie, "unavailable");
      workflow.state.status = 200;
    });
    await withApp({ MYTKO_SSO_LOGIN: "someone-else" }, async ctx => {
      const { location, cookie } = await begin(ctx);
      const res = await get(ctx, `/auth/mytko/callback?code=the-code-0123456789&state=${location.searchParams.get("state")}`, cookie);
      assert.equal(res.headers.get("location"), "/?sso=denied");
    });
    await withApp({ MYTKO_SSO_ORIGIN: "http://127.0.0.1:1" }, async ctx => {
      assert.equal((await get(ctx, "/auth/mytko/start")).headers.get("location"), "/?sso=unavailable");
    });
  });

  test("when Workflow is down nobody is sent there: the button is off and start returns to the login screen", async () => {
    workflow.state.down = true;
    try {
      await withApp({}, async ctx => {
        const session = await (await ctx.request("/api/auth/session", { auth: null })).json();
        assert.deepEqual([session.mytkoLogin, session.mytkoAvailable], [true, false]);
        const start = await get(ctx, "/auth/mytko/start");
        assert.deepEqual([start.status, start.headers.get("location")], [303, "/?sso=unavailable"]);
      });
    } finally { workflow.state.down = false; }
  });

  test("without configuration the feature does not exist", async () => {
    const ctx = await startApp({ pool: fakePool() });
    try {
      assert.equal((await get(ctx, "/auth/mytko/start")).status, 404);
      assert.equal((await (await ctx.request("/api/auth/session", { auth: null })).json()).mytkoLogin, false);
    } finally { await ctx.close(); }
  });

  test("configuration is validated", () => {
    const base = { NODE_ENV: "development", DATABASE_URL: "postgres://x@127.0.0.1/x", AUTH_DISABLED: "true" };
    assert.throws(() => loadConfig({ ...base, MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev" }), /set together/);
    assert.throws(() => loadConfig({ ...base, MYTKO_SSO_ORIGIN: "http://workflow.mytko.dev", MYTKO_SSO_CLIENT_SECRET: SECRET }), /https origin/);
    assert.throws(() => loadConfig({ ...base, MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev", MYTKO_SSO_CLIENT_SECRET: "short" }), /32 characters/);
    // Workflow can have several operators: the one let in must be named.
    assert.throws(() => loadConfig({ ...base, MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev", MYTKO_SSO_CLIENT_SECRET: SECRET }), /MYTKO_SSO_LOGIN/);
    assert.equal(loadConfig({ ...base, MYTKO_SSO_ORIGIN: "https://workflow.mytko.dev", MYTKO_SSO_CLIENT_SECRET: SECRET, MYTKO_SSO_LOGIN: "operator" }).auth.sso.clientId, "tasks");
    assert.throws(() => loadConfig({ ...base, AUTH_USERNAME: "x".repeat(81) }), /at most 80/);
  });
});
