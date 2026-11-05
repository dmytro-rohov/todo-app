// Ends every browser session (e.g. after changing AUTH_PASSWORD_HASH). Uses the application database role.
const { createPool } = require("../db");
const { createSessionStore } = require("../sessions");

async function main() {
  const pool = createPool(require("../database-config").loadDatabaseConfig(process.env));
  try {
    await createSessionStore(pool, { ttlMs: 0 }).revokeAll();
    console.log("all sessions revoked");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("revoking sessions failed");
  process.exit(1);
});
