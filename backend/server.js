const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const { loadConfig, ConfigError } = require("./config");
const { createPool } = require("./db");
const { createApp } = require("./app");

// Local development convenience: read backend/.env when it exists.
// Variables already set in the environment always win; in production they
// come from the service manager.
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  const values = util.parseEnv(fs.readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

let config;
try {
  config = loadConfig();
} catch(error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const pool = createPool(config.databaseUrl);
const app = createApp({ pool, corsOrigin: config.corsOrigin });

pool.query("SELECT 1")
  .then(() => console.log("DB CONNECTED"))
  .catch((error) => console.error(`DB ERROR: ${error.message}`));

const server = app.listen(config.port, config.host, (error) => {
  if (error) {
    console.error(`Cannot start server: ${error.message}`);
    process.exit(1);
  }
  console.log(`Server running on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
