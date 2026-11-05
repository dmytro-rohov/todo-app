const { loadConfig } = require("./config");
const { createPool } = require("./db");
const { createApp } = require("./app");
const { listMigrations } = require("./migrations");

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool(config.database);

const migrationVersions = listMigrations(config.migrationsDir).map(m => m.hash);
const { app, markShuttingDown, stop } = createApp({ config, pool, migrationVersions });

const server = app.listen(config.port, config.host, () => {
  console.log(`Server listening on ${config.host}:${config.port}`);
});

// Startup DB probe is informational only; /readyz reports actual readiness.
pool.query("SELECT 1").then(
  () => console.log("Database reachable"),
  (error) => console.error("Database not reachable yet:", "database operation failed")
);

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  markShuttingDown();

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  // Stops accepting connections and waits for in-flight requests.
  server.close(async (error) => {
    if (error) console.error("HTTP server close error:", "operation failed");
    stop();
    try {
      await pool.end();
    } catch (poolError) {
      console.error("Pool close error:", "operation failed");
    }
    process.exit(error ? 1 : 0);
  });
  server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
