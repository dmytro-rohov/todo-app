// Ends every browser session (e.g. after changing ADMIN_PASSWORD_HASH / AUTH_PASSWORD_HASH). Uses the application
// database role.
const kit = require("../kit");

async function main() {
  const pool = kit.createPool(kit.loadDatabaseConfig(process.env));
  try {
    await kit.createSessionStore(pool, { ttlMs: 0 }).revokeAll();
    console.log("all sessions revoked");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("revoking sessions failed");
  process.exit(1);
});
