// Applies pending schema migrations (./drizzle) using the migration (schema owner) credentials, then grants data-only
// privileges to the application role (APP_DB_ROLE). Safe to run concurrently and repeatedly (Tasks' own migration lock,
// kit.js). APP_DB_ROLE stays optional here, as it always was in Tasks.
require("./kit").migrateCli({ requireAppRole: false });
