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

  test("health endpoints ignore credentials (wrong ones never yield 401)", async () => {
    for (const path of ["/healthz", "/readyz"]) {
      const res = await ctx.request(path, { auth: basic(USERNAME, "wrong") });
      assert.equal(res.status, 200, path);
    }
  });

  test("health paths do not unlock anything else", async () => {
    for (const path of ["/healthz/../api/tasks", "/healthz/x", "/readyz/x", "/api/healthz", "/api/readyz"]) {
      const res = await ctx.request(path, { auth: null });
      assert.notEqual(res.status, 200, path);
    }
  });
});

describe("healthcheck contract under brute force", () => {
  test("container/Caddy health checks keep working while the IP is locked out", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { AUTH_FAIL_MAX: "2" } });
    try {
      for (let i = 0; i < 2; i++) {
        await ctx.request("/api/tasks", { auth: basic(USERNAME, `guess-${i}`) });
      }
      assert.equal((await ctx.request("/api/tasks")).status, 429);
      assert.equal((await ctx.request("/healthz", { auth: null })).status, 200);
      assert.equal((await ctx.request("/readyz", { auth: null })).status, 200);
    } finally {
      await ctx.close();
    }
  });
});

describe("readiness failures do not leak details", () => {
  test("database error -> 503 without message", async () => {
    const ctx = await startApp({
      pool: fakePool({
        __drizzle_migrations: () => {
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

  for (const path of ["/api/tasks", "/api/categories", "/api/spaces", "/api/tasks/1/history"]) {
    test(`${path} requires a session or credentials`, async () => {
      const res = await ctx.request(path, { auth: null });
      assert.equal(res.status, 401);
      // no Basic challenge: the browser must show the app's login screen, not its own dialog
      assert.equal(res.headers.get("www-authenticate"), null);
    });
  }

  for (const path of ["/", "/index.html", "/js/main.js"]) {
    test(`${path} (app shell, no data) is public`, async () => {
      assert.equal((await ctx.request(path, { auth: null })).status, 200);
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
    const res = await ctx.request("/api/tasks", { auth: null });
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
        // labels the account can see: every id but 999
        "FROM categories c WHERE c.id = ANY": (sql, params) => ({ rows: [{ n: params[0].filter(id => id !== 999).length }], rowCount: 1 }),
        "INSERT INTO tasks": (sql, params) => {
          lastQuery = params;
          if (params[3] === 999) {
            const error = new Error("insert or update on table violates foreign key constraint");
            error.code = "23503";
            throw error;
          }
          return { rows: [{ id: 1 }], rowCount: 1 };
        },
        // the task just inserted (id 1) is read back; any other id does not exist
        "FROM tasks WHERE id": (sql, params) => (params[0] === 1 ? { rows: [{ id: 1, title: lastQuery[0] }], rowCount: 1 } : { rows: [], rowCount: 0 }),
        "FROM tasks WHERE archived_at": () => {
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
    // no space given and no built-in space in the fake database: the task is stored without one (= private)
    assert.deepEqual(lastQuery, ["Kupić mleko", false, "2026-10-30", 2, "", "todo", "P2", null, null, null, null, null, false, false, null, null, null]);
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


describe("proxy and IP rate-limit regressions", () => {
  test("direct clients cannot rotate X-Forwarded-For to bypass limits", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { TRUST_PROXY: "false", RATE_LIMIT_MAX: "2" } });
    try {
      for (const [i, expected] of [200, 200, 429].entries()) {
        assert.equal((await ctx.request("/api/tasks", { headers: { "x-forwarded-for": `198.51.100.${i + 1}` } })).status, expected);
      }
    } finally { await ctx.close(); }
  });

  test("trusted proxy chain uses nearest untrusted hop, not spoofed leftmost IP", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { TRUST_PROXY: "loopback", RATE_LIMIT_MAX: "2" } });
    try {
      for (const [i, expected] of [200, 200, 429].entries()) {
        assert.equal((await ctx.request("/api/tasks", {
          headers: { "x-forwarded-for": `203.0.113.${i + 1}, 198.51.100.9` }
        })).status, expected);
      }
      assert.equal((await ctx.request("/api/tasks", { headers: { "x-forwarded-for": "198.51.100.10" } })).status, 200);
    } finally { await ctx.close(); }
  });

  test("IPv4 and mapped IPv6 spellings share the rate-limit bucket", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { TRUST_PROXY: "loopback", RATE_LIMIT_MAX: "2" } });
    try {
      for (const [i, ip] of ["198.51.100.9", "::ffff:198.51.100.9", "::ffff:c633:6409"].entries()) {
        assert.equal((await ctx.request("/api/tasks", { headers: { "x-forwarded-for": ip } })).status, i < 2 ? 200 : 429);
      }
    } finally { await ctx.close(); }
  });

  test("mapped spellings and spoofed chain cannot bypass auth lockout", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { TRUST_PROXY: "loopback", AUTH_FAIL_MAX: "2" } });
    try {
      for (const ip of ["198.51.100.9", "::ffff:c633:6409"]) {
        assert.equal((await ctx.request("/api/tasks", {
          auth: basic(USERNAME, "incorrect"), headers: { "x-forwarded-for": ip }
        })).status, 401);
      }
      assert.equal((await ctx.request("/api/tasks", {
        headers: { "x-forwarded-for": "203.0.113.5, ::ffff:198.51.100.9" }
      })).status, 429);
    } finally { await ctx.close(); }
  });

  test("proxy-addr does not trust IPv4 peers through short IPv6 prefixes (GHSA-jqcg)", () => {
    const proxyaddr = require("proxy-addr");
    const req = { socket: { remoteAddress: "198.51.100.9" }, headers: { "x-forwarded-for": "203.0.113.99" } };
    for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
      assert.equal(proxyaddr(req, proxyaddr.compile(subnet)), "198.51.100.9", subnet);
    }
    const mapped = { socket: { remoteAddress: "::ffff:10.1.2.3" }, headers: req.headers };
    assert.equal(proxyaddr(mapped, proxyaddr.compile("::ffff:10.0.0.0/104")), "203.0.113.99");
    assert.equal(proxyaddr(req, proxyaddr.compile("::ffff:10.0.0.0/104")), "198.51.100.9");
  });
});

