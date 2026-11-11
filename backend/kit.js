// Mytko Kit (backend/vendor/mytko-kit: a copy of the shared kit, never edited here — change the kit and run its
// tools/sync.mjs) bound to Mytko Tasks: the session cookie "mytko-tasks-session", TASKS_ENV, the database connection
// "mytko-tasks-<environment>". Tasks keeps its own owner model (security.js, access.js, users.js, routes/auth.js) on the
// kit's primitives, its scrypt parameters for new password hashes (every Tasks hash so far: N=2^15, r=8, p=1) and its
// migration lock (an older and a newer release never migrate at the same time).
const { bindKit } = require("./vendor/mytko-kit");

const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32 });

module.exports = {
  ...bindKit({ id: "tasks", name: "Mytko Tasks", envPrefix: "TASKS", origin: "https://tasks.mytko.dev", backendDir: __dirname,
    scrypt: SCRYPT, migrationLockId: 7243917461 }),
  SCRYPT
};
