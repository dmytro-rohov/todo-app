const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startApp, fakePool, basic, AUTH, USERNAME, SAME_ORIGIN_JSON } = require("./support");

describe("health endpoints", () => {
  let ctx;
  before(async () => { ctx = await startApp({ pool: fakePool() }); });
  after(() => ctx.close());

  test("/healthz needs no auth and exposes only status", async () => {
    const res = await ctx.request("/healthz", { auth: null });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("/readyz is ok when every shipped migration is applied", async () => {
    const res = await ctx.request("/readyz", { auth: null });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

describe("readiness failures do not leak details", () => {
  test("database error -> 503 without message", async () => {
    const ctx = await startApp({
      pool: fakePool({
        schema_migrations: () => {
          throw new Error('password authentication failed for user "tasks_app" at db.secret.internal');
        }
      })
    });
    try {
      const res = await ctx.request("/readyz", { auth: null });
      assert.equal(res.status, 503);
      const body = await res.text();
      assert.deepEqual(JSON.parse(body), { status: "unavailable" });
      assert.doesNotMatch(body, /secret|tasks_app|password/);
    } finally {
      await ctx.close();
    }
  });

  test("pending migration -> 503", async () => {
    const ctx = await startApp({
      pool: fakePool(),
      migrationVersions: ["001_baseline", "002_task_integrity", "003_not_applied"]
    });
    try {
      const res = await ctx.request("/readyz", { auth: null });
      assert.equal(res.status, 503);
    } finally {
      await ctx.close();
    }
  });

  test("shutting down -> 503", async () => {
    const ctx = await startApp({ pool: fakePool() });
    try {
      ctx.instance.markShuttingDown();
      const res = await ctx.request("/readyz", { auth: null });
      assert.equal(res.status, 503);
    } finally {
      await ctx.close();
    }
  });
});

describe("authentication", () => {
  let ctx;
  before(async () => { ctx = await startApp({ pool: fakePool() }); });
  after(() => ctx.close());

  for (const path of ["/", "/index.html", "/js/main.js", "/api/tasks", "/api/categories"]) {
    test(`${path} requires credentials`, async () => {
      const res = await ctx.request(path, { auth: null });
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate"), /^Basic realm="Mytko Tasks"/);
    });
  }

  test("wrong password is rejected", async () => {
    const res = await ctx.request("/api/tasks", { auth: basic(USERNAME, "wrong password") });
    assert.equal(res.status, 401);
  });

  test("wrong username is rejected", async () => {
    const res = await ctx.request("/api/tasks", { auth: basic("intruder", "correct horse battery staple") });
    assert.equal(res.status, 401);
  });

  test("malformed header is rejected", async () => {
    const res = await ctx.request("/api/tasks", { auth: "Bearer abc" });
    assert.equal(res.status, 401);
  });

  test("correct credentials are accepted (and served from cache afterwards)", async () => {
    assert.equal((await ctx.request("/api/tasks")).status, 200);
    assert.equal((await ctx.request("/api/tasks")).status, 200);
    assert.equal((await ctx.request("/")).status, 200);
  });
});

describe("brute-force protection", () => {
  test("locks the client out after AUTH_FAIL_MAX failures, even with valid credentials", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { AUTH_FAIL_MAX: "3" } });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await ctx.request("/api/tasks", { auth: basic(USERNAME, `guess-${i}`) });
        assert.equal(res.status, 401);
      }
      const locked = await ctx.request("/api/tasks", { auth: AUTH });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("retry-after")) > 0);
    } finally {
      await ctx.close();
    }
  });

  test("general rate limit returns 429", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { RATE_LIMIT_MAX: "5" } });
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await ctx.request("/api/tasks")).status, 200);
      }
      assert.equal((await ctx.request("/api/tasks")).status, 429);
      // liveness stays reachable for the container healthcheck
      assert.equal((await ctx.request("/healthz", { auth: null })).status, 200);
    } finally {
      await ctx.close();
    }
  });
});