describe("body-size and decompression DoS regressions", () => {
  test("10 KiB boundary is enforced before any DB mutation", async () => {
    let inserts = 0;
    const ctx = await startApp({ pool: fakePool({ "INSERT INTO categories": () => {
      inserts++; return { rows: [{ id: 1 }], rowCount: 1 };
    } }) });
    try {
      const json = JSON.stringify({ name: "Praca", color: "#123456" });
      const exact = json + " ".repeat(10240 - Buffer.byteLength(json));
      assert.equal((await ctx.request("/api/categories", { method: "POST", headers: SAME_ORIGIN_JSON, body: exact })).status, 201);
      const large = await ctx.request("/api/categories", { method: "POST", headers: SAME_ORIGIN_JSON, body: exact + " " });
      assert.equal(large.status, 413);
      assert.deepEqual(await large.json(), { message: "Request body too large" });
      assert.equal(inserts, 1);
    } finally { await ctx.close(); }
  });

  test("chunked bodies cannot bypass the size limit without Content-Length", async () => {
    const ctx = await startApp({ pool: fakePool() });
    try {
      const code = await new Promise((resolve, reject) => {
        const req = http.request(ctx.url + "/api/categories", {
          method: "POST", headers: { authorization: AUTH, ...SAME_ORIGIN_JSON }
        }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject);
        req.write('{"name":"');
        for (let i = 0; i < 11; i++) req.write("x".repeat(1024));
        req.end('"}');
      });
      assert.equal(code, 413);
      assert.equal((await ctx.request("/healthz", { auth: null })).status, 200);
    } finally { await ctx.close(); }
  });

  test("compressed bodies including trailing garbage are rejected and process survives", async () => {
    const { gzipSync } = require("node:zlib");
    const ctx = await startApp({ pool: fakePool() });
    try {
      const gzip = gzipSync(Buffer.from('{"name":"Praca","color":"#123456"}'));
      for (const body of [gzip, Buffer.concat([gzip, Buffer.from("trailing garbage")]), gzipSync(Buffer.from("x".repeat(100000)))]) {
        const res = await ctx.request("/api/categories", {
          method: "POST", headers: { ...SAME_ORIGIN_JSON, "content-encoding": "gzip" }, body
        });
        assert.equal(res.status, 415);
      }
      assert.equal((await ctx.request("/healthz", { auth: null })).status, 200);
    } finally { await ctx.close(); }
  });

  test("oversized requests consume rate budget before body parsing", async () => {
    const ctx = await startApp({ pool: fakePool(), env: { RATE_LIMIT_MAX: "2" } });
    try {
      for (let i = 0; i < 2; i++) {
        assert.equal((await ctx.request("/api/categories", {
          method: "POST", headers: SAME_ORIGIN_JSON, body: "x".repeat(10241)
        })).status, 413);
      }
      assert.equal((await ctx.request("/api/tasks")).status, 429);
      assert.equal((await ctx.request("/healthz", { auth: null })).status, 200);
    } finally { await ctx.close(); }
  });
});

describe('TASKS-06 private surface', () => {
  let ctx;
  before(async()=>{ctx=await startApp({pool:fakePool()});});
  after(()=>ctx.close());
  for(const [method,path] of [['POST','/api/tasks/move'],['PATCH','/api/tasks/1'],['GET','/api/archive'],['GET','/api/attachments/1'],['GET','/api/export']]) {
    test(`anonymous ${method} ${path} is challenged before routing`,async()=>{
      const res=await ctx.request(path,{method,auth:null});
      assert.equal(res.status,401); assert.equal(res.headers.get('www-authenticate'),null);
      assert.equal(res.headers.get('cache-control'),'no-store');
      assert.equal(res.headers.get('set-cookie'),null);
    });
  }
  test('contradictory same-origin metadata cannot override foreign Origin',async()=>{
    const res=await ctx.request('/api/tasks/1',{method:'DELETE',headers:{'sec-fetch-site':'same-origin',origin:'https://evil.example'}});
    assert.equal(res.status,403);
  });
  test('CORS preflight does not grant foreign access',async()=>{
    const res=await ctx.request('/api/tasks',{method:'OPTIONS',headers:{origin:'https://evil.example','access-control-request-method':'POST'}});
    assert.equal(res.headers.get('access-control-allow-origin'),null);
  });
});


