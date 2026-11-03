const path = require("node:path");
const { isIP } = require("node:net");

const { parsePasswordHash } = require("./security");

// Reads configuration from the environment. Fails fast in production when
// anything security-relevant is missing instead of falling back to defaults.
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const errors = [];

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push("DATABASE_URL is required");
  }

  const authUsername = env.AUTH_USERNAME || "";
  const authPasswordHash = env.AUTH_PASSWORD_HASH || "";
  const authDisabled = env.AUTH_DISABLED === "true";

  if (authDisabled && isProduction) {
    errors.push("AUTH_DISABLED=true is not allowed when NODE_ENV=production");
  }
  if (!authDisabled && (!authUsername || !authPasswordHash)) {
    errors.push("AUTH_USERNAME and AUTH_PASSWORD_HASH are required (or AUTH_DISABLED=true outside production)");
  } else if (!authDisabled) {
    try {
      parsePasswordHash(authPasswordHash);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const publicOrigin = env.PUBLIC_ORIGIN || (isProduction ? "" : "http://localhost:3000");
  if (!publicOrigin) {
    errors.push("PUBLIC_ORIGIN is required in production (e.g. https://task.mytko.dev)");
  } else if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) {
    errors.push("PUBLIC_ORIGIN must be an origin without path, e.g. https://task.mytko.dev");
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
    error.code = "CONFIG_INVALID";
    throw error;
  }

  const database = require("./database-config").loadDatabaseConfig(env);
  return {
    database,
    nodeEnv,
    isProduction,
    host: env.HOST || "0.0.0.0",
    port: toInt(env.PORT, 3000),
    databaseUrl,
    pgPoolMax: toInt(env.PG_POOL_MAX, 10),
    pgStatementTimeoutMs: toInt(env.PG_STATEMENT_TIMEOUT_MS, 10000),
    publicOrigin,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    auth: {
      disabled: authDisabled,
      username: authUsername,
      passwordHash: authPasswordHash
    },
    rateLimit: {
      windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 60000),
      max: toInt(env.RATE_LIMIT_MAX, 300),
      authFailWindowMs: toInt(env.AUTH_FAIL_WINDOW_MS, 15 * 60000),
      authFailMax: toInt(env.AUTH_FAIL_MAX, 10)
    },
    shutdownTimeoutMs: toInt(env.SHUTDOWN_TIMEOUT_MS, 10000),
    staticDir: env.STATIC_DIR || path.join(__dirname, "..", "frontend"),
    migrationsDir: path.join(__dirname, "migrations")
  };
}

function toInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function parseTrustProxy(value, isProduction) {
  // Trust only actual proxy peers in production, never every private client
  // or a hop count (which depends on every route having the same length).
  if (isProduction && value && value !== "false") {
    const peers = value.split(",").map(item => item.trim());
    for (const peer of peers) {
      const [address, prefix, extra] = peer.split("/");
      const family = isIP(address);
      const hostPrefix = family === 4 ? "32" : "128";
      if (peer !== "loopback" && (!family || extra !== undefined ||
          (prefix !== undefined && prefix !== hostPrefix))) {
        throw new Error("Production TRUST_PROXY requires loopback or explicit proxy IPs (/32 or /128)");
      }
    }
  }
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

module.exports = { loadConfig };