describe("secure headers", () => {
  let ctx;
  before(async () => { ctx = await startApp({ pool: fakePool() }); });
  after(() => ctx.close());

  test("HTML responses carry a strict CSP and hardening headers", async () => {
    const res = await ctx.request("/");
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.match(res.headers.get("strict-transport-security"), /max-age=\d+/);
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("API responses are not cached", async () => {
    const res = await ctx.request("/api/tasks");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("401 responses also carry security headers", async () => {
    const res = await ctx.request("/", { auth: null });
    assert.ok(res.headers.get("content-security-policy"));
  });
});

describe("CSRF protection", () => {
  let ctx;
  before(async () => { ctx = await startApp({ pool: fakePool() }); });
  after(() => ctx.close());

  const category = JSON.stringify({ name: "Praca", color: "#4e45e4" });

  test("same-origin JSON request is accepted", async () => {
    const res = await ctx.request("/api/categories", { method: "POST", headers: SAME_ORIGIN_JSON, body: category });
    assert.equal(res.status, 201);
  });

  test("cross-site fetch metadata is rejected", async () => {
    const res = await ctx.request("/api/categories", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: category
    });
    assert.equal(res.status, 403);
  });

  test("same-site (other subdomain) is rejected", async () => {
    const res = await ctx.request("/api/tasks/1", {
      method: "DELETE",
      headers: { "sec-fetch-site": "same-site" }
    });
    assert.equal(res.status, 403);
  });

  test("foreign Origin without fetch metadata is rejected", async () => {
    const res = await ctx.request("/api/tasks/1", {
      method: "DELETE",
      headers: { origin: "https://evil.example" }
    });
    assert.equal(res.status, 403);
  });

  test("form-encodable content types are rejected", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await ctx.request("/api/categories", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "content-type": type },
        body: category
      });
      assert.equal(res.status, 415, type);
    }
  });

  test("non-browser client without Origin/fetch metadata is allowed", async () => {
    // node:http so no Origin or Sec-Fetch-* header is added implicitly
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${ctx.url}/api/tasks/1`, {
        method: "DELETE",
        headers: { authorization: AUTH }
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 200);
  });
});

describe("input handling", () => {
  let ctx;
  let lastQuery;
  before(async () => {
    ctx = await startApp({
      pool: fakePool({
        "UPDATE tasks": () => ({ rows: [], rowCount: 0 }),
        "DELETE FROM categories": () => ({ rows: [], rowCount: 0 }),
        "INSERT INTO tasks": (sql, params) => {
          lastQuery = params;
          if (params[3] === 999) {
            const error = new Error("insert or update on table violates foreign key constraint");
            error.code = "23503";
            throw error;
          }
          return { rows: [{ id: 1 }], rowCount: 1 };
        },
        "FROM tasks": () => {
          throw new Error('relation "tasks" does not exist');
        }
      })
    });
  });
  after(() => ctx.close());

  const post = (path, body, headers = SAME_ORIGIN_JSON) =>
    ctx.request(path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("rejects category colors that could inject CSS", async () => {
    const res = await post("/api/categories", { name: "Praca", color: "red;background:url(//evil)" });
    assert.equal(res.status, 400);
  });

  test("rejects invalid task dates and types", async () => {
    assert.equal((await post("/api/tasks", { title: "Zadanie", date: "2026-02-30" })).status, 400);
    assert.equal((await post("/api/tasks", { title: "Zadanie", date: "'; DROP TABLE tasks;--" })).status, 400);
    assert.equal((await post("/api/tasks", { title: "Zadanie", date: "2026-10-30", completed: "yes" })).status, 400);
    assert.equal((await post("/api/tasks", { title: ["x"], date: "2026-10-30" })).status, 400);
    assert.equal((await post("/api/tasks", [1, 2])).status, 400);
  });

  test("normalizes a valid task (trimmed title, completed defaults to false)", async () => {
    const res = await post("/api/tasks", { title: "  Kupić mleko  ", date: "2026-10-30", categoryId: 2 });
    assert.equal(res.status, 201);
    assert.deepEqual(lastQuery, ["Kupić mleko", false, "2026-10-30", 2]);
  });

  test("unknown category -> 400 instead of 500", async () => {
    const res = await post("/api/tasks", { title: "Zadanie", date: "2026-10-30", categoryId: 999 });
    assert.equal(res.status, 400);
  });

  test("invalid ids -> 400, missing rows -> 404", async () => {
    const del = { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } };
    assert.equal((await ctx.request("/api/tasks/abc", del)).status, 400);
    assert.equal((await ctx.request("/api/tasks/99999999999", del)).status, 400);
    assert.equal((await ctx.request("/api/categories/5", del)).status, 404);
    const put = await ctx.request("/api/tasks/5", {
      method: "PUT",
      headers: SAME_ORIGIN_JSON,
      body: JSON.stringify({ title: "Zadanie", date: "2026-10-30", completed: true, categoryId: null })
    });
    assert.equal(put.status, 404);
  });

  test("PUT validates its body", async () => {
    const res = await ctx.request("/api/tasks/5", { method: "PUT", headers: SAME_ORIGIN_JSON, body: JSON.stringify({}) });
    assert.equal(res.status, 400);
  });

  test("malformed JSON -> 400, oversized body -> 413", async () => {
    assert.equal((await post("/api/categories", "{not json")).status, 400);
    const big = JSON.stringify({ name: "x".repeat(20000), color: "#000000" });
    assert.equal((await post("/api/categories", big)).status, 413);
  });

  test("server errors do not leak database messages", async () => {
    const res = await ctx.request("/api/tasks");
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.deepEqual(JSON.parse(body), { message: "Server error" });
    assert.doesNotMatch(body, /relation|stack|at /);
  });

  test("static server does not expose files outside the frontend", async () => {
    for (const path of ["/%2e%2e/backend/db.js", "/..%2fbackend%2fdb.js", "/backend/db.js", "/.env"]) {
      const res = await ctx.request(path);
      assert.notEqual(res.status, 200, path);
    }
  });
});
