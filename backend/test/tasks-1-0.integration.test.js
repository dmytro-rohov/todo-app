// Spaces, projects, labels, notes, subtasks and history against a real, disposable PostgreSQL.
// Same database contract as integration.test.js (skipped unless the TEST_* URLs are set).
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON } = require("./support");

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
    await owner.query(`DROP TABLE IF EXISTS public.task_history, public.task_time_entries, public.task_subtasks, public.task_notes,
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

  test("assignees: filter, history and unassignment on delete", async () => {
    const person = await call("/api/assignees", "POST", { name: "Dima Rohov", color: "#B7E34D" });
    assert.deepEqual([person.status, person.body.color], [201, "#b7e34d"]);
    const task = await newTask({ assigneeId: person.body.id });
    assert.equal(task.assigneeId, person.body.id);
    assert.deepEqual((await call(`/api/tasks?assigneeId=${person.body.id}`)).body.map(t => t.id), [task.id]);
    assert.equal((await call("/api/tasks", "POST", { title: "Zadanie", date: "2026-11-05", assigneeId: 999999 })).status, 400);
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
  });

  test("the application role reads and writes the new tables but cannot change their structure", async () => {
    for (const table of ["spaces", "projects", "assignees", "task_labels", "task_notes", "task_subtasks", "task_time_entries", "task_history"]) {
      await appPool.query(`SELECT 1 FROM ${table} LIMIT 1`);
      await assert.rejects(appPool.query(`ALTER TABLE ${table} ADD COLUMN x int`), /must be owner|permission denied/);
    }
  });
});
