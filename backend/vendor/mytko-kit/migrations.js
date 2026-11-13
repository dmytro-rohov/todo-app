// Schema migrations are Drizzle migrations (./drizzle, generated from ./db/schema.js by drizzle-kit).
// Production schema changes are applied by Mytko's approved migration path; `npm run migrate` applies the same
// files to dev/test databases using the standard Drizzle migrator and its standard history table.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Arbitrary constant shared by every migrator for this database. Concurrent
// migrators serialize on it instead of racing on DDL.
const MIGRATION_LOCK_ID = 7243917462;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const TAG = /^[0-9]{4}_[A-Za-z0-9_]+$/;

// Reads the shipped migrations from the Drizzle journal. `hash` is what Drizzle records in
// drizzle.__drizzle_migrations (sha256 of the SQL file text).
function listMigrations(dir) {
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
  if (!Array.isArray(journal.entries)) throw new Error("Invalid Drizzle journal");
  return journal.entries.map(entry => {
    if (!TAG.test(entry.tag)) throw new Error(`Invalid migration tag ${entry.tag}`);
    const sql = fs.readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8");
    return { version: entry.tag, when: entry.when, hash: crypto.createHash("sha256").update(sql).digest("hex"), sql };
  });
}

async function acquireLock(client, timeoutMs, lockId = MIGRATION_LOCK_ID) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [lockId]);
    if (result.rows[0].locked) return;
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for another migration run to finish");
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Drizzle selects pending migrations by timestamp only, so a modified file that is already behind the newest
// applied migration would be skipped silently. Applied history is therefore checked by hash as well.
async function appliedHistory(client) {
  const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  if (!exists.rows[0].name) return { hashes: new Set(), last: -1 };
  const rows = await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations");
  return {
    hashes: new Set(rows.rows.map(row => row.hash)),
    last: rows.rows.reduce((max, row) => Math.max(max, Number(row.created_at)), -1)
  };
}

// lockId: the advisory lock every migrator of this database takes (an app with its own, e.g. Tasks 7243917461, keeps it so
// an older and a newer release never migrate at the same time).
async function runMigrations(pool, { dir, appRole, lockTimeoutMs = 60000, log = console.log, lockId = MIGRATION_LOCK_ID }) {
  const migrations = listMigrations(dir);
  const client = await pool.connect();

  try {
    await acquireLock(client, lockTimeoutMs, lockId);
    const before = (await appliedHistory(client)).hashes;
    const { last } = await appliedHistory(client);
    for (const migration of migrations) {
      if (migration.when <= last && !before.has(migration.hash)) {
        throw new Error(`Migration ${migration.version} was modified after it was applied`);
      }
    }
    // A newer release may have applied migrations this code does not know.
    // That is expected when rolling the application back, so only warn.
    const known = new Set(migrations.map(m => m.hash));
    for (const hash of before) {
      if (!known.has(hash)) log(`warning: database has migration ${hash} that this release does not know`);
    }
    const pending = migrations.filter(m => !before.has(m.hash));
    if (pending.length) {
      // Drizzle (the app's own dependency) only when there is something to apply
      const { drizzle } = require("drizzle-orm/node-postgres");
      const { migrate } = require("drizzle-orm/node-postgres/migrator");
      pending.forEach(m => log(`applying ${m.version}`));
      await client.query("SET lock_timeout = '10s'");
      await migrate(drizzle({ client }), { migrationsFolder: dir });
      await client.query("RESET lock_timeout");
    }
    if (appRole) {
      await grantAppRole(client, appRole);
    }
    log(pending.length === 0 ? "schema up to date" : `applied ${pending.length} migration(s)`);
    return pending.map(m => m.version);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]).catch(() => {});
    client.release();
  }
}

// The application role gets data access only: no DDL, no ownership, and
// read-only access to the migration history (used by the readiness check).
async function grantAppRole(client, role) {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Invalid APP_DB_ROLE "${role}"`);
  }
  const name = client.escapeIdentifier(role);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
  // Every application table: tables added by later migrations are covered without touching this list.
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${name}`);
  await client.query(`GRANT USAGE ON SCHEMA drizzle TO ${name}`);
  await client.query(`GRANT SELECT ON drizzle.__drizzle_migrations TO ${name}`);
}

// Readiness: every migration shipped with this release (by Drizzle hash) must be applied.
async function checkSchema(pool, hashes) {
  const result = await pool.query("SELECT hash FROM drizzle.__drizzle_migrations");
  const applied = new Set(result.rows.map(row => row.hash));
  return hashes.every(hash => applied.has(hash));
}

module.exports = { listMigrations, runMigrations, checkSchema, MIGRATION_LOCK_ID };
