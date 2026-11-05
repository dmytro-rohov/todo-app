// Runs against a real, disposable PostgreSQL. Skipped unless both URLs are set:
//   TEST_MIGRATION_DATABASE_URL  schema owner (e.g. tasks_owner)
//   TEST_DATABASE_URL            application role (e.g. tasks_app)
//   TEST_APP_DB_ROLE             application role name (default tasks_app)
// deploy/compose.test.yaml provides such a database; see docs/PRODUCTION.md.
// The schema is DROPPED between tests, so only local *test* databases are accepted.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, AUTH, SAME_ORIGIN_JSON, USERNAME, passwordHashPromise } = require("./support");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const APP_ROLE = process.env.TEST_APP_DB_ROLE || "tasks_app";
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const SHIPPED = listMigrations(MIGRATIONS_DIR);
const VERSIONS = SHIPPED.map(m => m.hash);
const TAGS = SHIPPED.map(m => m.version);

function assertDisposable(url) {
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1", "db"].includes(parsed.hostname);
  if (!local || !/test/.test(parsed.pathname)) {
    throw new Error(`Refusing to run destructive tests against ${parsed.hostname}${parsed.pathname}`);
  }
}

const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;

describe("PostgreSQL integration", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  const quiet = () => {};

  before(() => {
    assertDisposable(OWNER_URL);
    assertDisposable(APP_URL);
    owner = createPool({ connectionString: OWNER_URL, max: 5, statementTimeoutMs: 0 });
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
  });

  const migrate = (options = {}) =>
    runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: quiet, ...options });

  test("readiness fails before migrations and passes after", async () => {
    const ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    try {
      assert.equal((await ctx.request("/readyz", { auth: null })).status, 503);
      await migrate();
      assert.equal((await ctx.request("/readyz", { auth: null })).status, 200);
    } finally {
      await ctx.close();
    }
  });

  test("migrations are idempotent", async () => {
    assert.deepEqual(await migrate(), TAGS);
    assert.deepEqual(await migrate(), []);
    const ledger = await owner.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at");
    assert.deepEqual(ledger.rows.map(r => r.hash), VERSIONS);
  });

  test("concurrent migrators serialize on the advisory lock", async () => {
    const pools = [1, 2, 3].map(() => createPool({ connectionString: OWNER_URL, max: 1, statementTimeoutMs: 0 }));
    try {
      const results = await Promise.all(pools.map(pool =>
        runMigrations(pool, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: quiet })));
      // exactly one run applied everything; the others found nothing pending
      assert.deepEqual(results.map(r => r.length).sort(), [0, 0, TAGS.length]);
    } finally {
      await Promise.all(pools.map(pool => pool.end()));
    }
  });

  test("a modified, already-applied migration is refused", async () => {
    await migrate();
    await owner.query("UPDATE drizzle.__drizzle_migrations SET hash = 'tampered' WHERE hash = $1", [VERSIONS[0]]);
    await assert.rejects(migrate(), /was modified after it was applied/);
  });

  test("a failing migration rolls back completely and can be retried", async () => {
    await migrate();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
    try {
      fs.cpSync(MIGRATIONS_DIR, dir, { recursive: true });
      const journalPath = path.join(dir, "meta", "_journal.json");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const last = journal.entries[journal.entries.length - 1];
      journal.entries.push({ idx: journal.entries.length, version: "7", when: last.when + 1000, tag: "9999_broken", breakpoints: true });
      fs.writeFileSync(journalPath, JSON.stringify(journal));
      fs.writeFileSync(path.join(dir, "9999_broken.sql"),
        'ALTER TABLE "tasks" ADD COLUMN "broken_marker" integer;--> statement-breakpoint\nSELECT * FROM no_such_table;');

      await assert.rejects(migrate({ dir }), /no_such_table/);
      const ledger = await owner.query("SELECT hash FROM drizzle.__drizzle_migrations");
      assert.equal(ledger.rowCount, VERSIONS.length); // the shipped migrations stay, the broken one left no trace
      const column = await owner.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'broken_marker'");
      assert.equal(column.rowCount, 0);

      assert.deepEqual(await migrate(), []); // the shipped release still migrates cleanly
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an older release tolerates newer migrations in the database (app rollback)", async () => {
    await migrate();
    await owner.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('future-hash', 99999999999999)");
    const messages = [];
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: m => messages.push(m) });
    assert.ok(messages.some(m => m.includes("future-hash")));
  });

  test("the application role has data access only", async () => {
    await migrate();
    await appPool.query("INSERT INTO categories (name, color) VALUES ('Dom', '#22c55e')");
    await assert.rejects(appPool.query("CREATE TABLE public.intruder (id int)"), /permission denied/);
    await assert.rejects(appPool.query("DROP TABLE public.tasks"), /must be owner|permission denied/);
    await assert.rejects(appPool.query("ALTER TABLE public.tasks ADD COLUMN x int"), /must be owner|permission denied/);
    await assert.rejects(appPool.query("TRUNCATE public.tasks"), /permission denied/);
    await assert.rejects(appPool.query("DELETE FROM drizzle.__drizzle_migrations"), /permission denied/);
  });

  test("schema enforces integrity", async () => {
    await migrate();
    const fks = await owner.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.tasks'::regclass AND contype = 'f'`);
    assert.deepEqual(fks.rows.map(r => r.conname).sort(),
      ["tasks_assignee_id_assignees_id_fk", "tasks_category_id_categories_id_fk", "tasks_project_id_projects_id_fk", "tasks_space_id_spaces_id_fk"]);
    await assert.rejects(
      owner.query("INSERT INTO tasks (title, completed, date) VALUES ('x', NULL, '2026-10-30')"),
      /null value/);
  });

  test("CRUD over HTTP persists across an application restart", async () => {
    await migrate();

    let ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    let taskId;
    try {
      const category = await (await ctx.request("/api/categories", {
        method: "POST", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ name: "Praca", color: "#4e45e4" })
      })).json();

      const created = await ctx.request("/api/tasks", {
        method: "POST",
        headers: SAME_ORIGIN_JSON,
        body: JSON.stringify({ title: "<img src=x onerror=alert(1)>", date: "2026-10-30", categoryId: category.id })
      });
      assert.equal(created.status, 201);
      taskId = (await created.json()).id;

      const updated = await ctx.request(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: SAME_ORIGIN_JSON,
        body: JSON.stringify({ title: "<img src=x onerror=alert(1)>", date: "2026-10-30", completed: true, categoryId: category.id })
      });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).completed, true);

      // deleting the category keeps the task but clears its category
      assert.equal((await ctx.request(`/api/categories/${category.id}`, { method: "DELETE", headers: SAME_ORIGIN_JSON })).status, 200);
    } finally {
      await ctx.close();
    }

    // "restart": brand-new pool and app instance
    const freshPool = createPool({ connectionString: APP_URL, max: 2 });
    ctx = await startApp({ pool: freshPool, migrationVersions: VERSIONS });
    try {
      const tasks = await (await ctx.request("/api/tasks")).json();
      assert.equal(tasks.length, 1);
      assert.deepEqual(tasks[0], {
        id: taskId,
        title: "<img src=x onerror=alert(1)>", // stored verbatim; escaped at render time
        completed: true,
        date: "2026-10-30",
        categoryId: null,
        description: "",
        status: "done",
        priority: "P2",
        position: String(taskId), // bigint arrives as a string from pg
        dueDate: null, // a new task has no due date unless one is given
        createdAt: tasks[0].createdAt,
        updatedAt: tasks[0].updatedAt,
        completedAt: tasks[0].completedAt,
        archivedAt: null,
        spaceId: tasks[0].spaceId, // the built-in private space
        projectId: null,
        assigneeId: null,
        reviewRequestedAt: null,
        labelIds: [],
        subtaskCount: 0,
        subtaskDoneCount: 0,
        noteCount: 0,
        trackedSeconds: 0,
        timerStartedAt: null
      });
      const spaces = await (await ctx.request("/api/spaces")).json();
      assert.equal(spaces.find(space => space.key === "private").id, tasks[0].spaceId);

      assert.equal((await ctx.request("/api/tasks/date/2026-10-30", { method: "DELETE", headers: SAME_ORIGIN_JSON })).status, 200);
      assert.deepEqual(await (await ctx.request("/api/tasks")).json(), []);
    } finally {
      await ctx.close();
      await freshPool.end();
    }
  });

  test("application rules replace the former trigger: completion, position, timestamps", async () => {
    await migrate();
    const ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    try {
      const send = (url, method, body) => ctx.request(url, { method, headers: SAME_ORIGIN_JSON, body: JSON.stringify(body) });
      const open = await (await send("/api/tasks", "POST", { title: "Open task", date: "2026-10-30" })).json();
      assert.deepEqual([open.status, open.completed, open.completedAt, String(open.position)], ["todo", false, null, String(open.id)]);
      const done = await (await send("/api/tasks", "POST", { title: "Done task", date: "2026-10-31", completed: true })).json();
      assert.deepEqual([done.status, done.completed, String(done.position)], ["done", true, String(done.id)]);
      assert.ok(done.completedAt);

      // PUT completed:false reopens a done task; PUT completed:true completes an open one
      const reopened = await (await send(`/api/tasks/${done.id}`, "PUT", { title: "Done task", date: "2026-10-31", completed: false })).json();
      assert.deepEqual([reopened.status, reopened.completed, reopened.completedAt], ["todo", false, null]);
      const closed = await (await send(`/api/tasks/${open.id}`, "PUT", { title: "Open task", date: "2026-10-30", completed: true })).json();
      assert.deepEqual([closed.status, closed.completed], ["done", true]);
      assert.ok(closed.completedAt);
      assert.ok(new Date(closed.updatedAt) >= new Date(open.updatedAt));

      // a PUT that leaves completion unchanged keeps a custom status
      const progress = await (await send(`/api/tasks/${reopened.id}`, "PATCH", { status: "in_progress" })).json();
      assert.deepEqual([progress.status, progress.completed], ["in_progress", false]);
      const kept = await (await send(`/api/tasks/${reopened.id}`, "PUT", { title: "Done task", date: "2026-10-31", completed: false })).json();
      assert.equal(kept.status, "in_progress");

      // moving between columns keeps completed / completed_at consistent
      const snapshot = (await (await ctx.request("/api/tasks")).json()).map(({ id, status, position }) => ({ id, status, position: Number(position) }));
      assert.equal((await send("/api/tasks/move", "POST", { id: reopened.id, status: "done", beforeId: null, expected: snapshot })).status, 200);
      const rows = await owner.query("SELECT id, completed, status, completed_at FROM tasks ORDER BY id");
      for (const row of rows.rows) assert.equal(row.completed, row.status === "done");
      assert.ok(rows.rows.find(row => row.id === reopened.id).completed_at);
    } finally { await ctx.close(); }
  });

  test("concurrent moves serialize snapshots and preserve every task exactly once", async () => {
    await migrate();
    const ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    try {
      const ids = [];
      for (const title of ["Move A", "Move B", "Move C"]) {
        const response = await ctx.request("/api/tasks", { method: "POST", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ title, date: "2026-10-31" }) });
        ids.push((await response.json()).id);
      }
      const snapshot = (await (await ctx.request("/api/tasks")).json()).map(({ id, status, position }) => ({ id, status, position: Number(position) }));
      const requests = [ids[0], ids[1]].map(id => ctx.request("/api/tasks/move", { method: "POST", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ id, status: "done", beforeId: null, expected: snapshot }) }));
      const results = await Promise.all(requests);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      const finalRows = await (await ctx.request("/api/tasks")).json();
      assert.deepEqual(finalRows.map(row => row.id).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
      assert.equal(new Set(finalRows.map(row => row.id)).size, ids.length);
    } finally { await ctx.close(); }
  });

  test("Kanban task contract supports filters, completion lifecycle, null due dates, and errors", async () => {
    await migrate();
    const ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS });
    try {
      const create = async body => ctx.request("/api/tasks", { method: "POST", headers: SAME_ORIGIN_JSON, body: JSON.stringify(body) });
      const first = await create({ title: "Kanban one", date: "2026-10-31", status: "todo", priority: "P1", dueDate: null });
      assert.equal(first.status, 201);
      const task = await first.json();
      assert.equal(task.completed, false);
      assert.equal(task.status, "todo");
      assert.equal(task.dueDate, null);
      assert.equal(task.completedAt, null);
      const second = await create({ title: "Kanban two", date: "2026-11-01", completed: true });
      assert.equal(second.status, 201);
      const done = await second.json();
      assert.equal(done.status, "done");
      assert.ok(done.completedAt);
      const completed = await ctx.request("/api/tasks?status=done&priority=P2");
      assert.equal(completed.status, 200);
      assert.deepEqual((await completed.json()).map(row => row.id), [done.id]);
      assert.equal((await ctx.request("/api/tasks?status=invalid")).status, 400);
      assert.equal((await ctx.request("/api/tasks?categoryId=bad")).status, 400);
      const reopened = await ctx.request(`/api/tasks/${done.id}`, { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ status: "todo", dueDate: null }) });
      assert.equal(reopened.status, 200);
      const reopenedTask = await reopened.json();
      assert.equal(reopenedTask.completed, false);
      assert.equal(reopenedTask.completedAt, null);
      assert.equal(reopenedTask.dueDate, null);
      assert.equal((await ctx.request("/api/tasks/not-an-id", { method: "PATCH", headers: SAME_ORIGIN_JSON, body: "{}" })).status, 400);
      assert.equal((await ctx.request("/api/tasks/999999", { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ status: "todo" }) })).status, 404);
      assert.equal((await ctx.request(`/api/tasks/${task.id}`, { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ status: "bad" }) })).status, 400);
    } finally { await ctx.close(); }
  });

  test("server.js shuts down gracefully on SIGTERM and data survives a process restart", async () => {
    await migrate();
    const env = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: APP_URL,
      AUTH_USERNAME: USERNAME,
      AUTH_PASSWORD_HASH: await passwordHashPromise,
      PUBLIC_ORIGIN: "https://task.mytko.dev",
      HOST: "127.0.0.1",
      PORT: String(30000 + Math.floor(Math.random() * 20000)),
      SHUTDOWN_TIMEOUT_MS: "5000"
    };
    const base = `http://127.0.0.1:${env.PORT}`;

    const first = await startServer(env, base);
    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { authorization: AUTH, ...SAME_ORIGIN_JSON },
      body: JSON.stringify({ title: "Przetrwa restart", date: "2026-10-30" })
    });
    assert.equal(created.status, 201);
    assert.equal(await stopServer(first), 0);

    const second = await startServer(env, base);
    try {
      const tasks = await (await fetch(`${base}/api/tasks`, { headers: { authorization: AUTH } })).json();
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].title, "Przetrwa restart");
    } finally {
      assert.equal(await stopServer(second), 0);
    }
  });
});

async function startServer(env, base) {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: "ignore" });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${base}/readyz`)).ok) return child;
    } catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill("SIGKILL");
  throw new Error("server did not become ready");
}

function stopServer(child) {
  return new Promise(resolve => {
    child.once("exit", code => resolve(code));
    child.kill("SIGTERM");
  });
}
