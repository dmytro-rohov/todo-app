const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Arbitrary constant shared by every migrator for this database. Concurrent
// migrators serialize on it instead of racing on DDL.
const MIGRATION_LOCK_ID = 7243917461;
const MIGRATION_FILE = /^(\d{3,})_[a-z0-9_]+\.sql$/;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function listMigrations(dir) {
  return fs.readdirSync(dir)
    .filter(file => MIGRATION_FILE.test(file))
    .sort()
    .map(file => {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      return {
        version: file.replace(/\.sql$/, ""),
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex")
      };
    });
}

async function acquireLock(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [MIGRATION_LOCK_ID]);
    if (result.rows[0].locked) return;
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for another migration run to finish");
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function runMigrations(pool, { dir, appRole, lockTimeoutMs = 60000, log = console.log }) {
  const migrations = listMigrations(dir);
  const client = await pool.connect();

  try {
    await acquireLock(client, lockTimeoutMs);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query("SELECT version, checksum FROM public.schema_migrations");
    const applied = new Map(appliedRows.rows.map(row => [row.version, row.checksum]));
    const known = new Set(migrations.map(m => m.version));

    for (const migration of migrations) {
      const checksum = applied.get(migration.version);
      if (checksum && checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} was modified after it was applied`);
      }
    }

    // A newer release may have applied migrations this code does not know.
    // That is expected when rolling the application back, so only warn.
    for (const version of applied.keys()) {
      if (!known.has(version)) {
        log(`warning: database has migration ${version} that this release does not know`);
      }
    }

    const pending = migrations.filter(m => !applied.has(m.version));
    for (const migration of pending) {
      log(`applying ${migration.version}`);
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.version, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        error.message = `Migration ${migration.version} failed: ${error.message}`;
        throw error;
      }
    }

    if (appRole) {
      await grantAppRole(client, appRole);
    }

    log(pending.length === 0 ? "schema up to date" : `applied ${pending.length} migration(s)`);
    return pending.map(m => m.version);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// The application role gets data access only: no DDL, no ownership, and
// read-only access to the migration ledger (used by the readiness check).
async function grantAppRole(client, role) {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Invalid APP_DB_ROLE "${role}"`);
  }
  const name = client.escapeIdentifier(role);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks, public.categories TO ${name}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${name}`);
  await client.query(`GRANT SELECT ON public.schema_migrations TO ${name}`);
}

// Readiness: every migration shipped with this release must be applied.
async function checkSchema(pool, versions) {
  const result = await pool.query("SELECT version FROM public.schema_migrations");
  const applied = new Set(result.rows.map(row => row.version));
  return versions.every(version => applied.has(version));
}

module.exports = { listMigrations, runMigrations, checkSchema, MIGRATION_LOCK_ID };
