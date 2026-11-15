// Member accounts against a real, disposable PostgreSQL: only the owner administers accounts; a member sees only
// their own data plus shared spaces; clients and calendars stay the owner's; passwords, disabling and deleting.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createPool } = require("../kit");
const { runMigrations, listMigrations } = require("../kit");
const { startApp, SAME_ORIGIN_JSON, USERNAME, PASSWORD } = require("./support");

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
    await owner.query(`DROP TABLE IF EXISTS public.push_log, public.push_subscriptions, public.avatars, public.space_invites, public.space_members, public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history,
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

  test("Cele / Marzenia: each account has its own lists per month and year; done items stay; order and look back", async () => {
    const member = as(anna);
    const december = { year: 2026, month: 12 };
    const add = (who, body) => who("/api/goals", "POST", { ...december, ...body });
    const first = await add(call, { title: "Przebiec 50 km", description: "po 5 km dwa razy w tygodniu", deadline: "2026-12-31" });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.year, first.body.month, first.body.kind, first.body.deadline, first.body.doneAt], [2026, 12, "goal", "2026-12-31", null]);
    const dream = (await add(call, { title: "Zobaczyć zorzę polarną", kind: "dream" })).body;
    const third = (await add(call, { title: "Przeczytać 2 książki" })).body;
    const year = (await call("/api/goals", "POST", { year: 2026, title: "Nowa strona studia" })).body;
    assert.equal(year.month, null);

    // the month and the year are separate lists, in the order added
    assert.deepEqual((await call("/api/goals?year=2026&month=12")).body.map(g => g.title), ["Przebiec 50 km", "Zobaczyć zorzę polarną", "Przeczytać 2 książki"]);
    assert.deepEqual((await call("/api/goals?year=2026")).body.map(g => g.title), ["Nowa strona studia"]);

    // invalid input
    for (const body of [{ title: "" }, { title: "x".repeat(161) }, { title: "Ok", kind: "wish" }, { title: "Ok", deadline: "31.12.2026" }, { title: "Ok", month: 13 }, { title: "Ok", year: 1999 }]) {
      assert.equal((await add(call, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("/api/goals?year=abc")).status, 400);

    // done: crossed out but kept; undone again
    const done = await call(`/api/goals/${first.body.id}`, "PATCH", { done: true });
    assert.ok(done.body.doneAt);
    const again = await call(`/api/goals/${first.body.id}`, "PATCH", { done: true, kind: "dream" });
    assert.equal(again.body.doneAt, done.body.doneAt); // stays the first time it was done
    assert.equal(again.body.kind, "dream");
    assert.equal((await call(`/api/goals/${third.id}`, "PATCH", { done: true })).status, 200);
    assert.equal((await call(`/api/goals/${third.id}`, "PATCH", { done: false })).body.doneAt, null);

    // reorder within the list: every id, top to bottom; a stale or foreign list is refused
    const order = [third.id, first.body.id, dream.id];
    assert.deepEqual((await call("/api/goals/order", "PUT", { ...december, ids: order })).body.map(g => g.id), order);
    assert.equal((await call("/api/goals/order", "PUT", { ...december, ids: [third.id, first.body.id] })).status, 409);
    assert.equal((await call("/api/goals/order", "PUT", { ...december, ids: [third.id, first.body.id, year.id] })).status, 409);
    assert.equal((await call("/api/goals/order", "PUT", { ...december, ids: [third.id, third.id, dream.id] })).status, 400);
    assert.equal((await call("/api/goals/order", "PUT", { ...december, ids: [third.id, String(third.id), dream.id] })).status, 400);

    // looking back: per period, how much was done
    assert.deepEqual((await call("/api/goals/periods")).body,
      [{ year: 2026, month: null, total: 1, done: 0, dreams: 0, dreamsDone: 0 }, { year: 2026, month: 12, total: 3, done: 1, dreams: 2, dreamsDone: 1 }]);

    // a member has their own lists and cannot see or touch the owner's
    assert.deepEqual((await member("/api/goals?year=2026&month=12")).body, []);
    assert.deepEqual((await member("/api/goals/periods")).body, []);
    for (const [url, method, body] of [[`/api/goals/${first.body.id}`, "PATCH", { title: "Moje" }], [`/api/goals/${first.body.id}`, "DELETE"]]) {
      assert.equal((await member(url, method, body)).status, 404);
    }
    assert.equal((await member("/api/goals/order", "PUT", { ...december, ids: order })).status, 409);
    const hers = await add(member, { title: "Kurs ceramiki", kind: "dream" });
    assert.equal(hers.status, 201);
    assert.deepEqual((await call("/api/goals?year=2026&month=12")).body.map(g => g.id), order);
    assert.equal((await call(`/api/goals/${hers.body.id}`, "DELETE")).status, 404);

    assert.equal((await call(`/api/goals/${dream.id}`, "DELETE")).status, 200);
    assert.deepEqual((await call("/api/goals?year=2026&month=12")).body.map(g => g.id), [third.id, first.body.id]);
  });

  test("a shared space is seen and edited by both; unsharing sends the member's tasks home", async () => {
    const member = as(anna);
    const annaId = (await call("/api/users")).body.find(u => u.login === "anna").id;
    // only the owner puts accounts in, only into a shared space
    assert.equal((await call("/api/spaces", "POST", { name: "Dom", color: "#38bdf8", memberIds: [annaId] })).status, 400);
    assert.equal((await member("/api/spaces", "POST", { name: "Jej", color: "#38bdf8", shared: true, memberIds: [annaId] })).status, 400);
    assert.equal((await call("/api/spaces", "POST", { name: "Dom", color: "#38bdf8", shared: true, memberIds: [999999] })).status, 400);
    const dom = (await call("/api/spaces", "POST", { name: "Dom", color: "#38bdf8", shared: true, memberIds: [annaId] })).body;
    assert.deepEqual([dom.shared, dom.people], [true, 2]);
    // a shared space with nobody else in it stays the owner's alone
    const alone = (await call("/api/spaces", "POST", { name: "Tylko moja wspólna", color: "#38bdf8", shared: true })).body;
    assert.ok(!(await member("/api/spaces")).body.some(s => s.id === alone.id));
    assert.equal((await member(`/api/spaces/${alone.id}/members`)).status, 404);
    const members = (await member(`/api/spaces/${dom.id}/members`)).body;
    assert.deepEqual(members.map(m => [m.id, m.name, m.creator, m.me]), [[null, null, true, false], [annaId, "Anna", false, true]]);
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

    // nobody moves someone else's task out of its creator's sight; a project does not drag other accounts' tasks along
    const annaPrivate = (await member("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await member(`/api/tasks/${ownerTask.id}`, "PATCH", { spaceId: annaPrivate })).status, 400);
    const domProject = (await member("/api/projects", "POST", { name: "Remont", color: "#38bdf8", spaceId: dom.id })).body;
    const ownerInProject = (await call("/api/tasks", "POST", { title: "Zamówić farbę", date: "2026-11-07", projectId: domProject.id })).body;
    assert.equal((await member(`/api/tasks/${ownerInProject.id}`, "PATCH", { projectId: null, spaceId: annaPrivate })).status, 400);
    assert.equal((await member(`/api/projects/${domProject.id}`, "PATCH", { spaceId: annaPrivate })).status, 200);
    const ownerPrivateId = (await call("/api/spaces")).body.find(s => s.key === "private").id;
    const farba = (await call("/api/tasks")).body.find(t => t.id === ownerInProject.id);
    assert.deepEqual([farba.spaceId, farba.projectId], [ownerPrivateId, null]); // back with its creator, without the project

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

    // the session cap is per account: a member signing in many times never signs the owner out
    const ownerLogin = await login(USERNAME, PASSWORD);
    for (let i = 0; i < 10; i++) assert.equal((await login("anna", "anna-reset-password-3")).status, 200);
    assert.equal((await call("/api/auth/session", "GET", undefined, ownerLogin.cookie)).body.authenticated, true);
    const latest = await login("anna", "anna-reset-password-3");
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1", [id])).rows[0].n, 8);

    // deleting: the member's data goes; the owner's and another member's tasks in the member's shared space go back
    // to their own creators' private spaces
    const theirs = (await as(latest.cookie)("/api/spaces", "POST", { name: "Wspólne Anny", color: "#e879f9", shared: true })).body;
    // the owner and Ola come in with Anna's codes
    const ownerCode = (await as(latest.cookie)(`/api/spaces/${theirs.id}/invites`, "POST", {})).body.code;
    assert.equal((await call("/api/spaces/join", "POST", { code: ownerCode })).status, 200);
    const ownerThere = (await call("/api/tasks", "POST", { title: "W jej przestrzeni", date: "2026-11-07", spaceId: theirs.id })).body;
    assert.equal((await call("/api/users", "POST", { login: "ola", name: "Ola", password: "ola-test-password-1" })).status, 201);
    const ola = await login("ola", "ola-test-password-1");
    const olaCode = (await as(latest.cookie)(`/api/spaces/${theirs.id}/invites`, "POST", {})).body.code;
    assert.equal((await as(ola.cookie)("/api/spaces/join", "POST", { code: olaCode })).status, 200);
    const olaThere = (await as(ola.cookie)("/api/tasks", "POST", { title: "Zadanie Oli u Anny", date: "2026-11-07", spaceId: theirs.id })).body;
    assert.equal((await call(`/api/users/${id}`, "DELETE")).status, 200);
    assert.equal((await as(again.cookie)("/api/tasks")).status, 401);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1", [id])).rows[0].n, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM goals WHERE user_id = $1", [id])).rows[0].n, 0);
    const ownerPrivate = (await call("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await call("/api/tasks")).body.find(t => t.id === ownerThere.id).spaceId, ownerPrivate);
    const olaPrivate = (await as(ola.cookie)("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await as(ola.cookie)("/api/tasks")).body.find(t => t.id === olaThere.id).spaceId, olaPrivate);
    const history = (await as(ola.cookie)(`/api/tasks/${olaThere.id}/history`)).body.find(h => h.field === "space_id");
    assert.deepEqual([history.oldValue, history.newValue], [String(theirs.id), String(olaPrivate)]);
  });
  test("invitation codes: one use, 7 days, withdrawable; joining, leaving and being taken out send one's tasks home", async () => {
    await call("/api/users", "POST", { login: "bartek", name: "Bartek", password: "bartek-test-password-1" });
    await call("/api/users", "POST", { login: "celina", name: "Celina", password: "celina-test-password-1" });
    const bartek = as((await login("bartek", "bartek-test-password-1")).cookie);
    const celina = as((await login("celina", "celina-test-password-1")).cookie);
    const garden = (await bartek("/api/spaces", "POST", { name: "Ogród", color: "#22c55e", shared: true })).body;
    // only the creator makes codes, only for a shared space; a code is shown once and kept only as a hash
    assert.equal((await celina(`/api/spaces/${garden.id}/invites`, "POST", {})).status, 404);
    const privateOne = (await bartek("/api/spaces", "POST", { name: "Moja", color: "#22c55e" })).body;
    assert.equal((await bartek(`/api/spaces/${privateOne.id}/invites`, "POST", {})).status, 404);
    const made = await bartek(`/api/spaces/${garden.id}/invites`, "POST", {});
    assert.equal(made.status, 201);
    assert.match(made.body.code, /^[A-HJKMNP-Z2-9]{12}$/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM space_invites WHERE code_hash = $1", [made.body.code])).rows[0].n, 0);
    assert.deepEqual((await bartek(`/api/spaces/${garden.id}/invites`)).body.map(i => i.id), [made.body.id]);

    // a preview tells where the code leads; typed with dashes and lower case it still works
    const typed = made.body.code.toLowerCase().replace(/(.{4})(?!$)/g, "$1-");
    const preview = await celina("/api/spaces/join/preview", "POST", { code: typed });
    assert.deepEqual(preview.body, { name: "Ogród", color: "#22c55e", people: 1, alreadyMember: false });
    assert.equal((await bartek("/api/spaces/join", "POST", { code: typed })).status, 409); // the creator is in already
    const joined = await celina("/api/spaces/join", "POST", { code: typed });
    assert.deepEqual([joined.status, joined.body.id, joined.body.mine, joined.body.people], [200, garden.id, false, 2]);
    assert.equal((await call("/api/spaces/join", "POST", { code: typed })).status, 404); // used up
    assert.deepEqual((await bartek(`/api/spaces/${garden.id}/invites`)).body, []);

    // withdrawn, expired: they let nobody in
    const second = (await bartek(`/api/spaces/${garden.id}/invites`, "POST", {})).body;
    assert.equal((await bartek(`/api/spaces/${garden.id}/invites/${second.id}`, "DELETE")).status, 200);
    assert.equal((await call("/api/spaces/join/preview", "POST", { code: second.code })).status, 404);
    const third = (await bartek(`/api/spaces/${garden.id}/invites`, "POST", {})).body;
    await owner.query("UPDATE space_invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [third.id]);
    assert.equal((await call("/api/spaces/join", "POST", { code: third.code })).status, 404);

    // the owner joins a member's space with a code like anybody else
    const forOwner = (await bartek(`/api/spaces/${garden.id}/invites`, "POST", {})).body;
    assert.equal((await call("/api/spaces/join", "POST", { code: forOwner.code })).status, 200);
    assert.deepEqual((await celina(`/api/spaces/${garden.id}/members`)).body.map(m => [m.name, m.creator, m.me]),
      [["Bartek", true, false], ["Celina", false, true], [null, false, false]]);

    // leaving: Celina's tasks there go home, the others' stay; the creator cannot "leave" their own space
    const celinaTask = (await celina("/api/tasks", "POST", { title: "Podlać", date: "2026-11-10", spaceId: garden.id })).body;
    const bartekTask = (await bartek("/api/tasks", "POST", { title: "Skosić", date: "2026-11-10", spaceId: garden.id })).body;
    assert.equal((await bartek(`/api/spaces/${garden.id}/members/me`, "DELETE")).status, 403);
    assert.equal((await celina(`/api/spaces/${garden.id}/members/owner`, "DELETE")).status, 403); // only the creator takes others out
    // Celina's project goes with her; Bartek's task in it stays in the space without it; Bartek's label leaves her task
    const celinaProject = (await celina("/api/projects", "POST", { name: "Rabaty", color: "#22c55e", spaceId: garden.id })).body;
    const inHerProject = (await celina("/api/tasks", "POST", { title: "Posadzić róże", date: "2026-11-10", projectId: celinaProject.id })).body;
    const bartekInHers = (await bartek("/api/tasks", "POST", { title: "Kupić ziemię", date: "2026-11-10", projectId: celinaProject.id })).body;
    const bartekLabel = (await bartek("/api/categories", "POST", { name: "Pilne", color: "#f87171" })).body;
    assert.equal((await bartek(`/api/tasks/${celinaTask.id}`, "PATCH", { labelIds: [bartekLabel.id] })).status, 200);
    assert.equal((await celina(`/api/spaces/${garden.id}/members/me`, "DELETE")).status, 200);
    assert.ok(!(await celina("/api/spaces")).body.some(s => s.id === garden.id));
    const herPrivate = (await celina("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await celina("/api/projects")).body.find(p => p.id === celinaProject.id).spaceId, herPrivate);
    const roses = (await celina("/api/tasks")).body.find(t => t.id === inHerProject.id);
    assert.deepEqual([roses.spaceId, roses.projectId], [herPrivate, celinaProject.id]);
    const soil = (await bartek("/api/tasks")).body.find(t => t.id === bartekInHers.id);
    assert.deepEqual([soil.spaceId, soil.projectId], [garden.id, null]);
    assert.deepEqual((await celina("/api/tasks")).body.find(t => t.id === celinaTask.id).labelIds, []);
    assert.equal((await celina(`/api/tasks/${celinaTask.id}`, "PATCH", { title: "Podlać kwiaty" })).status, 200);
    const celinaPrivate = (await celina("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await celina("/api/tasks")).body.find(t => t.id === celinaTask.id).spaceId, celinaPrivate);
    assert.ok(!(await celina("/api/tasks")).body.some(t => t.id === bartekTask.id));

    // taken out by the creator: the owner's task goes to the owner's Prywatne
    const ownerTask = (await call("/api/tasks", "POST", { title: "Nasiona", date: "2026-11-10", spaceId: garden.id })).body;
    assert.equal((await bartek(`/api/spaces/${garden.id}/members/owner`, "DELETE")).status, 200);
    const ownerPrivate = (await call("/api/spaces")).body.find(s => s.key === "private").id;
    assert.equal((await call("/api/tasks")).body.find(t => t.id === ownerTask.id).spaceId, ownerPrivate);
    assert.equal((await call(`/api/spaces/${garden.id}/members`)).status, 404);

    // the owner adds an account straight from the list (to their own shared spaces only)
    const celinaId = (await call("/api/users")).body.find(u => u.login === "celina").id;
    const ownerSpace = (await call("/api/spaces", "POST", { name: "Wakacje", color: "#f59e0b", shared: true })).body;
    assert.equal((await call(`/api/spaces/${garden.id}/members`, "POST", { userId: celinaId })).status, 404);
    assert.equal((await bartek(`/api/spaces/${ownerSpace.id}/members`, "POST", { userId: celinaId })).status, 403);
    assert.equal((await call(`/api/spaces/${ownerSpace.id}/members`, "POST", { userId: celinaId })).status, 201);
    assert.equal((await call(`/api/spaces/${ownerSpace.id}/members`, "POST", { userId: celinaId })).status, 409);
    assert.ok((await celina("/api/spaces")).body.some(s => s.id === ownerSpace.id));
    // unsharing: its people and waiting codes go
    await call(`/api/spaces/${ownerSpace.id}/invites`, "POST", {});
    assert.equal((await call(`/api/spaces/${ownerSpace.id}`, "PATCH", { shared: false })).status, 200);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [ownerSpace.id])).rows[0].n, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM space_invites WHERE space_id = $1", [ownerSpace.id])).rows[0].n, 0);
    assert.ok(!(await celina("/api/spaces")).body.some(s => s.id === ownerSpace.id));

    // a task never moves into a shared space its creator is not in
    assert.equal((await bartek(`/api/tasks/${bartekTask.id}`, "PATCH", { spaceId: celinaPrivate })).status, 400);
  });

  test("wrong codes are limited per account", async () => {
    await call("/api/users", "POST", { login: "darek", name: "Darek", password: "darek-test-password-1" });
    const darek = as((await login("darek", "darek-test-password-1")).cookie);
    for (let i = 0; i < 10; i++) assert.equal((await darek("/api/spaces/join/preview", "POST", { code: "AAAA-BBBB-CCCC" })).status, 404);
    assert.equal((await darek("/api/spaces/join", "POST", { code: "AAAA-BBBB-CCCC" })).status, 429);
    assert.equal((await darek("/api/spaces/join", "POST", { code: "x", extra: 1 })).status, 400);
  });

  test("account pictures: every account sets its own; seen by itself, the owner and its space partners", async () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20, 1)]).toString("base64");
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]).toString("base64");
    await call("/api/users", "POST", { login: "ewa", name: "Ewa", password: "ewa-test-password-1" });
    await call("/api/users", "POST", { login: "filip", name: "Filip", password: "filip-test-password-1" });
    const ewa = as((await login("ewa", "ewa-test-password-1")).cookie);
    const filip = as((await login("filip", "filip-test-password-1")).cookie);
    const ewaId = (await call("/api/users")).body.find(u => u.login === "ewa").id;

    // only a real WebP / JPEG, small
    for (const image of ["", "not base64!", Buffer.from("<svg/>").toString("base64"), Buffer.alloc(130 * 1024, 0xff).toString("base64")]) {
      assert.equal((await ewa("/api/avatars/me", "PUT", { image })).status, image.length > 200000 ? 413 : 400);
    }
    const set = await ewa("/api/avatars/me", "PUT", { image: webp });
    assert.equal(set.status, 200);
    assert.equal(typeof set.body.avatarAt, "number");
    assert.equal((await ewa("/api/auth/session")).body.user.avatarAt, set.body.avatarAt);
    assert.equal((await call("/api/users")).body.find(u => u.id === ewaId).avatarAt, set.body.avatarAt);

    // the picture: to Ewa and the owner; not to Filip until they share a space
    const picture = async (cookie, who) => ctx.request(`/api/avatars/${who}`, { ...(cookie ? { auth: null, headers: { cookie } } : {}) });
    const ewaCookie = (await login("ewa", "ewa-test-password-1")).cookie;
    const filipCookie = (await login("filip", "filip-test-password-1")).cookie;
    const own = await picture(ewaCookie, ewaId);
    assert.deepEqual([own.status, own.headers.get("content-type")], [200, "image/webp"]);
    assert.equal(Buffer.from(await own.arrayBuffer()).toString("base64"), webp);
    assert.equal((await picture(null, ewaId)).status, 200);
    assert.equal((await picture(filipCookie, ewaId)).status, 404);
    const etag = own.headers.get("etag");
    assert.equal((await ctx.request(`/api/avatars/${ewaId}`, { auth: null, headers: { cookie: ewaCookie, "if-none-match": etag } })).status, 304);

    const together = (await ewa("/api/spaces", "POST", { name: "Razem", color: "#22c55e", shared: true })).body;
    const code = (await ewa(`/api/spaces/${together.id}/invites`, "POST", {})).body.code;
    assert.equal((await filip("/api/spaces/join", "POST", { code })).status, 200);
    assert.equal((await picture(filipCookie, ewaId)).status, 200);
    assert.equal((await filip(`/api/spaces/${together.id}/members`)).body.find(m => m.id === ewaId).avatarAt, set.body.avatarAt);

    // the owner has one too (not a users row); a member sees it only through a shared space
    assert.equal((await call("/api/avatars/me", "PUT", { image: jpeg })).status, 200);
    assert.equal((await picture(filipCookie, "owner")).status, 404);
    const ownerCode = (await ewa(`/api/spaces/${together.id}/invites`, "POST", {})).body.code;
    assert.equal((await call("/api/spaces/join", "POST", { code: ownerCode })).status, 200);
    const ownerPicture = await picture(filipCookie, "owner");
    assert.deepEqual([ownerPicture.status, ownerPicture.headers.get("content-type")], [200, "image/jpeg"]);

    // removed: gone for everyone; the account's deletion takes it too
    assert.deepEqual((await ewa("/api/avatars/me", "DELETE")).body, { avatarAt: null });
    assert.equal((await picture(filipCookie, ewaId)).status, 404);
    assert.equal((await filip("/api/avatars/me", "PUT", { image: webp })).status, 200);
    const filipId = (await call("/api/users")).body.find(u => u.login === "filip").id;
    assert.equal((await call(`/api/users/${filipId}`, "DELETE")).status, 200);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM avatars WHERE account = $1", [`user:${filipId}`])).rows[0].n, 0);
  });

  test("every account is its own assignee: first on the list, with its picture, never deleted; \"To ja\" moves tasks", async () => {
    await call("/api/users", "POST", { login: "gosia", name: "Gosia", password: "gosia-test-password-1" });
    await call("/api/users", "POST", { login: "henryk", name: "Henryk", password: "henryk-test-password-1" });
    const gosia = as((await login("gosia", "gosia-test-password-1")).cookie);
    const henryk = as((await login("henryk", "henryk-test-password-1")).cookie);
    const gosiaId = (await call("/api/users")).body.find(u => u.login === "gosia").id;

    // made on the first read, once, named after the account; the owner's is "Administrator"
    const first = (await gosia("/api/assignees")).body;
    assert.equal(first[0].self, true);
    assert.deepEqual([first[0].name, first[0].mine, first[0].accountId, first[0].avatarAt], ["Gosia", true, gosiaId, null]);
    assert.equal((await gosia("/api/assignees")).body.filter(a => a.self && a.mine).length, 1);
    const ownerSelf = (await call("/api/assignees")).body.find(a => a.self && a.mine);
    assert.deepEqual([ownerSelf.name, ownerSelf.accountId], ["Administrator", null]);
    const me = first[0];

    // its picture's version comes along; it can be renamed but not deleted
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20, 1)]).toString("base64");
    const pic = (await gosia("/api/avatars/me", "PUT", { image: webp })).body.avatarAt;
    assert.equal((await gosia("/api/assignees")).body[0].avatarAt, pic);
    assert.equal((await gosia(`/api/assignees/${me.id}`, "PATCH", { name: "Małgosia" })).body.name, "Małgosia");
    assert.equal((await gosia(`/api/assignees/${me.id}`, "DELETE")).status, 409);
    assert.equal((await gosia(`/api/assignees/${me.id}/into-self`, "POST", {})).status, 409);

    // "To ja": the tasks of an entry made by hand go to the account itself, the entry goes away
    const byHand = (await gosia("/api/assignees", "POST", { name: "ja", color: "#38bdf8" })).body;
    const task = (await gosia("/api/tasks", "POST", { title: "Zrobić zakupy", date: "2026-11-11", assigneeId: byHand.id })).body;
    const unassigned = (await gosia("/api/tasks", "POST", { title: "Bez nikogo", date: "2026-11-11" })).body;
    assert.equal(unassigned.assigneeId, null);
    assert.equal((await henryk(`/api/assignees/${byHand.id}/into-self`, "POST", {})).status, 404);
    assert.deepEqual((await gosia(`/api/assignees/${byHand.id}/into-self`, "POST", {})).body, { self: me.id, moved: 1 });
    assert.equal((await gosia("/api/tasks")).body.find(t => t.id === task.id).assigneeId, me.id);
    assert.ok(!(await gosia("/api/assignees")).body.some(a => a.id === byHand.id));

    // people sharing a space see each other's own entries and may give each other tasks there; strangers do not
    assert.ok(!(await henryk("/api/assignees")).body.some(a => a.id === me.id));
    assert.equal((await henryk("/api/tasks", "POST", { title: "Dla Gosi", date: "2026-11-11", assigneeId: me.id })).status, 400);
    const flat = (await gosia("/api/spaces", "POST", { name: "Mieszkanie", color: "#22c55e", shared: true })).body;
    const code = (await gosia(`/api/spaces/${flat.id}/invites`, "POST", {})).body.code;
    assert.equal((await henryk("/api/spaces/join", "POST", { code })).status, 200);
    const seen = (await henryk("/api/assignees")).body.find(a => a.id === me.id);
    assert.deepEqual([seen.self, seen.mine, seen.accountId, seen.avatarAt], [true, false, gosiaId, pic]);
    const forGosia = await henryk("/api/tasks", "POST", { title: "Dla Gosi", date: "2026-11-11", spaceId: flat.id, assigneeId: me.id });
    assert.equal(forGosia.status, 201);
    assert.equal((await henryk(`/api/assignees/${me.id}`, "PATCH", { name: "Gosia2" })).status, 404);
  });

  test("spaces shared before members existed keep everybody in them, once", async () => {
    const { adoptSharedSpaces } = require("../routes/spaces");
    await owner.query("DELETE FROM app_settings WHERE key = 'spaces.members'");
    const users = (await owner.query("SELECT id FROM users ORDER BY id")).rows.map(r => r.id);
    const ownersOld = (await owner.query("INSERT INTO spaces (name, color, shared) VALUES ('Stara wspólna', '#38bdf8', true) RETURNING id")).rows[0].id;
    const membersOld = (await owner.query("INSERT INTO spaces (name, color, shared, user_id) VALUES ('Jej stara', '#38bdf8', true, $1) RETURNING id", [users[0]])).rows[0].id;
    assert.ok((await adoptSharedSpaces(appPool)) > 0);
    const inOwners = (await owner.query("SELECT user_id FROM space_members WHERE space_id = $1 ORDER BY user_id", [ownersOld])).rows.map(r => r.user_id);
    assert.deepEqual(inOwners, users);
    const inMembers = (await owner.query("SELECT user_id FROM space_members WHERE space_id = $1 ORDER BY user_id NULLS FIRST", [membersOld])).rows.map(r => r.user_id);
    assert.deepEqual(inMembers, [null, ...users.slice(1)]);
    assert.equal(await adoptSharedSpaces(appPool), 0);
  });
});
