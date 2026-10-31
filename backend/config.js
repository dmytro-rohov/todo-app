// Runtime configuration read only from environment variables.
// No credentials live in the code; see .env.example for the expected keys.

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} must be an integer between 1 and 65535 (got "${value}")`);
  }
  return port;
}

function loadConfig(env = process.env) {
  const missing = [];

  if (!env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
      "Copy backend/.env.example to backend/.env and fill in the values."
    );
  }

  try {
    new URL(env.DATABASE_URL);
  } catch {
    throw new ConfigError("DATABASE_URL is not a valid connection URL (postgres://user:password@host:port/database)");
  }

  return {
    databaseUrl: env.DATABASE_URL,
    host: env.HOST || "127.0.0.1",
    port: env.PORT ? parsePort(env.PORT, "PORT") : 3000,
    corsOrigin: env.CORS_ORIGIN || null
  };
}

module.exports = { loadConfig, ConfigError };
