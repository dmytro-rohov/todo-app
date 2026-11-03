// Applies pending schema migrations using the migration (schema owner)
// credentials, then grants data-only privileges to the application role.
// Safe to run concurrently and repeatedly.
const path = require("node:path");

const { createPool } = require("./db");
const { runMigrations } = require("./migrations");

async function main() {
  const pool = createPool(require("./database-config").loadDatabaseConfig(process.env, { migration: true }));

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
