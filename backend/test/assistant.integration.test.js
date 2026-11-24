// Mytko Assistant's task tools (assistant.js) against a real, disposable PostgreSQL: every change is seen through the
// app's own API, and every "Cofnij" puts the task back. Same database contract as integration.test.js (skipped unless
// the TEST_* URLs are set).
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");

const { createPool, runMigrations, listMigrations } = require("../kit");
const { startApp, SAME_ORIGIN_JSON } = require("./support");
const { createTasksAssistant } = require("../assistant");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const APP_ROLE = process.env.TEST_APP_DB_ROLE || "tasks_app";
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);
const TOKEN = "a-long-random-assistant-token-0123456789";

const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;

describe("Mytko Assistant: task tools", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let ctx;
  let assistant;

  before(async () => {
    for (const url of [OWNER_URL, APP_URL]) {
      const parsed = new URL(url);
      if (!["localhost", "127.0.0.1", "::1", "db"].includes(parsed.hostname) || !/test/.test(parsed.pathname)) {
        throw new Error(`Refusing to run destructive tests against ${parsed.hostname}${parsed.pathname}`);
      }
    }
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
    const app = express();
    app.use("/api/assistant", express.json(), createTasksAssistant({ pool: appPool,
      config: { assistant: { tokenHash: crypto.createHash("sha256").update(TOKEN).digest("hex") } }, now: () => new Date("2026-11-12T10:00:00Z") }));
    assistant = await new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  });

  after(async () => {
    if (ctx) await ctx.close();
    await new Promise(resolve => assistant.close(resolve));
    await appPool.end();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query(`DROP TABLE IF EXISTS public.push_log, public.push_subscriptions, public.avatars, public.space_invites, public.space_members, public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history, public.task_time_entries, public.task_subtasks, public.task_notes,
      public.task_labels, public.tasks, public.projects, public.spaces, public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: () => {} });
    if (ctx) await ctx.close();
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
  });

  const call = async (url, method = "GET", body) => {
    const res = await ctx.request(url, method === "GET" ? {} : { method, headers: SAME_ORIGIN_JSON, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const ask = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${assistant.address().port}/api/assistant${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const run = (tool, input) => ask("/run", { tool, input });
  const undo = token => ask("/undo", { undo: token });
  const task = async id => (await call("/api/tasks")).body.find(t => t.id === id);
  const newTask = async (title, extra = {}) => (await call("/api/tasks", "POST", { title, date: "2026-11-12", ...extra })).body;
  const column = async status => (await call("/api/tasks")).body.filter(t => t.status === status).sort((a, b) => Number(a.position) - Number(b.position) || a.id - b.id).map(t => t.id);

  test("tasks.add_task: the same task as the app's form makes for that day (its deadline, the calendar's day), with its \"created\" entry; Cofnij deletes it", async () => {
    const space = (await call("/api/spaces", "POST", { name: "Dom", color: "#16a34a" })).body;
    await call("/api/projects", "POST", { name: "Remont", color: "#16a34a", spaceId: space.id });
    const form = await newTask("Kupić farbę", { dueDate: "2026-11-18", priority: "P1", spaceId: space.id });
    const said = await run("tasks.add_task", { title: "Kupić olej", date: "2026-11-18", priority: "P1", space: "dom" });
    assert.equal(said.status, 200, JSON.stringify(said.body));
    assert.equal(said.body.summary, "Zadanie: Kupić olej · 2026-11-18 · Dom · P1");
    const voice = await task(said.body.data.id);
    for (const key of ["date", "dueDate", "status", "priority", "spaceId", "projectId", "completed", "description"]) assert.deepEqual(voice[key], form[key], key);
    const history = (await call(`/api/tasks/${voice.id}/history`)).body;
    assert.deepEqual(history.map(h => [h.field, h.newValue, h.actor]), [["created", "Kupić olej", "owner"]]);
    assert.deepEqual(await undo(said.body.undo), { status: 200, body: { summary: "Cofnięto zadanie: Kupić olej" } });
    assert.equal(await task(voice.id), undefined);
    const plain = await run("tasks.add_task", { title: "Kupić chleb" });
    assert.deepEqual([(await task(plain.body.data.id)).dueDate, (await task(plain.body.data.id)).date], [null, form.date], "no day said: none, as the form left empty");
  });

  test("tasks.list: open tasks with ids, a day, a range, a column, a project, words", async () => {
    const space = (await call("/api/spaces", "POST", { name: "Dom", color: "#16a34a" })).body;
    const project = (await call("/api/projects", "POST", { name: "Remont", color: "#16a34a", spaceId: space.id })).body;
    const oil = await newTask("Kupić olej", { dueDate: "2026-11-14", priority: "P1" });
    const paint = await newTask("Kupić farbę", { projectId: project.id, description: "biała, matowa" });
    const call1 = await newTask("Zadzwonić do Ani", { status: "done" });
    const plan = await newTask("Nauczyć się japońskiego", { status: "planned", dueDate: "2031-11-12" });

    const all = await run("tasks.list", {});
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(all.body.data.tasks.map(t => t.id), [paint.id, oil.id], "open: not done, not a long-term plan; by day");
    assert.deepEqual(all.body.data.tasks[1], { id: oil.id, title: "Kupić olej", status: "todo", date: "2026-11-12", dueDate: "2026-11-14", priority: "P1", space: "Prywatne", project: null });
    assert.equal(all.body.summary, "Zadania (2): Kupić farbę (ToDo, 2026-11-12, Dom › Remont); ❗ Kupić olej (ToDo, termin 2026-11-14, Prywatne)");
    assert.deepEqual((await run("tasks.list", { date: "2026-11-14" })).body.data.tasks.map(t => t.id), [oil.id], "the deadline, not the day it was written");
    assert.deepEqual((await run("tasks.list", { from: "2026-11-09", to: "2026-11-13" })).body.data.tasks.map(t => t.id), [paint.id]);
    const done = await run("tasks.list", { status: "done", date: "2026-11-12" });
    assert.deepEqual(done.body.data.tasks.map(t => t.id), [call1.id], "finished that day");
    assert.deepEqual((await run("tasks.list", { status: "planned" })).body.data.tasks.map(t => t.id), [plan.id]);
    assert.equal((await run("tasks.list", { status: "all" })).body.data.total, 4);
    const inProject = await run("tasks.list", { project: "remont" });
    assert.equal(inProject.body.summary, "Zadania (1): Kupić farbę (ToDo, 2026-11-12)");
    assert.deepEqual((await run("tasks.list", { space: "prywatne" })).body.data.tasks.map(t => t.id), [oil.id]);
    assert.deepEqual((await run("tasks.list", { query: "MATOWA" })).body.data.tasks.map(t => t.id), [paint.id], "the description too");
    assert.equal((await run("tasks.list", { query: "nic takiego" })).body.summary, "Brak takich zadań.");
    assert.equal((await run("tasks.list", { date: "2026-11-12", from: "2026-11-01" })).status, 400);
    assert.equal((await run("tasks.list", { from: "2026-11-13", to: "2026-11-01" })).status, 400);
  });

  test("tasks.set_status: done, back, every column; by title; Cofnij puts it back where it was, only while it is there", async () => {
    const oil = await newTask("Kupić olej");
    const paint = await newTask("Kupić farbę");
    const bread = await newTask("Chleb");
    assert.deepEqual(await column("todo"), [oil.id, paint.id, bread.id]);

    const ambiguous = await run("tasks.set_status", { task: "kupić", status: "done" });
    assert.equal(ambiguous.status, 400);
    assert.match(ambiguous.body.message, new RegExp(`^Which task\\? ${oil.id}: Kupić olej \\(ToDo, 2026-11-12\\); ${paint.id}: Kupić farbę`));
    assert.equal((await run("tasks.set_status", { task: "kosmos", status: "done" })).status, 404);

    const finished = await run("tasks.set_status", { task: "kupić ol", status: "done" });
    assert.equal(finished.status, 200, JSON.stringify(finished.body));
    assert.equal(finished.body.summary, "„Kupić olej” → Zakończone");
    let row = await task(oil.id);
    assert.deepEqual([row.status, row.completed, Boolean(row.completedAt)], ["done", true, true]);
    const history = (await call(`/api/tasks/${oil.id}/history`)).body;
    assert.deepEqual([history[0].field, history[0].oldValue, history[0].newValue, history[0].actor], ["status", "todo", "done", "owner"]);
    assert.equal((await run("tasks.set_status", { task: String(oil.id), status: "done" })).body.summary, "„Kupić olej” jest już w kolumnie Zakończone");

    assert.deepEqual(await undo(finished.body.undo), { status: 200, body: { summary: "Cofnięto: „Kupić olej” → ToDo" } });
    row = await task(oil.id);
    assert.deepEqual([row.status, row.completed, row.completedAt], ["todo", false, null]);
    assert.deepEqual(await column("todo"), [oil.id, paint.id, bread.id], "back before the task that was below it");
    assert.equal((await undo(finished.body.undo)).status, 409, "no longer as the assistant left it");

    // a finished task back to the board: "przywróć z zrobionych"; the done one is not taken for the open one
    await call("/api/tasks/move", "POST", { id: bread.id, status: "done", beforeId: null, expected: (await call("/api/tasks")).body.map(t => ({ id: t.id, status: t.status, position: Number(t.position) })) });
    await newTask("Chleb");
    const back = await run("tasks.set_status", { task: "chleb", status: "todo" });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal((await task(bread.id)).status, "todo", "the one that is not there yet");

    for (const status of ["in_progress", "needs_review", "planned", "todo"]) {
      const moved = await run("tasks.set_status", { task: String(paint.id), status });
      assert.equal(moved.status, 200, status);
      assert.equal((await task(paint.id)).status, status);
    }
    const started = await run("tasks.set_status", { task: "farbę", status: "in_progress" });
    await call(`/api/tasks/${paint.id}/timer/start`, "POST", {});
    await run("tasks.set_status", { task: "farbę", status: "done" });
    assert.equal((await task(paint.id)).timerStartedAt, null, "leaving in progress stops the timer, as on the board");
    assert.equal((await undo(started.body.undo)).status, 409, "moved on since");
  });

  test("tasks.update_task: title, deadline, priority, description, project, space, assignee; Cofnij puts every value back", async () => {
    const space = (await call("/api/spaces", "POST", { name: "Dom", color: "#16a34a" })).body;
    const project = (await call("/api/projects", "POST", { name: "Remont", color: "#16a34a", spaceId: space.id })).body;
    const ania = (await call("/api/assignees", "POST", { name: "Ania", color: "#16a34a" })).body;
    const oil = await newTask("Kupić olej", { dueDate: "2026-11-14", description: "5W30" });
    const original = await task(oil.id);

    const changed = await run("tasks.update_task", { task: "olej", title: "Kupić olej silnikowy", dueDate: "2026-11-20", priority: "P0",
      description: "5W40", project: "remont", assignee: "ania" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.summary, "Zmieniono „Kupić olej”: tytuł: Kupić olej silnikowy · termin 2026-11-20 · P0 · nowy opis · Dom › Remont · wykonawca: Ania");
    let row = await task(oil.id);
    assert.deepEqual([row.title, row.dueDate, row.priority, row.description, row.spaceId, row.projectId, row.assigneeId],
      ["Kupić olej silnikowy", "2026-11-20", "P0", "5W40", space.id, project.id, ania.id]);
    const fields = (await call(`/api/tasks/${oil.id}/history`)).body.map(h => h.field).sort();
    assert.deepEqual(fields, ["assignee_id", "created", "description", "due_date", "priority", "project_id", "space_id", "title"]);

    assert.deepEqual(await undo(changed.body.undo), { status: 200, body: { summary: "Cofnięto zmiany: Kupić olej silnikowy" } });
    row = await task(oil.id);
    for (const key of ["title", "dueDate", "priority", "description", "projectId", "assigneeId"]) assert.deepEqual(row[key], original[key], key);
    assert.equal(row.spaceId, original.spaceId ?? (await call("/api/spaces")).body.find(s => s.key === "private").id, "the private space");

    const none = await run("tasks.update_task", { task: "olej", dueDate: "none", assignee: "me" });
    assert.equal(none.status, 200, JSON.stringify(none.body));
    row = await task(oil.id);
    assert.equal(row.dueDate, null);
    assert.equal(row.assigneeId, (await call("/api/assignees")).body.find(a => a.self).id);
    await call(`/api/tasks/${oil.id}`, "PATCH", { dueDate: "2026-12-01" });
    assert.equal((await undo(none.body.undo)).status, 409, "the owner changed it since");
    assert.equal((await task(oil.id)).dueDate, "2026-12-01");

    const moved = await run("tasks.update_task", { task: "olej", space: "dom" });
    assert.equal(moved.body.summary, "Zmieniono „Kupić olej”: Dom");
    assert.equal((await task(oil.id)).spaceId, space.id);
    assert.equal((await run("tasks.update_task", { task: "olej", project: "remont", space: "Praca" })).status, 400, "a project brings its own space");
    assert.equal((await run("tasks.update_task", { task: "olej" })).status, 400, "nothing to change");
    assert.equal((await run("tasks.update_task", { task: "olej", dueDate: "2026-02-30" })).status, 400, "a real day, as in the app");
    assert.equal((await run("tasks.update_task", { task: "olej", assignee: "Kasia" })).status, 400);
    assert.equal((await run("tasks.update_task", { task: "olej", priority: "P2" })).body.summary, "„Kupić olej”: bez zmian");
    const long = await call(`/api/tasks/${oil.id}`, "PATCH", { description: "x".repeat(3000) });
    assert.equal(long.status, 200);
    const shortened = await run("tasks.update_task", { task: "olej", description: "krótko" });
    assert.deepEqual([shortened.status, shortened.body.undo], [200, null], "a long old description does not fit Cofnij");
  });

  test("tasks.restore_task: an archived task back to ToDo, and back to the archive with Cofnij", async () => {
    const oil = await newTask("Kupić olej", { status: "done" });
    await owner.query("UPDATE tasks SET completed_at = now() - interval '40 days', archived_at = now() - interval '10 days' WHERE id = $1", [oil.id]);
    const archivedAt = (await owner.query("SELECT archived_at, completed_at, position FROM tasks WHERE id = $1", [oil.id])).rows[0];
    const missing = await run("tasks.set_status", { task: "olej", status: "todo" });
    assert.deepEqual([missing.status, missing.body.message], [404, "\"olej\" is in the archive (finished long ago): tasks.restore_task brings it back to ToDo"]);

    const restored = await run("tasks.restore_task", { task: "olej" });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.summary, "Przywrócono z archiwum: „Kupić olej” → ToDo");
    const row = await task(oil.id);
    assert.deepEqual([row.status, row.archivedAt], ["todo", null]);

    assert.deepEqual(await undo(restored.body.undo), { status: 200, body: { summary: "Cofnięto: „Kupić olej” wraca do archiwum" } });
    assert.equal(await task(oil.id), undefined, "off the board again");
    const again = (await owner.query("SELECT status, completed, archived_at, completed_at, position FROM tasks WHERE id = $1", [oil.id])).rows[0];
    assert.deepEqual([again.status, again.completed, again.archived_at.toISOString(), again.completed_at.toISOString(), again.position],
      ["done", true, archivedAt.archived_at.toISOString(), archivedAt.completed_at.toISOString(), archivedAt.position]);
    assert.equal((await undo(restored.body.undo)).status, 409);
    assert.equal((await call("/api/archive")).body.tasks.length, 1);
  });

  test("notes and subtasks: add, tick, untick; Cofnij removes or unticks while unchanged", async () => {
    const repair = await newTask("Remont łazienki");
    const note = await run("tasks.add_note", { task: "remont", text: "  Czekam na fachowca  " });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    assert.deepEqual((await call(`/api/tasks/${repair.id}/notes`)).body.map(n => n.body), ["Czekam na fachowca"]);
    assert.deepEqual(await undo(note.body.undo), { status: 200, body: { summary: "Cofnięto notatkę do: Remont łazienki" } });
    assert.deepEqual((await call(`/api/tasks/${repair.id}/notes`)).body, []);
    const edited = await run("tasks.add_note", { task: "remont", text: "Pierwsza" });
    await call(`/api/tasks/${repair.id}/notes/${edited.body.data.id}`, "PATCH", { body: "Zmieniona" });
    assert.equal((await undo(edited.body.undo)).status, 409, "the owner edited the note");

    const paint = await run("tasks.add_subtask", { task: "remont", title: "Kupić farbę" });
    const tiles = await run("tasks.add_subtask", { task: "remont", title: "Kupić płytki" });
    assert.equal(paint.body.summary, "Podzadanie: Kupić farbę · do „Remont łazienki”");
    const ambiguous = await run("tasks.set_subtask", { task: "remont", subtask: "kupić" });
    assert.match(ambiguous.body.message, /^Which subtask\? \d+: Kupić farbę; \d+: Kupić płytki/);
    const ticked = await run("tasks.set_subtask", { task: "remont", subtask: "farb" });
    assert.equal(ticked.body.summary, "✓ Kupić farbę · „Remont łazienki”");
    let subtasks = (await call(`/api/tasks/${repair.id}/subtasks`)).body;
    assert.deepEqual(subtasks.map(s => [s.title, s.done]), [["Kupić farbę", true], ["Kupić płytki", false]]);
    assert.equal((await task(repair.id)).subtaskDoneCount, 1);
    assert.equal((await run("tasks.set_subtask", { task: "remont", subtask: "farb" })).body.summary, "Kupić farbę: już zrobione");
    assert.equal((await undo(paint.body.undo)).status, 409, "a done subtask is not taken away");
    assert.deepEqual(await undo(ticked.body.undo), { status: 200, body: { summary: "Cofnięto: Kupić farbę" } });
    assert.equal((await undo(ticked.body.undo)).status, 409);
    const unticked = await run("tasks.set_subtask", { task: "remont", subtask: "farb", done: false });
    assert.equal(unticked.body.summary, "Kupić farbę: już niezrobione");
    assert.deepEqual(await undo(tiles.body.undo), { status: 200, body: { summary: "Cofnięto podzadanie: Kupić płytki" } });
    subtasks = (await call(`/api/tasks/${repair.id}/subtasks`)).body;
    assert.deepEqual(subtasks.map(s => [s.title, s.done]), [["Kupić farbę", false]]);
    assert.equal((await run("tasks.set_subtask", { task: "olej", subtask: "x" })).status, 404);
  });

  test("the context: today, the spaces, projects and assignees the planner may name", async () => {
    await call("/api/spaces");
    const space = (await call("/api/spaces", "POST", { name: "Dom", color: "#16a34a" })).body;
    await call("/api/projects", "POST", { name: "Remont", color: "#16a34a", spaceId: space.id });
    await call("/api/assignees", "POST", { name: "Ania", color: "#16a34a" });
    await call("/api/tasks");
    const tools = (await ask("/tools")).body;
    assert.deepEqual(tools.tools.map(t => t.name), ["tasks.add_task", "tasks.today", "tasks.list", "tasks.set_status", "tasks.update_task",
      "tasks.restore_task", "tasks.add_note", "tasks.add_subtask", "tasks.set_subtask"]);
    assert.deepEqual({ ...tools.context, spaces: [...tools.context.spaces].sort() },
      { today: "2026-11-12", spaces: ["Dom", "Praca", "Prywatne"], projects: [{ name: "Remont", space: "Dom" }], assignees: ["Ania"] }, "spaces in the app's order");
  });
});
