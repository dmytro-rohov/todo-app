// The command-line tools of every Mytko app, called from the app's own backend/scripts/*.js and backend/migrate.js
// (those paths stay stable for the Dockerfile, compose and the docs).
const { hashPassword } = require("./security");
const { createPool } = require("./db");
const { createSessionStore } = require("./sessions");
const { loadDatabaseConfig } = require("./database-config");
const { runMigrations } = require("./migrations");

// Prints an ADMIN_PASSWORD_HASH value. Reads the password from stdin so it never appears in process arguments or
// shell history:
//   node scripts/hash-password.js < password.txt
//   printf '%s' "$PASSWORD" | docker run --rm -i <image> node backend/scripts/hash-password.js
// params: the scrypt parameters of new hashes (default: the kit's, security.js SCRYPT_DEFAULTS).
async function hashPasswordCli({ stdin = process.stdin, out = console.log, fail = message => { console.error(message); process.exit(1); }, params = undefined } = {}) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");

  if (password.length < 12) return fail("Password must be at least 12 characters");

  out(await hashPassword(password, params));
}

// Ends every browser session (all accounts sign in again). Uses DATABASE_URL like the app.
async function revokeSessionsCli({ app, env = process.env }) {
  try {
    const pool = createPool(loadDatabaseConfig(env, { app }));
    try {
      await createSessionStore(pool, { ttlMs: 0 }).revokeAll();
      console.log("all sessions revoked");
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error(`revoke failed: ${error.message}`);
    process.exit(1);
  }
}

// Applies pending schema migrations using the migration (schema owner) credentials, then grants data-only privileges
// to the application role. Safe to run concurrently and repeatedly. In production the application role must get its
// grants (also on the migration history /readyz reads), so APP_DB_ROLE is required there (requireAppRole: false keeps an
// app that never required it as it was). lockId: the app's migration lock (migrations.js).
async function migrateCli({ app, dir, env = process.env, requireAppRole = true, lockId = undefined }) {
  try {
    const appRole = env.APP_DB_ROLE || "";
    if (requireAppRole && env.NODE_ENV === "production" && !appRole) throw new Error("APP_DB_ROLE is required in production");
    const pool = createPool(loadDatabaseConfig(env, { app, migration: true }));
    try {
      await runMigrations(pool, { dir, appRole, lockId });
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error(`migration failed: ${error.message}`);
    process.exit(1);
  }
}

// Container HEALTHCHECK: exits 0 only when /readyz reports ready (healthcheck.js; an app's probe script requires that
// file directly, so the probe loads nothing else).
function healthcheckCli() {
  require("./healthcheck");
}

module.exports = { hashPasswordCli, revokeSessionsCli, migrateCli, healthcheckCli };
