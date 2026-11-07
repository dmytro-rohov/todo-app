// Member accounts against a real, disposable PostgreSQL: only the owner administers accounts; a member sees only
// their own data plus shared spaces; clients and calendars stay the owner's; passwords, disabling and deleting.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON } = require("./support");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);
const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;
const ANNA_PASSWORD = "anna-test-password-1";

describe("member accounts", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let ctx;
  let anna; // the member's session cookie

  before(async () => {
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
    await owner.query(`DROP TABLE IF EXISTS public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history,
      public.task_time_entries, public.task_subtasks, public.task_notes, public.task_labels, public.tasks, public.projects, public.spaces,
      public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: "tasks_app", log: () => {} });
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
  });

  after(async () => {
    await ctx.close();
    await appPool.end();
    await owner.end();
  });

  // The owner calls with HTTP Basic (support.js); a member with their session cookie.
  const call = async (url, method = "GET", body, cookie = null) => {
    const res = await ctx.request(url, { method, ...(cookie ? { auth: null } : {}),
      headers: { ...(method === "GET" ? {} : SAME_ORIGIN_JSON), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const as = cookie => (url, method, body) => call(url, method, body, cookie);
  const login = async (loginName, password) => {
    const res = await ctx.request("/api/auth/login", { method: "POST", auth: null, headers: SAME_ORIGIN_JSON, body: JSON.stringify({ login: loginName, password }) });
    return { status: res.status, cookie: (res.headers.get("set-cookie") || "").split(";")[0], body: await res.json() };
  };

  test("only the owner creates accounts; logins are validated and unique", async () => {
    assert.equal((await call("/api/users", "POST", { login: "owner", name: "X", password: ANNA_PASSWORD })).status, 400); // the owner's login
    assert.equal((await call("/api/users", "POST", { login: "Anna Ż", name: "Anna", password: ANNA_PASSWORD })).status, 400);
    assert.equal((await call("/api/users", "POST", { login: "anna", name: "Anna", password: "short" })).status, 400);
    const created = await call("/api/users", "POST", { login: "Anna", name: "Anna", password: ANNA_PASSWORD });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.login, created.body.name, created.body.disabledAt], ["anna", "Anna", null]);
    assert.equal(created.body.passwordHash, undefined);
    assert.equal((await call("/api/users", "POST", { login: "anna", name: "Druga", password: ANNA_PASSWORD })).status, 409);

    const signedIn = await login("anna", ANNA_PASSWORD);
    assert.equal(signedIn.status, 200);
    assert.deepEqual(signedIn.body.user, { role: "member", name: "Anna" });
    anna = signedIn.cookie;
    const session = await call("/api/auth/session", "GET", undefined, anna);
    assert.deepEqual([session.body.authenticated, session.body.login, session.body.user.role], [true, "anna", "member"]);
    // a member administers nothing and has no business tools
    for (const [url, method, body] of [["/api/users"], ["/api/users", "POST", { login: "ola", name: "Ola", password: ANNA_PASSWORD }],
      ["/api/users/1", "PATCH", { name: "Admin" }], ["/api/clients"], ["/api/calendar/accounts"]]) {
      assert.equal((await call(url, method, body, anna)).status, 403, `${method || "GET"} ${url}`);
    }
    assert.equal((await login("anna", "wrong-password-123")).status, 401);
  });

  test("a member sees only their own data; the owner's stays hidden and untouchable", async () => {
    const member = as(anna);
    const ownerSpaces = (await call("/api/spaces")).body;
    const work = ownerSpaces.find(s => s.key === "work");
    const ownerLabel = (await call("/api/categories", "POST", { name: "Klient", color: "#22c55e" })).body;
    const ownerTask = (await call("/api/tasks", "POST", { title: "Faktura klienta", date: "2026-11-07", spaceId: work.id })).body;
    await call(`/api/tasks/${ownerTask.id}/notes`, "POST", { body: "tajne" });

    const spaces = (await member("/api/spaces")).body;
    assert.deepEqual(spaces.map(s => [s.key, s.name, s.mine]), [["private", "Prywatne", true]]);
    assert.deepEqual((await member("/api/tasks")).body, []);
    assert.deepEqual((await member("/api/categories")).body, []);
    for (const url of [`/api/tasks/${ownerTask.id}/notes`, `/api/tasks/${ownerTask.id}/history`]) assert.equal((await member(url)).status, 404);
    assert.equal((await member(`/api/tasks/${ownerTask.id}`, "PATCH", { title: "Zmienione" })).status, 404);
    assert.equal((await member(`/api/tasks/${ownerTask.id}`, "DELETE")).status, 404);
    assert.equal((await member(`/api/spaces/${work.id}`, "PATCH", { name: "Moje" })).status, 404);
    assert.equal((await member(`/api/categories/${ownerLabel.id}`, "PUT", { name: "Inna", color: "#22c55e" })).status, 404);

    const mine = await member("/api/tasks", "POST", { title: "Kupić kwiaty", date: "2026-11-07" });
    assert.equal(mine.status, 201);
    assert.equal(mine.body.spaceId, spaces[0].id); // the member's private space
    for (const extra of [{ spaceId: work.id }, { labelIds: [ownerLabel.id] }, { clientId: 1 }]) {
      assert.equal((await member("/api/tasks", "POST", { title: "Próba", date: "2026-11-07", ...extra })).status, 400, JSON.stringify(extra));
    }
    assert.equal((await member(`/api/spaces/${spaces[0].id}`, "PATCH", { shared: true })).status, 400); // private spaces are never shared
    assert.equal((await member("/api/spaces", "POST", { name: "Agent", color: "#22c55e", agentVisible: true })).status, 400);
    // the owner does not see the member's private task either
    assert.ok(!(await call("/api/tasks")).body.some(t => t.id === mine.body.id));
    assert.equal((await call(`/api/tasks/${mine.body.id}`, "PATCH", { title: "Cudze zadanie" })).status, 404);
    const history = (await member(`/api/tasks/${mine.body.id}/history`)).body;
    assert.equal(history[0].actor, "user:anna");
  });

  test("a shared space is seen and edited by both; unsharing sends the member's tasks home", async () => {
    const member = as(anna);
    const dom = (await call("/api/spaces", "POST", { name: "Dom", color: "#38bdf8", shared: true })).body;
    assert.equal(dom.shared, true);
    const ownerTask = (await call("/api/tasks", "POST", { title: "Zapłacić czynsz", date: "2026-11-07", spaceId: dom.id })).body;
    const memberSpaces = (await member("/api/spaces")).body;
    assert.deepEqual(memberSpaces.find(s => s.id === dom.id) && [memberSpaces.find(s => s.id === dom.id).mine], [false]);
    assert.ok((await member("/api/tasks")).body.some(t => t.id === ownerTask.id));
    assert.equal((await member(`/api/tasks/${ownerTask.id}`, "PATCH", { status: "in_progress" })).status, 200);
    assert.equal((await member(`/api/spaces/${dom.id}`, "PATCH", { name: "Nasz dom" })).status, 404); // the space stays the owner's

    const label = (await member("/api/categories", "POST", { name: "Zakupy", color: "#f2c463" })).body;
    const shopping = (await member("/api/tasks", "POST", { title: "Zakupy na weekend", date: "2026-11-07", spaceId: dom.id, labelIds: [label.id] })).body;
    assert.ok((await call("/api/tasks")).body.some(t => t.id === shopping.id));
    const ownerLabels = (await call("/api/categories")).body;
    assert.deepEqual(ownerLabels.filter(l => l.id === label.id).map(l => [l.name, l.mine]), [["Zakupy", false]]);
    assert.equal((await call(`/api/categories/${label.id}`, "DELETE")).status, 404);
    assert.equal((await member(`/api/tasks/${shopping.id}/notes`, "POST", { body: "mleko" })).status, 201);
    assert.equal((await call(`/api/tasks/${shopping.id}/notes`)).body[0].body, "mleko");

    // the board token is the member's view; moving works and leaves hidden tasks in place
    const board = (await member("/api/tasks")).body;
    const canonical = JSON.stringify(board.map(t => [Number(t.id), t.status, Number(t.position)]).sort((a, b) => a[0] - b[0]));
    const expected = require("node:crypto").createHash("sha256").update(canonical).digest("hex");
    assert.equal((await member("/api/tasks/move", "POST", { id: shopping.id, status: "done", beforeId: null, expected })).status, 200);

    assert.equal((await call(`/api/spaces/${dom.id}`, "PATCH", { shared: false })).status, 200);
    assert.ok(!(await member("/api/spaces")).body.some(s => s.id === dom.id));
    const moved = (await member("/api/tasks")).body.find(t => t.id === shopping.id);
    assert.equal(moved.spaceId, (await member("/api/spaces")).body.find(s => s.key === "private").id);
    assert.ok(!(await member("/api/tasks")).body.some(t => t.id === ownerTask.id));
    assert.equal((await call("/api/tasks")).body.find(t => t.id === ownerTask.id).spaceId, dom.id);
  });

  test("a member changes their own password; the owner resets, disables and deletes accounts", async () => {
    const member = as(anna);
    assert.equal((await member("/api/auth/password", "POST", { current: "wrong-password-123", next: "anna-new-password-2" })).status, 400);
    assert.equal((await call("/api/auth/password", "POST", { current: "x", next: "anna-new-password-2" })).status, 401); // Basic is not a session
    const changed = await ctx.request("/api/auth/password", { method: "POST", auth: null, headers: { ...SAME_ORIGIN_JSON, cookie: anna },
      body: JSON.stringify({ current: ANNA_PASSWORD, next: "anna-new-password-2" }) });
    assert.equal(changed.status, 200);
    anna = changed.headers.get("set-cookie").split(";")[0];
    assert.equal((await login("anna", ANNA_PASSWORD)).status, 401);
    assert.equal((await login("anna", "anna-new-password-2")).status, 200);

    const id = (await call("/api/users")).body.find(u => u.login === "anna").id;
    assert.equal((await call(`/api/users/${id}`, "PATCH", { disabled: true })).status, 200);
    assert.equal((await as(anna)("/api/tasks")).status, 401);
    assert.equal((await login("anna", "anna-new-password-2")).status, 401);
    assert.equal((await call(`/api/users/${id}`, "PATCH", { disabled: false, password: "anna-reset-password-3" })).status, 200);
    const again = await login("anna", "anna-reset-password-3");
    assert.equal(again.status, 200);
    assert.equal((await call(`/api/users/${id}`, "PATCH", { login: "inna" })).status, 400);

    // deleting: the member's data goes, the owner's task in the member's shared space comes back to the owner
    const theirs = (await as(again.cookie)("/api/spaces", "POST", { name: "Wspólne Anny", color: "#e879f9", shared: true })).body;
    const ownerThere = (await call("/api/tasks", "POST", { title: "W jej przestrzeni", date: "2026-11-07", spaceId: theirs.id })).body;
    assert.equal((await call(`/api/users/${id}`, "DELETE")).status, 200);
    assert.equal((await as(again.cookie)("/api/tasks")).status, 401);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM tasks WHERE user_id IS NOT NULL")).rows[0].n, 0);
    const ownerPrivate = (await call("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await call("/api/tasks")).body.find(t => t.id === ownerThere.id).spaceId, ownerPrivate);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM spaces WHERE user_id IS NOT NULL")).rows[0].n, 0);
  });
});
