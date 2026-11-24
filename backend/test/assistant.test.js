// Mytko Assistant's task tools (assistant.js) without a database: how a spoken task is found, what each tool writes
// through the app's own code and what "Cofnij" puts back. assistant.integration.test.js runs the same against PostgreSQL.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
// loopback requests stay off any proxy from the environment (Mytko's validation sandbox), as in the other tests
require("./support");

const { createTasksAssistant, matching } = require("../assistant");

const TOKEN = "a-long-random-assistant-token-0123456789";
async function assistant(pool) {
  const app = express();
  app.use("/api/assistant", express.json(), createTasksAssistant({ pool, config: { assistant: { tokenHash: crypto.createHash("sha256").update(TOKEN).digest("hex") } },
    now: () => new Date("2026-11-12T10:00:00Z") }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const call = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/assistant${path}`, { method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async res => ({ status: res.status, body: await res.json() }));
  return { run: (tool, input) => call("/run", { tool, input }), undo: token => call("/undo", { undo: token }), close: () => new Promise(resolve => server.close(resolve)) };
}

// The tasks table as the app's queries see it (only the shapes the tools use), for the owner (spaces 1 Praca, 2 Prywatne).
const COLUMNS = { title: "title", description: "description", priority: "priority", due_date: "dueDate", space_id: "spaceId", project_id: "projectId", assignee_id: "assigneeId" };
function fakeTasks(tasks, { subtasks = [], notes = [], projects = [], assignees = [] } = {}) {
  const history = [];
  const writes = [];
  const byId = id => tasks.find(task => task.id === Number(id));
  const query = async (sql, params = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|LOCK)/.test(sql) || sql.startsWith("SELECT 1 FROM spaces WHERE id")) return { rows: [] };
    if (sql.startsWith("SELECT id, key FROM spaces")) return { rows: [{ id: 1, key: "work" }, { id: 2, key: "private" }] };
    if (sql.startsWith("SELECT s.id, s.name FROM spaces s")) return { rows: [{ id: 1, name: "Praca" }, { id: 2, name: "Prywatne" }, { id: 3, name: "Dom" }] };
    if (sql.startsWith("SELECT p.id, p.name")) return { rows: projects };
    if (sql.startsWith("SELECT a.id, a.name, a.account")) return { rows: assignees };
    if (sql.startsWith("SELECT t.id, t.title, t.description")) {
      const archived = sql.includes("archived_at IS NOT NULL");
      return { rows: tasks.filter(task => Boolean(task.archivedAt) === archived).map(task => ({ ...task, spaceId: task.spaceId ?? 2,
        space: { 1: "Praca", 2: "Prywatne", 3: "Dom" }[task.spaceId ?? 2], project: projects.find(p => p.id === task.projectId)?.name ?? null })) };
    }
    if (sql.startsWith("SELECT id, (CASE")) {
      return { rows: tasks.filter(task => !task.archivedAt).sort((a, b) => a.position - b.position || a.id - b.id)
        .map(({ id, status, position }) => ({ id, status, position })) };
    }
    if (sql.startsWith("SELECT 1 FROM tasks t WHERE t.id = $1")) return { rows: byId(params[0]) ? [{}] : [], rowCount: byId(params[0]) ? 1 : 0 };
    if (sql.includes("AS \"labelIds\"") && sql.includes("FROM tasks WHERE id = $1")) return { rows: byId(params[0]) ? [{ ...byId(params[0]) }] : [] };
    if (sql.startsWith("SELECT user_id FROM tasks")) return { rows: [{ user_id: null }] };
    if (sql.startsWith("SELECT 1 FROM assignees a")) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith("INSERT INTO task_history")) { history.push({ taskId: params[0], fields: params[1], old: params[2], new: params[3], actor: params[4] }); return { rows: [] }; }
    if (sql.startsWith("UPDATE task_time_entries") || sql.startsWith("UPDATE tasks SET ai_checked_at")) return { rows: [] };
    if (sql.startsWith("UPDATE tasks SET status = CASE")) {
      // the board's move (status, position, id), the archive's restore (todo, id) and its Cofnij (status, id)
      const task = byId(params.at(-1));
      writes.push(sql);
      task.status = params[0];
      task.completed = params[0] === "done";
      if (params.length === 3) task.position = params[1];
      if (sql.includes("archived_at = NULL")) Object.assign(task, { archivedAt: null, completedAt: null, position: 99 });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE tasks SET completed_at = $1, archived_at = $2")) {
      Object.assign(byId(params[3]), { completedAt: params[0], archivedAt: params[1], position: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE tasks SET")) {
      const task = byId(params.at(-1));
      writes.push(sql);
      for (const [, column, index] of sql.matchAll(/(\w+) = \$(\d+)/g)) if (COLUMNS[column]) task[COLUMNS[column]] = params[Number(index) - 1];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id, task_id AS \"taskId\", title, done")) return { rows: subtasks.filter(s => s.taskId === params[0]) };
    if (sql.startsWith("INSERT INTO task_notes")) {
      const note = { id: 50 + notes.length, taskId: params[0], body: params[1] };
      notes.push(note);
      return { rows: [note] };
    }
    if (sql.startsWith("DELETE FROM task_notes")) {
      const index = notes.findIndex(n => n.id === params[0] && n.taskId === params[1] && crypto.createHash("md5").update(n.body).digest("hex") === params[2]);
      if (index >= 0) notes.splice(index, 1);
      return { rowCount: index >= 0 ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO task_subtasks")) {
      if (subtasks.filter(st => st.taskId === params[0]).length >= 100) return { rows: [] };
      const subtask = { id: 70 + subtasks.length, taskId: params[0], title: params[1], done: false };
      subtasks.push(subtask);
      return { rows: [subtask] };
    }
    if (sql.startsWith("DELETE FROM task_subtasks")) {
      const index = subtasks.findIndex(st => st.id === params[0] && st.taskId === params[1] && st.title === params[2] && !st.done);
      if (index >= 0) subtasks.splice(index, 1);
      return { rowCount: index >= 0 ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE task_subtasks")) {
      const subtask = subtasks.find(s => s.id === params[1] && s.taskId === params[2]);
      writes.push(sql);
      if (!subtask || (/AND done = (true|false)/.test(sql) && String(subtask.done) !== /AND done = (true|false)/.exec(sql)[1])) return { rows: [] };
      subtask.done = params[0];
      return { rows: [{ ...subtask }] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) }, history, writes };
}

const task = (id, title, extra = {}) => ({ id, title, description: "", status: "todo", completed: false, priority: "P2", date: "2026-11-12",
  dueDate: null, doneDay: null, spaceId: 2, projectId: null, assigneeId: null, position: id, archivedAt: null, completedAt: null, ...extra });

test("a spoken task: its id, else its title exactly, else the start, else (3+ letters) a part; preferred rows first", () => {
  const rows = [task(1, "Kupić olej"), task(2, "Kupić farbę"), task(3, "Olej", { status: "done" }), task(4, "Chleb", { status: "done" }), task(5, "Chleb")];
  const open = row => row.status !== "done";
  const ids = (said, prefer = open) => matching(rows, said, prefer).map(row => row.id);
  assert.deepEqual(ids("2"), [2]);
  assert.deepEqual(ids("99"), [], "a number that is no id is a title");
  assert.deepEqual(ids("  KUPIĆ OLEJ "), [1]);
  assert.deepEqual(ids("kupić"), [1, 2], "a question back");
  assert.deepEqual(ids("olej"), [1], "an open task before a finished one with that very title");
  assert.deepEqual(ids("olej", () => true), [3]);
  assert.deepEqual(ids("chleb"), [5]);
  assert.deepEqual(ids("chleb", row => row.status === "done"), [4]);
  assert.deepEqual(ids("ol"), [3], "two letters: only the start");
  assert.deepEqual(ids("fa"), [], "two letters are never a part");
  assert.deepEqual(ids("farb"), [2]);
});

test("tasks.list: open tasks by default, a day, a column, words; at most 25 with the count", async () => {
  const rows = [task(1, "Kupić olej", { dueDate: "2026-11-14", priority: "P1" }), task(2, "Kupić farbę", { spaceId: 3, description: "matowa" }),
    task(3, "Zadzwonić", { status: "done", doneDay: "2026-11-11" }), task(4, "Japoński", { status: "planned" })];
  const { pool } = fakeTasks(rows);
  const ctx = await assistant(pool);
  try {
    const open = await ctx.run("tasks.list", {});
    assert.equal(open.body.summary, "Zadania (2): ❗ Kupić olej (ToDo, termin 2026-11-14, Prywatne); Kupić farbę (ToDo, 2026-11-12, Dom)");
    assert.deepEqual(open.body.data.tasks[0], { id: 1, title: "Kupić olej", status: "todo", date: "2026-11-12", dueDate: "2026-11-14", priority: "P1", space: "Prywatne", project: null });
    assert.equal(open.body.data.tasks[0].description, undefined, "descriptions stay in the app");
    assert.deepEqual((await ctx.run("tasks.list", { date: "2026-11-14" })).body.data.tasks.map(t => t.id), [1]);
    assert.deepEqual((await ctx.run("tasks.list", { status: "done", from: "2026-11-11", to: "2026-11-11" })).body.data.tasks.map(t => t.id), [3], "finished that day");
    assert.deepEqual((await ctx.run("tasks.list", { space: "dom" })).body.data.tasks.map(t => t.id), [2]);
    assert.deepEqual((await ctx.run("tasks.list", { query: "Matowa" })).body.data.tasks.map(t => t.id), [2]);
    assert.equal((await ctx.run("tasks.list", { status: "all" })).body.data.total, 4);
    assert.equal((await ctx.run("tasks.list", { status: "busy" })).status, 400);
    rows.push(...Array.from({ length: 30 }, (_, i) => task(10 + i, `Zadanie ${i}`)));
    const many = await ctx.run("tasks.list", {});
    assert.deepEqual([many.body.data.total, many.body.data.tasks.length], [32, 25]);
    assert.match(many.body.summary, /; i jeszcze 7$/);
  } finally { await ctx.close(); }
});

test("tasks.set_status: through the board's move (history, end of the column); Cofnij back before its old neighbour, only from there", async () => {
  const rows = [task(1, "Kupić olej"), task(2, "Kupić farbę"), task(3, "Chleb"), task(4, "Mleko", { status: "done", position: 0 }),
    task(5, "Stary rachunek", { status: "done", archivedAt: "2026-10-01T00:00:00.000Z" })];
  const { pool, history } = fakeTasks(rows);
  const ctx = await assistant(pool);
  try {
    const ambiguous = await ctx.run("tasks.set_status", { task: "kupić", status: "done" });
    assert.deepEqual([ambiguous.status, ambiguous.body.message],
      [400, "Which task? 1: Kupić olej (ToDo, 2026-11-12); 2: Kupić farbę (ToDo, 2026-11-12). Ask the owner, then give the id."]);
    assert.deepEqual(await ctx.run("tasks.set_status", { task: "kosmos", status: "done" }), { status: 404, body: { message: "No task \"kosmos\"" } });
    const archived = await ctx.run("tasks.set_status", { task: "rachunek", status: "todo" });
    assert.match(archived.body.message, /is in the archive .*tasks\.restore_task/);
    assert.equal((await ctx.run("tasks.set_status", { task: "olej", status: "finished" })).status, 400, "only the board's columns");

    const done = await ctx.run("tasks.set_status", { task: "kupić olej", status: "done" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.summary, "„Kupić olej” → Zakończone");
    assert.deepEqual(done.body.data, { id: 1, title: "Kupić olej", status: "done", previous: "todo" });
    assert.deepEqual([rows[0].status, rows[0].completed], ["done", true]);
    assert.deepEqual(history.at(-1), { taskId: 1, fields: ["status"], old: ["todo"], new: ["done"], actor: "owner" });
    const sorted = status => rows.filter(row => row.status === status && !row.archivedAt).sort((a, b) => a.position - b.position).map(row => row.id);
    assert.deepEqual(sorted("done"), [4, 1], "the end of the column");
    assert.equal((await ctx.run("tasks.set_status", { task: "1", status: "done" })).body.undo, null, "already there: nothing to undo");

    assert.deepEqual(await ctx.undo(done.body.undo), { status: 200, body: { summary: "Cofnięto: „Kupić olej” → ToDo" } });
    assert.deepEqual(sorted("todo"), [1, 2, 3], "before the task that was below it");
    assert.equal((await ctx.undo(done.body.undo)).status, 409, "no longer where the assistant put it");

    // "przywróć z zrobionych": the finished one is meant when moving to ToDo
    const back = await ctx.run("tasks.set_status", { task: "mleko", status: "todo" });
    assert.deepEqual([back.status, rows[3].status], [200, "todo"]);
    const started = await ctx.run("tasks.set_status", { task: "chleb", status: "in_progress" });
    rows[2].status = "done";
    assert.equal((await ctx.undo(started.body.undo)).status, 409, "the owner moved it on since");
  } finally { await ctx.close(); }
});

test("tasks.update_task: the app's PATCH with the owner's words; Cofnij puts the old values back while they are as left", async () => {
  const rows = [task(1, "Kupić olej", { dueDate: "2026-11-14" }), task(2, "Opis", { description: "x".repeat(3000) })];
  const projects = [{ id: 9, name: "Remont", spaceId: 3, spaceName: "Dom" }];
  const assignees = [{ id: 4, name: "Ania", account: null }];
  const { pool, writes } = fakeTasks(rows, { projects, assignees });
  const ctx = await assistant(pool);
  try {
    const changed = await ctx.run("tasks.update_task", { task: "olej", title: "Kupić olej 5W30", dueDate: "2026-11-20", priority: "P0", assignee: "ania" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.summary, "Zmieniono „Kupić olej”: tytuł: Kupić olej 5W30 · termin 2026-11-20 · P0 · wykonawca: Ania");
    assert.deepEqual([rows[0].title, rows[0].dueDate, rows[0].priority, rows[0].assigneeId], ["Kupić olej 5W30", "2026-11-20", "P0", 4]);
    assert.ok(writes.some(sql => sql.startsWith("UPDATE tasks SET title = $1")), "the app's own update");
    assert.deepEqual(changed.body.data.changed, ["title", "priority", "dueDate", "assigneeId"]);

    assert.deepEqual(await ctx.undo(changed.body.undo), { status: 200, body: { summary: "Cofnięto zmiany: Kupić olej 5W30" } });
    assert.deepEqual([rows[0].title, rows[0].dueDate, rows[0].priority, rows[0].assigneeId], ["Kupić olej", "2026-11-14", "P2", null]);

    const again = await ctx.run("tasks.update_task", { task: "olej", dueDate: "none" });
    assert.equal(again.body.summary, "Zmieniono „Kupić olej”: bez terminu");
    rows[0].dueDate = "2026-12-01";
    assert.equal((await ctx.undo(again.body.undo)).status, 409, "the owner changed it since");
    assert.equal(rows[0].dueDate, "2026-12-01");

    assert.equal((await ctx.run("tasks.update_task", { task: "olej" })).status, 400, "nothing to change");
    assert.equal((await ctx.run("tasks.update_task", { task: "olej", dueDate: "2026-02-30" })).body.message, "Invalid due date");
    assert.equal((await ctx.run("tasks.update_task", { task: "olej", dueDate: "jutro" })).status, 400);
    assert.equal((await ctx.run("tasks.update_task", { task: "olej", project: "remont", space: "Praca" })).body.message,
      "Project \"Remont\" belongs to the space \"Dom\"");
    assert.equal((await ctx.run("tasks.update_task", { task: "olej", assignee: "Kasia" })).body.message, "Unknown assignee \"Kasia\". Known: Ania");
    assert.equal((await ctx.run("tasks.update_task", { task: "olej", priority: "P2" })).body.summary, "„Kupić olej”: bez zmian");
    const long = await ctx.run("tasks.update_task", { task: "opis", description: "krótko" });
    assert.deepEqual([long.status, long.body.undo, rows[1].description], [200, null, "krótko"], "a long old description does not fit Cofnij's token");
  } finally { await ctx.close(); }
});

test("tasks.restore_task: from the archive to ToDo; Cofnij returns it to the archive as it was", async () => {
  const rows = [task(1, "Rachunek", { status: "done", completed: true, completedAt: "2026-10-01T08:00:00.000Z", archivedAt: "2026-10-08T08:00:00.000Z", position: 7 })];
  const { pool } = fakeTasks(rows);
  const ctx = await assistant(pool);
  try {
    const restored = await ctx.run("tasks.restore_task", { task: "rachunek" });
    assert.equal(restored.body.summary, "Przywrócono z archiwum: „Rachunek” → ToDo");
    assert.deepEqual([rows[0].status, rows[0].archivedAt], ["todo", null]);
    assert.equal((await ctx.run("tasks.restore_task", { task: "rachunek" })).status, 404, "on the board now");
    assert.deepEqual(await ctx.undo(restored.body.undo), { status: 200, body: { summary: "Cofnięto: „Rachunek” wraca do archiwum" } });
    assert.deepEqual([rows[0].status, rows[0].completedAt, rows[0].archivedAt, rows[0].position], ["done", "2026-10-01T08:00:00.000Z", "2026-10-08T08:00:00.000Z", 7]);
    assert.equal((await ctx.undo(restored.body.undo)).status, 409);
  } finally { await ctx.close(); }
});

test("tasks.set_subtask: ticks one by part of its title; Cofnij unticks only while still ticked", async () => {
  const subtasks = [{ id: 7, taskId: 1, title: "Kupić farbę", done: false }, { id: 8, taskId: 1, title: "Kupić płytki", done: false }];
  const { pool, writes } = fakeTasks([task(1, "Remont")], { subtasks });
  const ctx = await assistant(pool);
  try {
    assert.match((await ctx.run("tasks.set_subtask", { task: "remont", subtask: "kupić" })).body.message, /^Which subtask\? 7: Kupić farbę; 8: Kupić płytki/);
    const ticked = await ctx.run("tasks.set_subtask", { task: "remont", subtask: "farb" });
    assert.equal(ticked.body.summary, "✓ Kupić farbę · „Remont”");
    assert.equal(subtasks[0].done, true);
    assert.equal((await ctx.run("tasks.set_subtask", { task: "remont", subtask: "farb" })).body.undo, null);
    assert.deepEqual(await ctx.undo(ticked.body.undo), { status: 200, body: { summary: "Cofnięto: Kupić farbę" } });
    assert.match(writes.at(-1), /AND done = true RETURNING/);
    assert.equal(subtasks[0].done, false);
    assert.equal((await ctx.undo(ticked.body.undo)).status, 409);
  } finally { await ctx.close(); }
});

test("tasks.add_note and tasks.add_subtask: through the app's own inserts; Cofnij deletes them while unchanged", async () => {
  const notes = [];
  const subtasks = [];
  const { pool } = fakeTasks([task(1, "Remont łazienki")], { notes, subtasks });
  const ctx = await assistant(pool);
  try {
    const note = await ctx.run("tasks.add_note", { task: "łazienk", text: "  Czekam na fachowca " });
    assert.deepEqual([note.body.summary, notes.map(n => n.body)], ["Notatka do „Remont łazienki”", ["Czekam na fachowca"]]);
    assert.equal((await ctx.run("tasks.add_note", { task: "łazienk", text: "   " })).status, 400);
    notes[0].body = "Zmieniona";
    assert.equal((await ctx.undo(note.body.undo)).status, 409, "the owner edited it");
    notes[0].body = "Czekam na fachowca";
    assert.deepEqual(await ctx.undo(note.body.undo), { status: 200, body: { summary: "Cofnięto notatkę do: Remont łazienki" } });
    assert.deepEqual(notes, []);

    const added = await ctx.run("tasks.add_subtask", { task: "remont", title: "Kupić farbę" });
    assert.deepEqual([added.body.summary, subtasks.map(st => st.title)], ["Podzadanie: Kupić farbę · do „Remont łazienki”", ["Kupić farbę"]]);
    subtasks[0].done = true;
    assert.equal((await ctx.undo(added.body.undo)).status, 409, "a ticked subtask stays");
    subtasks[0].done = false;
    assert.deepEqual(await ctx.undo(added.body.undo), { status: 200, body: { summary: "Cofnięto podzadanie: Kupić farbę" } });
    subtasks.push(...Array.from({ length: 100 }, (_, i) => ({ id: 200 + i, taskId: 1, title: `P${i}`, done: false })));
    assert.deepEqual(await ctx.run("tasks.add_subtask", { task: "remont", title: "Jeszcze jedno" }), { status: 409, body: { message: "Too many subtasks" } });
  } finally { await ctx.close(); }
});
