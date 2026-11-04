// Mytko Tasks 1.0 core (migration 005) against a real, disposable PostgreSQL. Same contract as integration.test.js:
// skipped unless TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL are set; only local *test* databases are accepted.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON } = require("./support");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const APP_ROLE = process.env.TEST_APP_DB_ROLE || "tasks_app";
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.version);
const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;

function assertDisposable(url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(parsed.hostname) || !/test/.test(parsed.pathname)) {
    throw new Error(`Refusing to run destructive tests against ${parsed.hostname}${parsed.pathname}`);
  }
}

describe("Tasks 1.0 core on PostgreSQL", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  const quiet = () => {};
  const migrate = (options = {}) => runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: quiet, ...options });

  before(() => {
    assertDisposable(OWNER_URL);
    assertDisposable(APP_URL);
    owner = createPool({ connectionString: OWNER_URL, max: 5, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
  });
  after(async () => { await owner?.end(); await appPool?.end(); });
  beforeEach(async () => {
    await owner.query("DROP TABLE IF EXISTS public.task_history, public.task_subtasks, public.task_labels, public.tasks, public.categories, public.projects, public.assignees, public.schema_migrations CASCADE");
    await owner.query("DROP FUNCTION IF EXISTS public.record_task_history() CASCADE");
  });

  async function withApp(fn) {
    await migrate();
    const ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    const call = async (method, route, body) => {
      const res = await ctx.request(`/api${route}`, { method, headers: SAME_ORIGIN_JSON, ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    try { return await fn(call); } finally { await ctx.close(); }
  }
  const history = async taskId => (await owner.query("SELECT field, old_value, new_value, actor FROM task_history WHERE task_id=$1 ORDER BY id", [taskId])).rows;

  test("005 upgrades a populated V2 database without rewriting any existing data", async () => {
    const v2 = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-v2-"));
    try {
      for (const m of listMigrations(MIGRATIONS_DIR).filter(m => m.version < "005")) {
        fs.writeFileSync(path.join(v2, `${m.version}.sql`), m.sql ?? fs.readFileSync(path.join(MIGRATIONS_DIR, `${m.version}.sql`), "utf8"));
      }
      assert.deepEqual(await migrate({ dir: v2 }), ["001_baseline", "002_task_integrity", "003_kanban", "004_tasks_v2"]);
      await owner.query("INSERT INTO categories(name,color) VALUES ('Praca','#112233'),('Dom','#aabbcc')");
      await owner.query("INSERT INTO projects(name) VALUES ('Klient A')");
      await owner.query(`INSERT INTO tasks(title,completed,date,category_id,description,status,priority,due_date,position,project_id)
        VALUES ('Zadanie jeden',false,'2026-10-30',1,'opis','in_progress','P1','2026-11-02',0,1),
               ('Zadanie dwa',true,'2026-10-31',2,'','done','P3',NULL,1,NULL)`);
      const before = (await owner.query("SELECT id,title,completed,date::text,category_id,description,status,priority,due_date::text,position,project_id,assignee_id,created_at,updated_at,completed_at,archived_at FROM tasks ORDER BY id")).rows;
      assert.equal(before.length, 2);

      assert.deepEqual(await migrate(), ["005_tasks_1_0_core"]);

      const after = (await owner.query("SELECT id,title,completed,date::text,category_id,description,status,priority,due_date::text,position,project_id,assignee_id,created_at,updated_at,completed_at,archived_at FROM tasks ORDER BY id")).rows;
      assert.deepEqual(after, before, "no existing column of any existing row changed");
      const added = (await owner.query("SELECT space,start_date,estimate_minutes FROM tasks ORDER BY id")).rows;
      assert.deepEqual(added.map(r => r.space), ["private", "private"], "existing rows fail closed to private");
      assert.ok(added.every(r => r.start_date === null && r.estimate_minutes === null));
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_history")).rows[0].n, 0, "history starts empty; nothing is back-filled");
      assert.deepEqual(await migrate(), [], "idempotent");
    } finally { fs.rmSync(v2, { recursive: true, force: true }); }
  });

  test("new tasks default to PRIVATE and space, start date and estimate are validated end to end", async () => {
    await withApp(async call => {
      const created = await call("POST", "/tasks", { title: "Prywatne zadanie", date: "2026-11-05" });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.space, "private");
      assert.deepEqual([created.body.startDate, created.body.estimateMinutes, created.body.subtaskTotal, created.body.subtaskDone], [null, null, 0, 0]);
      const work = await call("POST", "/tasks", { title: "Zadanie klienta", date: "2026-11-05", space: "work", startDate: "2026-11-03", dueDate: "2026-11-06", estimateMinutes: 90 });
      assert.equal(work.status, 201, JSON.stringify(work.body));
      assert.deepEqual([work.body.space, work.body.startDate, work.body.dueDate, work.body.estimateMinutes], ["work", "2026-11-03", "2026-11-06", 90]);
      assert.deepEqual((await call("GET", "/tasks?space=work")).body.map(t => t.id), [work.body.id]);
      assert.deepEqual((await call("GET", "/tasks?space=private")).body.map(t => t.id), [created.body.id]);
      assert.equal((await call("GET", "/tasks?space=other")).status, 400);
      for (const bad of [{ space: "team" }, { estimateMinutes: 0 }, { estimateMinutes: 10081 }, { estimateMinutes: 1.5 }, { startDate: "2026-02-30" }, { startDate: "2026-11-09", dueDate: "2026-11-06" }]) {
        assert.equal((await call("PATCH", `/tasks/${work.body.id}`, bad)).status, 400, JSON.stringify(bad));
      }
      assert.equal((await call("PATCH", `/tasks/${work.body.id}`, { space: "private", estimateMinutes: null, startDate: null })).body.space, "private");
      // the database itself refuses an inconsistent window, whatever the API does
      await assert.rejects(owner.query("UPDATE tasks SET start_date='2026-12-01', due_date='2026-11-01' WHERE id=$1", [work.body.id]), /tasks_start_before_due/);
    });
  });

  test("history is written by the database for every write path and is invisible noise-free", async () => {
    await withApp(async call => {
      const a = (await call("POST", "/tasks", { title: "Pierwsze", date: "2026-11-05", status: "todo" })).body;
      const b = (await call("POST", "/tasks", { title: "Drugie", date: "2026-11-05", status: "todo" })).body;
      assert.deepEqual((await history(a.id)).map(h => h.field), ["created"]);
      await call("PATCH", `/tasks/${a.id}`, { status: "in_progress", priority: "P0", space: "work" });
      await call("PATCH", `/tasks/${a.id}`, { title: "Pierwsze (zmienione)" });
      await call("PATCH", `/tasks/${a.id}`, { priority: "P0" }); // unchanged -> nothing recorded
      const fields = (await history(a.id)).map(h => h.field);
      assert.deepEqual(fields, ["created", "priority", "space", "status", "title"].sort((x, y) => fields.indexOf(x) - fields.indexOf(y)).filter(f => fields.includes(f)));
      assert.deepEqual([...fields].sort(), ["created", "priority", "space", "status", "title"]);
      const status = (await history(a.id)).find(h => h.field === "status");
      assert.deepEqual([status.old_value, status.new_value, status.actor], ["todo", "in_progress", "owner"]);
      // drag-and-drop reorder inside a column rewrites positions but is NOT a change worth recording
      const list = (await call("GET", "/tasks")).body;
      const token = require("node:crypto").createHash("sha256").update(JSON.stringify(list.map(t => [Number(t.id), t.status, Number(t.position)]).sort((x, y) => x[0] - y[0]))).digest("hex");
      const before = (await history(b.id)).length;
      const move = await call("POST", "/tasks/move", { id: b.id, status: "todo", beforeId: null, expected: token });
      assert.equal(move.status, 200, JSON.stringify(move.body));
      assert.equal((await history(b.id)).length, before, "position-only moves are not logged");
      // a status change through the move path IS logged
      const list2 = (await call("GET", "/tasks")).body;
      const token2 = require("node:crypto").createHash("sha256").update(JSON.stringify(list2.map(t => [Number(t.id), t.status, Number(t.position)]).sort((x, y) => x[0] - y[0]))).digest("hex");
      assert.equal((await call("POST", "/tasks/move", { id: b.id, status: "done", beforeId: null, expected: token2 })).status, 200);
      assert.ok((await history(b.id)).some(h => h.field === "status" && h.new_value === "done"));
      // archive/restore is recorded too
      await owner.query("UPDATE tasks SET archived_at = now() WHERE id=$1", [a.id]);
      assert.ok((await history(a.id)).some(h => h.field === "archived_at"));
      const api = (await call("GET", `/tasks/${a.id}/history`)).body;
      assert.ok(api.length >= 5 && api[0].changedAt && "oldValue" in api[0]);
      assert.equal((await call("GET", "/tasks/999999/history")).status, 404);
    });
  });

  test("the application role can READ history but can neither forge nor erase it", async () => {
    await withApp(async call => {
      const task = (await call("POST", "/tasks", { title: "Audytowane", date: "2026-11-05" })).body;
      assert.equal((await appPool.query("SELECT count(*)::int AS n FROM task_history WHERE task_id=$1", [task.id])).rows[0].n, 1);
      for (const sql of [
        `INSERT INTO task_history(task_id, field) VALUES (${task.id}, 'forged')`,
        `UPDATE task_history SET new_value='x'`, `DELETE FROM task_history`, `TRUNCATE task_history`,
        "DROP TABLE task_history", "ALTER TABLE tasks DISABLE TRIGGER tasks_history",
        "SELECT public.record_task_history()"
      ]) await assert.rejects(appPool.query(sql), /permission denied|must be owner|trigger functions can only/i, sql);
    });
  });

  test("subtasks: lifecycle, progress counters, isolation between tasks and cascade", async () => {
    await withApp(async call => {
      const t1 = (await call("POST", "/tasks", { title: "Zadanie z checklistą", date: "2026-11-05" })).body;
      const t2 = (await call("POST", "/tasks", { title: "Inne zadanie", date: "2026-11-05" })).body;
      const s1 = await call("POST", `/tasks/${t1.id}/subtasks`, { title: "  Krok pierwszy  " });
      assert.equal(s1.status, 201, JSON.stringify(s1.body));
      assert.deepEqual([s1.body.title, s1.body.done, s1.body.position, s1.body.taskId], ["Krok pierwszy", false, 0, t1.id]);
      const s2 = (await call("POST", `/tasks/${t1.id}/subtasks`, { title: "Krok drugi", done: true })).body;
      assert.deepEqual([s2.position, s2.done], [1, true]);
      assert.ok(s2.completedAt);
      let task = (await call("GET", "/tasks")).body.find(t => t.id === t1.id);
      assert.deepEqual([task.subtaskTotal, task.subtaskDone], [2, 1]);
      const done = await call("PATCH", `/subtasks/${s1.body.id}`, { done: true });
      assert.equal(done.status, 200);
      assert.ok(done.body.completedAt);
      const undone = (await call("PATCH", `/subtasks/${s1.body.id}`, { done: false })).body;
      assert.equal(undone.completedAt, null);
      assert.equal((await call("PATCH", `/subtasks/${s1.body.id}`, { title: "Nowy tytuł", position: 5 })).body.position, 5);
      for (const bad of [{}, { done: "yes" }, { title: "   " }, { title: "x".repeat(201) }, { position: -1 }, { taskId: t2.id }, { unknown: 1 }]) {
        assert.equal((await call("PATCH", `/subtasks/${s1.body.id}`, bad)).status, 400, JSON.stringify(bad));
      }
      assert.equal((await call("POST", `/tasks/${t1.id}/subtasks`, { title: 5 })).status, 400);
      assert.equal((await call("POST", `/tasks/999999/subtasks`, { title: "Sierota" })).status, 404);
      assert.equal((await call("PATCH", `/subtasks/999999`, { done: true })).status, 404);
      assert.equal((await call("GET", `/tasks/${t2.id}/subtasks`)).body.length, 0, "another task's list stays empty");
      assert.equal((await call("DELETE", `/subtasks/${s2.id}`)).status, 200);
      assert.equal((await call("DELETE", `/subtasks/${s2.id}`)).status, 404);
      assert.equal((await call("DELETE", `/tasks/${t1.id}`)).status, 200);
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_subtasks")).rows[0].n, 0, "subtasks cascade with their task");
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_history WHERE task_id=$1", [t1.id])).rows[0].n, 0);
    });
  });

  test("the subtask cap holds under concurrent adds", async () => {
    await withApp(async call => {
      const task = (await call("POST", "/tasks", { title: "Duża lista", date: "2026-11-05" })).body;
      await owner.query("INSERT INTO task_subtasks(task_id,title,position) SELECT $1, 'x'||g, g FROM generate_series(0,97) g", [task.id]);
      const results = await Promise.all([1, 2, 3, 4, 5].map(i => call("POST", `/tasks/${task.id}/subtasks`, { title: `równoległy ${i}` })));
      assert.equal(results.filter(r => r.status === 201).length, 2, "exactly the two free slots are used");
      assert.equal(results.filter(r => r.status === 409).length, 3);
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM task_subtasks WHERE task_id=$1", [task.id])).rows[0].n, 100);
    });
  });
});
