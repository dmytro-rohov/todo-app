// Applies pending schema migrations using the migration (schema owner)
// credentials, then grants data-only privileges to the application role.
// Safe to run concurrently and repeatedly.
const path = require("node:path");

const { createPool } = require("./db");
const { runMigrations } = require("./migrations");

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL is required");
  }

  const pool = createPool({
    connectionString,
    max: 1,
    statementTimeoutMs: 0,
    applicationName: "mytko-tasks-migrate"
  });

  try {
    await runMigrations(pool, {
      dir: path.join(__dirname, "migrations"),
      appRole: process.env.APP_DB_ROLE || ""
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`migration failed: ${error.message}`);
  process.exit(1);
});