describe("PATCH task contract", () => {
  test("returns the same camelCase task shape as reads and persists status/order", async () => {
    const returned = { id: 7, title: "Updated", completed: true, date: "2026-10-31", categoryId: null, description: "Details", status: "done", priority: "P1", position: 2, dueDate: null, createdAt: "2026-10-31T00:00:00.000Z", updatedAt: "2026-10-31T01:00:00.000Z", completedAt: "2026-10-31T01:00:00.000Z", archivedAt: null, spaceId: 2, projectId: null, assigneeId: null, reviewRequestedAt: null, plannedAt: null, clientId: null, meetingId: null, labelIds: [], subtaskCount: 0, subtaskDoneCount: 0, noteCount: 0, trackedSeconds: 0, timerStartedAt: null };
    const before = { ...returned, status: "todo", completed: false, completedAt: null, position: 0 };
    let params;
    let reads = 0;
    const history = [];
    const ctx = await startApp({ pool: fakePool({
      "UPDATE tasks SET": (sql, values) => { params = values; return { rows: [], rowCount: 1 }; },
      "INSERT INTO task_history": (sql, values) => { history.push(values); return { rows: [], rowCount: 2 }; },
      "FROM tasks t WHERE t.id": () => ({ rows: [{}], rowCount: 1 }), // the owner sees the task
      "FROM tasks WHERE id": () => ({ rows: [reads++ === 0 ? before : returned], rowCount: 1 })
    }) });
    try {
      const res = await ctx.request("/api/tasks/7", { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ status: "done", position: 2 }) });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), returned);
      assert.deepEqual(params, [2, "done", 7]);
      assert.deepEqual(history, [[7, ["status"], ["todo"], ["done"], "owner"]]); // position is not history
    } finally { await ctx.close(); }
  });

  test("uses the creation title limit for partial updates", async () => {
    const ctx = await startApp({ pool: fakePool() });
    try {
      const res = await ctx.request("/api/tasks/7", { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ title: "x".repeat(101) }) });
      assert.equal(res.status, 400);
    } finally { await ctx.close(); }
  });
});

describe("login screen API", () => {
  let ctx;
  before(async () => { ctx = await startApp({ pool: fakePool(), env: { AUTH_FAIL_MAX: "3" } }); });
  after(() => ctx.close());
  const login = (body, headers = SAME_ORIGIN_JSON) =>
    ctx.request("/api/auth/login", { method: "POST", auth: null, headers, body: JSON.stringify(body) });

  test("session state is readable anonymously and reveals nothing", async () => {
    const res = await ctx.request("/api/auth/session", { auth: null });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { authenticated: false, login: null, method: null, expiresAt: null, ttlSeconds: 604800, user: null, mytkoLogin: false, mytkoAvailable: false });
  });

  test("a correct login sets a host-only, HttpOnly, Secure, SameSite=Strict session cookie", async () => {
    const res = await login({ login: USERNAME, password: "correct horse battery staple" });
    assert.equal(res.status, 200);
    assert.deepEqual((({ authenticated, login: name, method }) => ({ authenticated, name, method }))(await res.json()),
      { authenticated: true, name: USERNAME, method: "password" });
    const cookie = res.headers.get("set-cookie");
    assert.match(cookie, /^__Host-mytko-tasks-session=[A-Za-z0-9_-]{43};/);
    for (const attribute of [/; Path=\//, /; HttpOnly/, /; Secure/, /; SameSite=Strict/, /; Expires=/]) assert.match(cookie, attribute);
    assert.doesNotMatch(cookie, /Domain=/i);
  });

  test("bad input, cross-site requests and wrong passwords are refused; failures lock the client out", async () => {
    assert.equal((await login({ login: USERNAME })).status, 400);
    assert.equal((await login({ login: USERNAME, password: "x" }, { ...SAME_ORIGIN_JSON, "sec-fetch-site": "cross-site" })).status, 403);
    for (let i = 0; i < 3; i++) assert.equal((await login({ login: USERNAME, password: `guess-${i}` })).status, 401);
    const locked = await login({ login: USERNAME, password: "correct horse battery staple" });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  });

  test("logout clears the cookie", async () => {
    const res = await ctx.request("/api/auth/logout", { method: "POST", auth: null, headers: SAME_ORIGIN_JSON, body: "{}" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie"), /^__Host-mytko-tasks-session=;.*Expires=Thu, 01 Jan 1970/);
  });
});
