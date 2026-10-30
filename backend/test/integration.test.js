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
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.version);

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
    await owner.query("DROP TABLE IF EXISTS public.tasks, public.categories, public.schema_migrations CASCADE");
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
    assert.deepEqual(await migrate(), VERSIONS);
    assert.deepEqual(await migrate(), []);
    const ledger = await owner.query("SELECT version FROM public.schema_migrations ORDER BY version");
    assert.deepEqual(ledger.rows.map(r => r.version), VERSIONS);
  });

  test("concurrent migrators serialize on the advisory lock", async () => {
    const pools = [1, 2, 3].map(() => createPool({ connectionString: OWNER_URL, max: 1, statementTimeoutMs: 0 }));
    try {
      const results = await Promise.all(pools.map(pool =>
        runMigrations(pool, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: quiet })));
      // exactly one run applied everything; the others found nothing pending
      assert.deepEqual(results.map(r => r.length).sort(), [0, 0, VERSIONS.length]);
    } finally {
      await Promise.all(pools.map(pool => pool.end()));
    }
  });

  test("a modified, already-applied migration is refused", async () => {
    await migrate();
    await owner.query("UPDATE public.schema_migrations SET checksum = 'tampered' WHERE version = $1", [VERSIONS[0]]);
    await assert.rejects(migrate(), /was modified after it was applied/);
  });

  test("a failing migration rolls back completely and can be retried", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
    try {
      for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
        fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
      }
      fs.writeFileSync(path.join(dir, "999_broken.sql"),
        "ALTER TABLE public.tasks ADD COLUMN broken_marker int;\nSELECT * FROM no_such_table;\n");

      await assert.rejects(migrate({ dir }), /999_broken failed/);
      const ledger = await owner.query("SELECT version FROM public.schema_migrations");
      assert.equal(ledger.rows.some(r => r.version === "999_broken"), false);
      const column = await owner.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'broken_marker'");
      assert.equal(column.rowCount, 0);

      fs.unlinkSync(path.join(dir, "999_broken.sql"));
      assert.deepEqual(await migrate({ dir }), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an older release tolerates newer migrations in the database (app rollback)", async () => {
    await migrate();
    await owner.query("INSERT INTO public.schema_migrations (version, checksum) VALUES ('900_future', 'x')");
    const messages = [];
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: APP_ROLE, log: m => messages.push(m) });
    assert.ok(messages.some(m => m.includes("900_future")));
  });

  test("the application role has data access only", async () => {
    await migrate();
    await appPool.query("INSERT INTO categories (name, color) VALUES ('Dom', '#22c55e')");
    await assert.rejects(appPool.query("CREATE TABLE public.intruder (id int)"), /permission denied/);
    await assert.rejects(appPool.query("DROP TABLE public.tasks"), /must be owner|permission denied/);
    await assert.rejects(appPool.query("ALTER TABLE public.tasks ADD COLUMN x int"), /must be owner|permission denied/);
    await assert.rejects(appPool.query("TRUNCATE public.tasks"), /permission denied/);
    await assert.rejects(appPool.query("DELETE FROM public.schema_migrations"), /permission denied/);
  });

  test("schema enforces integrity", async () => {
    await migrate();
    const fks = await owner.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.tasks'::regclass AND contype = 'f'`);
    assert.deepEqual(fks.rows.map(r => r.conname), ["fk_category"]);
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
      assert.deepEqual(tasks, [{
        id: taskId,
        title: "<img src=x onerror=alert(1)>", // stored verbatim; escaped at render time
        completed: true,
        date: "2026-10-30",
        categoryId: null
      }]);

      assert.equal((await ctx.request("/api/tasks/date/2026-10-30", { method: "DELETE", headers: SAME_ORIGIN_JSON })).status, 200);
      assert.deepEqual(await (await ctx.request("/api/tasks")).json(), []);
    } finally {
      await ctx.close();
      await freshPool.end();
    }
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
