// Spaces, projects, labels, notes, subtasks and history against a real, disposable PostgreSQL.
// Same database contract as integration.test.js (skipped unless the TEST_* URLs are set).
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON, USERNAME, PASSWORD } = require("./support");
const { runRetention } = require("../retention");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const APP_ROLE = process.env.TEST_APP_DB_ROLE || "tasks_app";
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);

const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;

describe("Tasks 1.0 data model", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let ctx;

  before(async () => {
    for (const url of [OWNER_URL, APP_URL]) {
      const parsed = new URL(url);
      if (!["localhost", "127.0.0.1", "::1", "db"].includes(parsed.hostname) || !/test/.test(parsed.pathname)) {
        throw new Error(`Refusing to run destructive tests against ${parsed.hostname}${parsed.pathname}`);
      }
    }
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
  });

  after(async () => {
    await appPool.end();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query(`DROP TABLE IF EXISTS public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history, public.task_time_entries, public.task_subtasks, public.task_notes,
      public.task_labels, public.tasks, public.projects, public.spaces, public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: () => {} });
    if (ctx) await ctx.close();
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
  });

  after(async () => { if (ctx) await ctx.close(); });

  const call = async (url, method = "GET", body) => {
    const res = await ctx.request(url, method === "GET" ? {} : { method, headers: SAME_ORIGIN_JSON, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const builtIn = async () => Object.fromEntries((await call("/api/spaces")).body.filter(s => s.key).map(s => [s.key, s]));
  const newTask = async (extra = {}) => (await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", ...extra })).body;

  test("built-in spaces exist once, the private one stays closed to agents and neither can be deleted", async () => {
    await builtIn();
    const spaces = await builtIn();
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM spaces")).rows[0].n, 2);
    assert.deepEqual([spaces.work.name, spaces.work.agentVisible], ["Praca", true]);
    assert.deepEqual([spaces.private.name, spaces.private.agentVisible], ["Prywatne", false]);
    assert.equal((await call(`/api/spaces/${spaces.private.id}`, "PATCH", { agentVisible: true })).status, 400);
    assert.equal((await call(`/api/spaces/${spaces.private.id}`, "PATCH", { name: "Dom" })).body.name, "Dom");
    assert.equal((await call(`/api/spaces/${spaces.work.id}`, "DELETE")).status, 409);
    const custom = await call("/api/spaces", "POST", { name: "Studia", color: "#16A34A" });
    assert.deepEqual([custom.status, custom.body.color, custom.body.agentVisible, custom.body.key], [201, "#16a34a", false, null]);
    assert.equal((await call("/api/spaces", "POST", { name: "x", color: "#16a34a" })).status, 400);
  });

  test("a new task is private; a project decides the space and leaving its space drops the project", async () => {
    const spaces = await builtIn();
    assert.equal((await newTask()).spaceId, spaces.private.id);
    const client = (await call("/api/projects", "POST", { name: "Klient A", color: "#84cc16", spaceId: spaces.work.id })).body;
    const task = await newTask({ projectId: client.id });
    assert.deepEqual([task.spaceId, task.projectId], [spaces.work.id, client.id]);
    assert.equal((await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", projectId: client.id, spaceId: spaces.private.id })).status, 400);
    assert.equal((await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", projectId: 999999 })).status, 400);
    assert.equal((await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", spaceId: 999999 })).status, 400);

    const moved = (await call(`/api/tasks/${task.id}`, "PATCH", { spaceId: spaces.private.id })).body;
    assert.deepEqual([moved.spaceId, moved.projectId], [spaces.private.id, null]);
    const back = (await call(`/api/tasks/${task.id}`, "PATCH", { projectId: client.id })).body;
    assert.deepEqual([back.spaceId, back.projectId], [spaces.work.id, client.id]);

    assert.deepEqual((await call(`/api/tasks?projectId=${client.id}`)).body.map(t => t.id), [task.id]);
    assert.equal((await call(`/api/tasks?spaceId=${spaces.private.id}`)).body.length, 1);
    // a task whose space disappeared counts as private
    await owner.query("UPDATE tasks SET space_id = NULL WHERE id <> $1", [task.id]);
    assert.equal((await call(`/api/tasks?spaceId=${spaces.private.id}`)).body.length, 1);
    assert.equal((await call("/api/tasks?spaceId=abc")).status, 400);
  });

  test("moving a project moves its tasks; deleting it keeps them", async () => {
    const spaces = await builtIn();
    const project = (await call("/api/projects", "POST", { name: "Klient B", color: "#84cc16", spaceId: spaces.work.id })).body;
    const task = await newTask({ projectId: project.id });
    const moved = await call(`/api/projects/${project.id}`, "PATCH", { spaceId: spaces.private.id, name: "Klient B2" });
    assert.deepEqual([moved.status, moved.body.spaceId, moved.body.name], [200, spaces.private.id, "Klient B2"]);
    assert.equal((await call(`/api/tasks?projectId=${project.id}`)).body[0].spaceId, spaces.private.id);

    const archived = await call(`/api/projects/${project.id}`, "PATCH", { archived: true });
    assert.ok(archived.body.archivedAt);
    assert.deepEqual((await call("/api/projects")).body, []);
    assert.equal((await call("/api/projects?archived=true")).body.length, 1);
    assert.equal((await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", projectId: project.id })).status, 400);

    assert.equal((await call(`/api/projects/${project.id}`, "DELETE")).status, 200);
    const remaining = (await call("/api/tasks")).body;
    assert.deepEqual(remaining.map(t => [t.id, t.projectId]), [[task.id, null]]);
    assert.equal((await call(`/api/projects/${project.id}`, "DELETE")).status, 404);
    assert.equal((await call("/api/projects", "POST", { name: "Bez", color: "#84cc16" })).status, 400);
  });

  test("a deleted custom space hands its tasks to the private space; one with projects is refused", async () => {
    const spaces = await builtIn();
    const custom = (await call("/api/spaces", "POST", { name: "Studia", color: "#16a34a" })).body;
    const task = await newTask({ spaceId: custom.id });
    const project = (await call("/api/projects", "POST", { name: "Praca dyplomowa", color: "#16a34a", spaceId: custom.id })).body;
    assert.equal((await call(`/api/spaces/${custom.id}`, "DELETE")).status, 409);
    await call(`/api/projects/${project.id}`, "DELETE");
    assert.equal((await call(`/api/spaces/${custom.id}`, "DELETE")).status, 200);
    assert.equal((await call("/api/tasks")).body.find(t => t.id === task.id).spaceId, spaces.private.id);
  });

  test("labels: the first is primary, filters see every label, and removing a label cascades", async () => {
    const make = async name => (await call("/api/categories", "POST", { name, color: "#22c55e" })).body.id;
    const [a, b, c] = [await make("Pilne"), await make("Klient"), await make("Faktura")];
    const task = await newTask({ labelIds: [a, b, c] });
    assert.deepEqual([task.categoryId, task.labelIds], [a, [a, b, c]]);
    assert.deepEqual((await call(`/api/tasks?categoryId=${b}`)).body.map(t => t.id), [task.id]);
    assert.deepEqual((await call(`/api/tasks/${task.id}`, "PATCH", { labelIds: [c, a] })).body.labelIds, [c, a]);
    assert.deepEqual((await call(`/api/tasks/${task.id}`, "PATCH", { categoryId: a })).body.labelIds, [a]);
    await call(`/api/tasks/${task.id}`, "PATCH", { labelIds: [b, c] });
    await call(`/api/categories/${c}`, "DELETE");
    assert.deepEqual((await call("/api/tasks")).body[0].labelIds, [b]);
    assert.equal((await call(`/api/tasks/${task.id}`, "PATCH", { labelIds: [a, a] })).status, 400);
    assert.equal((await call(`/api/tasks/${task.id}`, "PATCH", { labelIds: [999999] })).status, 400);
  });

  test("notes and subtasks belong to their task and are counted on it", async () => {
    const task = await newTask();
    const other = await newTask();
    const note = await call(`/api/tasks/${task.id}/notes`, "POST", { body: "  Zadzwonić do klienta  " });
    assert.deepEqual([note.status, note.body.body], [201, "Zadzwonić do klienta"]);
    await call(`/api/tasks/${task.id}/notes`, "POST", { body: "Druga notatka" });
    assert.deepEqual((await call(`/api/tasks/${task.id}/notes`)).body.map(n => n.body), ["Druga notatka", "Zadzwonić do klienta"]);
    assert.equal((await call(`/api/tasks/${task.id}/notes/${note.body.id}`, "PATCH", { body: "Zmienione" })).body.body, "Zmienione");
    assert.equal((await call(`/api/tasks/${other.id}/notes/${note.body.id}`, "PATCH", { body: "Obca" })).status, 404);
    assert.equal((await call(`/api/tasks/${task.id}/notes`, "POST", { body: "   " })).status, 400);
    assert.equal((await call("/api/tasks/999999/notes")).status, 404);
    assert.equal((await call("/api/tasks/abc/notes")).status, 400);

    const first = (await call(`/api/tasks/${task.id}/subtasks`, "POST", { title: "Krok 1" })).body;
    const second = (await call(`/api/tasks/${task.id}/subtasks`, "POST", { title: "Krok 2" })).body;
    assert.deepEqual([first.position, second.position], [0, 1]);
    const done = (await call(`/api/tasks/${task.id}/subtasks/${first.id}`, "PATCH", { done: true })).body;
    assert.ok(done.completedAt);
    assert.equal((await call(`/api/tasks/${task.id}/subtasks/${first.id}`, "PATCH", { done: "yes" })).status, 400);
    const counted = (await call("/api/tasks")).body.find(t => t.id === task.id);
    assert.deepEqual([counted.subtaskCount, counted.subtaskDoneCount, counted.noteCount], [2, 1, 2]);
    assert.equal((await call(`/api/tasks/${task.id}/subtasks/${second.id}`, "DELETE")).status, 200);
    assert.equal((await call(`/api/tasks/${task.id}/notes/${note.body.id}`, "DELETE")).status, 200);

    await call(`/api/tasks/${task.id}`, "DELETE");
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_subtasks")).rows[0].n, 0);
  });

  test("history records creation, field changes and board moves in the same transaction", async () => {
    const spaces = await builtIn();
    const task = await newTask();
    await call(`/api/tasks/${task.id}`, "PATCH", { title: "Nowy tytuł", status: "in_progress", spaceId: spaces.work.id, position: 5 });
    await call(`/api/tasks/${task.id}`, "PATCH", { title: "Nowy tytuł" }); // no change, no entry
    const board = (await call("/api/tasks")).body.map(({ id, status, position }) => ({ id, status, position: Number(position) }));
    assert.equal((await call("/api/tasks/move", "POST", { id: task.id, status: "done", beforeId: null, expected: board })).status, 200);
    const history = (await call(`/api/tasks/${task.id}/history`)).body.reverse();
    assert.deepEqual(history.map(h => [h.field, h.oldValue, h.newValue]), [
      ["created", null, "Zadanie"],
      ["title", "Zadanie", "Nowy tytuł"],
      ["status", "todo", "in_progress"],
      ["space_id", String(spaces.private.id), String(spaces.work.id)],
      ["status", "in_progress", "done"]
    ]);
    assert.ok(history.every(h => h.actor === "owner"));

    // a rejected write leaves neither the change nor its history behind
    const before = (await call(`/api/tasks/${task.id}/history`)).body.length;
    assert.equal((await call(`/api/tasks/${task.id}`, "PATCH", { title: "Zmiana", projectId: 999999 })).status, 400);
    assert.equal((await call(`/api/tasks/${task.id}/history`)).body.length, before);
    assert.equal((await call("/api/tasks")).body[0].title, "Nowy tytuł");
  });

  test("needs review is a fourth board status that keeps completion consistent", async () => {
    const task = await newTask({ status: "needs_review" });
    assert.deepEqual([task.status, task.completed, Boolean(task.reviewRequestedAt)], ["needs_review", false, true]);
    assert.deepEqual((await call("/api/tasks?status=needs_review")).body.map(t => t.id), [task.id]);
    assert.deepEqual((await call("/api/tasks?status=in_progress")).body, []);
    const done = (await call(`/api/tasks/${task.id}`, "PATCH", { status: "done" })).body;
    assert.deepEqual([done.status, done.completed, done.reviewRequestedAt], ["done", true, null]);
    const board = (await call("/api/tasks")).body.map(({ id, status, position }) => ({ id, status, position: Number(position) }));
    assert.equal((await call("/api/tasks/move", "POST", { id: task.id, status: "needs_review", beforeId: null, expected: board })).status, 200);
    const moved = (await call("/api/tasks")).body[0];
    assert.deepEqual([moved.status, moved.completed, moved.completedAt], ["needs_review", false, null]);
    const row = (await owner.query("SELECT status FROM tasks WHERE id = $1", [task.id])).rows[0];
    assert.equal(row.status, "in_progress"); // stored inside the original CHECK
    assert.equal((await call(`/api/tasks/${task.id}`, "PATCH", { status: "review" })).status, 400);
  });

  test("long-term plans are a fifth column stored inside the original status CHECK", async () => {
    const plan = await newTask({ status: "planned", dueDate: "2031-06-30" });
    assert.deepEqual([plan.status, plan.completed, Boolean(plan.plannedAt)], ["planned", false, true]);
    assert.equal((await owner.query("SELECT status FROM tasks WHERE id = $1", [plan.id])).rows[0].status, "todo");
    assert.deepEqual((await call("/api/tasks?status=planned")).body.map(t => t.id), [plan.id]);
    assert.deepEqual((await call("/api/tasks?status=todo")).body, []);
    // the board move uses the same mapping; moving to ToDo clears it
    const board = (await call("/api/tasks")).body.map(({ id, status, position }) => ({ id, status, position: Number(position) }));
    assert.equal((await call("/api/tasks/move", "POST", { id: plan.id, status: "todo", beforeId: null, expected: board })).status, 200);
    const moved = (await call("/api/tasks")).body[0];
    assert.deepEqual([moved.status, moved.plannedAt], ["todo", null]);
    // starting work on a plan makes it in progress
    await call(`/api/tasks/${plan.id}`, "PATCH", { status: "planned" });
    const started = (await call(`/api/tasks/${plan.id}/timer/start`, "POST")).body;
    assert.deepEqual([started.status, started.plannedAt], ["in_progress", null]);
    // legacy PUT keeps a plan a plan
    await call(`/api/tasks/${plan.id}`, "PATCH", { status: "planned" });
    assert.equal((await call(`/api/tasks/${plan.id}`, "PUT", { title: "Zadanie", date: "2026-11-05", completed: false })).body.status, "planned");
    assert.equal((await call(`/api/tasks/${plan.id}`, "PATCH", { status: "someday" })).status, 400);
  });

  test("legacy PUT keeps needs_review when completion does not change, and clears it when it does", async () => {
    const task = await newTask({ status: "needs_review" });
    const put = body => call(`/api/tasks/${task.id}`, "PUT", { title: "Zadanie", date: "2026-11-05", ...body });
    assert.equal((await put({ completed: false })).body.status, "needs_review");
    const done = (await put({ completed: true })).body;
    assert.deepEqual([done.status, done.reviewRequestedAt], ["done", null]);
    assert.equal((await put({ completed: false })).body.status, "todo");
  });

  test("a move only touches tasks whose column or position changes", async () => {
    const [a, b, c] = [await newTask(), await newTask(), await newTask()];
    // dense positions 0, 1, 2 as after any earlier move
    await owner.query("UPDATE tasks SET position = id - (SELECT min(id) FROM tasks), updated_at = '2026-01-01T00:00:00Z'");
    const board = (await call("/api/tasks")).body.map(({ id, status, position }) => ({ id, status, position: Number(position) }));
    assert.equal((await call("/api/tasks/move", "POST", { id: c.id, status: "done", beforeId: null, expected: board })).status, 200);
    const rows = (await owner.query("SELECT id, updated_at FROM tasks ORDER BY id")).rows;
    const untouched = rows.filter(r => r.updated_at.toISOString() === "2026-01-01T00:00:00.000Z").map(r => r.id);
    assert.deepEqual(untouched, [a.id, b.id]); // positions 0 and 1 in ToDo stay as they were
  });

  test("a valid session keeps working while its address is locked out after failed guesses", async () => {
    const login = await ctx.request("/api/auth/login", { method: "POST", auth: null, headers: SAME_ORIGIN_JSON, body: JSON.stringify({ login: USERNAME, password: PASSWORD }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const wrong = "Basic " + Buffer.from(`${USERNAME}:wrong`).toString("base64");
    for (let i = 0; i < 10; i++) await ctx.request("/api/tasks", { auth: wrong });
    assert.equal((await ctx.request("/api/tasks", { auth: wrong })).status, 429);
    assert.equal((await ctx.request("/api/tasks", { auth: null, headers: { cookie } })).status, 200);
  });

  test("assignees: filter, history and unassignment on delete", async () => {
    const person = await call("/api/assignees", "POST", { name: "Dima Rohov", color: "#B7E34D" });
    assert.deepEqual([person.status, person.body.color], [201, "#b7e34d"]);
    const task = await newTask({ assigneeId: person.body.id });
    assert.equal(task.assigneeId, person.body.id);
    assert.deepEqual((await call(`/api/tasks?assigneeId=${person.body.id}`)).body.map(t => t.id), [task.id]);
    const unknown = await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", assigneeId: 999999 });
    assert.deepEqual([unknown.status, unknown.body.message], [400, "Assignee does not exist"]);
    assert.equal((await call(`/api/assignees/${person.body.id}`, "PATCH", { name: "Dima R." })).body.name, "Dima R.");
    assert.equal((await call(`/api/assignees/${person.body.id}`, "DELETE")).status, 200);
    assert.equal((await call("/api/tasks")).body[0].assigneeId, null);
    const history = (await call(`/api/tasks/${task.id}/history`)).body;
    assert.deepEqual([history[0].field, history[0].newValue], ["assignee_id", null]);
  });

  test("timer: start moves to do into progress, one timer runs at a time, leaving progress stops it", async () => {
    const first = await newTask();
    const second = await newTask();
    const started = (await call(`/api/tasks/${first.id}/timer/start`, "POST")).body;
    assert.equal(started.status, "in_progress");
    assert.ok(started.timerStartedAt);
    assert.equal((await call(`/api/tasks/${first.id}/timer/start`, "POST")).status, 200); // idempotent
    await owner.query("UPDATE task_time_entries SET started_at = started_at - interval '90 minutes'");
    await call(`/api/tasks/${second.id}/timer/start`, "POST");
    const [a, b] = (await call("/api/tasks")).body;
    assert.equal(a.timerStartedAt, null); // stopped by the other start
    assert.ok(a.trackedSeconds >= 5400);
    assert.ok(b.timerStartedAt);
    assert.equal((await call(`/api/tasks/${second.id}`, "PATCH", { status: "needs_review" })).body.timerStartedAt, null);
    assert.equal((await call(`/api/tasks/${second.id}/timer/start`, "POST")).status, 409);
    await call(`/api/tasks/${first.id}/timer/start`, "POST");
    assert.equal((await call(`/api/tasks/${first.id}/timer/stop`, "POST")).body.timerStartedAt, null);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_time_entries WHERE ended_at IS NULL")).rows[0].n, 0);

    // Concurrent starts on different tasks are serialised: exactly one timer keeps running.
    const many = [await newTask(), await newTask(), await newTask(), await newTask()];
    await Promise.all(many.map(t => call(`/api/tasks/${t.id}/timer/start`, "POST")));
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_time_entries WHERE ended_at IS NULL")).rows[0].n, 1);
  });

  test("browser sessions: login, use, survive a restart, end on logout and are stored only as hashes", async () => {
    const anonymous = ctx.request.bind(ctx);
    const post = (url, body, cookie) => anonymous(url, { method: "POST", auth: null,
      headers: { ...SAME_ORIGIN_JSON, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const login = await post("/api/auth/login", { login: USERNAME, password: PASSWORD });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const token = cookie.split("=")[1];

    assert.equal((await anonymous("/api/tasks", { auth: null, headers: { cookie } })).status, 200);
    const created = await post("/api/tasks", { title: "Z sesji", date: "2026-11-06" }, cookie);
    assert.equal(created.status, 201);
    const stored = await owner.query("SELECT token_hash, login, method FROM auth_sessions");
    assert.equal(stored.rowCount, 1);
    assert.notEqual(stored.rows[0].token_hash, token);
    assert.deepEqual([stored.rows[0].login, stored.rows[0].method], [USERNAME, "password"]);

    await ctx.close(); // "restart": a new app instance keeps the session
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    const session = await (await ctx.request("/api/auth/session", { auth: null, headers: { cookie } })).json();
    assert.deepEqual([session.authenticated, session.login], [true, USERNAME]);

    // a tampered cookie and an expired session are both anonymous
    assert.equal((await ctx.request("/api/tasks", { auth: null, headers: { cookie: cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A") } })).status, 401);
    await owner.query("UPDATE auth_sessions SET expires_at = now() - interval '1 second'");
    assert.equal((await ctx.request("/api/tasks", { auth: null, headers: { cookie } })).status, 401);
    await owner.query("UPDATE auth_sessions SET expires_at = now() + interval '1 hour'");

    const out = await ctx.request("/api/auth/logout", { method: "POST", auth: null, headers: { ...SAME_ORIGIN_JSON, cookie }, body: "{}" });
    assert.equal(out.status, 200);
    assert.equal((await ctx.request("/api/tasks", { auth: null, headers: { cookie } })).status, 401);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM auth_sessions")).rows[0].n, 0);
  });

  test("retention: done tasks archive after 7 days; private ones go after 7 more, work ones after 90", async () => {
    const spaces = await builtIn();
    const settings = { archiveDays: 7, deletePrivateDays: 7, deleteWorkDays: 90 };
    const priv = await newTask({ status: "done" });
    const work = await newTask({ status: "done", spaceId: spaces.work.id });
    const fresh = await newTask({ status: "done" });
    const open = await newTask();
    await call(`/api/tasks/${priv.id}/notes`, "POST", { body: "znika razem z zadaniem" });
    await owner.query("UPDATE tasks SET completed_at = now() - interval '8 days' WHERE id = ANY($1)", [[priv.id, work.id]]);

    assert.deepEqual(await runRetention(appPool, settings), { archived: 2, deleted: 0, skipped: false }); // the app role can do it
    assert.deepEqual((await call("/api/tasks")).body.map(t => t.id).sort((a, b) => a - b), [fresh.id, open.id]);
    const archive = (await call("/api/archive")).body;
    assert.deepEqual(archive.settings, settings);
    const days = id => Math.round((new Date(archive.tasks.find(t => t.id === id).deleteAt) - new Date(archive.tasks.find(t => t.id === id).archivedAt)) / 86400000);
    assert.deepEqual([days(priv.id), days(work.id)], [7, 90]);
    assert.ok((await call(`/api/tasks/${priv.id}/history`)).body.some(h => h.field === "archived_at" && h.actor === "retention"));

    await owner.query("UPDATE tasks SET archived_at = now() - interval '8 days' WHERE archived_at IS NOT NULL");
    assert.equal((await runRetention(appPool, settings)).deleted, 1);
    assert.deepEqual((await call("/api/archive")).body.tasks.map(t => t.id), [work.id]);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_notes")).rows[0].n, 0);
    await owner.query("UPDATE tasks SET archived_at = now() - interval '91 days' WHERE id = $1", [work.id]);
    assert.equal((await runRetention(appPool, settings)).deleted, 1);
    assert.deepEqual((await call("/api/archive")).body.tasks, []);

    // 0 switches a step off
    await owner.query("UPDATE tasks SET completed_at = now() - interval '30 days' WHERE id = $1", [fresh.id]);
    assert.equal((await runRetention(appPool, { archiveDays: 0, deletePrivateDays: 0, deleteWorkDays: 0 })).archived, 0);
  });

  test("restoring from the archive reopens the task at the end of ToDo", async () => {
    const first = await newTask();
    const task = await newTask({ status: "done" });
    await owner.query("UPDATE tasks SET completed_at = now() - interval '8 days' WHERE id = $1", [task.id]);
    await runRetention(appPool, { archiveDays: 7, deletePrivateDays: 7, deleteWorkDays: 90 });
    const restored = await call(`/api/archive/${task.id}/restore`, "POST", {});
    assert.deepEqual([restored.status, restored.body.status, restored.body.archivedAt, restored.body.completedAt], [200, "todo", null, null]);
    const todo = (await call("/api/tasks?status=todo")).body;
    assert.deepEqual(todo.map(t => t.id), [first.id, task.id]);
    assert.equal((await call(`/api/archive/${task.id}/restore`, "POST", {})).status, 404); // not archived any more
    assert.equal((await call("/api/archive/abc/restore", "POST", {})).status, 400);
  });

  test("the application role reads and writes the new tables but cannot change their structure", async () => {
    for (const table of ["auth_sessions", "spaces", "projects", "assignees", "task_labels", "task_notes", "task_subtasks", "task_time_entries", "task_history"]) {
      await appPool.query(`SELECT 1 FROM ${table} LIMIT 1`);
      await assert.rejects(appPool.query(`ALTER TABLE ${table} ADD COLUMN x int`), /must be owner|permission denied/);
    }
  });
});
