const kit = require("./kit");
const { loadConfig } = require("./config");
const { createApp } = require("./app");
const { scheduleRetention } = require("./retention");
const { scheduleCalendarSync } = require("./calendar-sync");
const { adoptSharedSpaces } = require("./routes/spaces");

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = kit.createPool(config.database);

const migrationVersions = kit.listMigrations(config.migrationsDir).map(m => m.hash);
const instance = createApp({ config, pool, migrationVersions });

let retention = null;
let calendarSync = null;
let adoptTimer = null;

// Listens, probes the database once (informational; /readyz reports actual readiness) and shuts down cleanly on
// SIGTERM/SIGINT (the kit's server.js); the archive, calendar and shared-space jobs below stop with the app.
kit.runServer({ config, pool, instance: { ...instance, stop() {
  instance.stop();
  retention?.stop();
  calendarSync?.stop();
  clearTimeout(adoptTimer);
} } });

retention = scheduleRetention(pool, config.retention);
calendarSync = scheduleCalendarSync(pool, instance.calendar);

// Spaces shared before space members existed keep everybody in them (once; retried until the database answers).
function adopt() {
  adoptSharedSpaces(pool).then(
    added => { if (added) console.log(`Shared spaces: ${added} memberships kept from before`); },
    () => { adoptTimer = setTimeout(adopt, 30000); adoptTimer.unref(); }
  );
}
adopt();
