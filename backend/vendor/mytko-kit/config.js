const path = require("node:path");
const { isIP } = require("node:net");

const { parsePasswordHash } = require("./security");
const { LOGIN } = require("./users");
const { loadDatabaseConfig } = require("./database-config");
const { loadPush } = require("./push");
const { loadAssistant } = require("./assistant");
const { loadAi } = require("./ai");

// Reads configuration from the environment. Fails fast in production when anything security-relevant is missing
// instead of falling back to defaults.
//
// app: { id, envPrefix, origin } (origin: the production address, for the error messages, e.g.
// https://finance.mytko.dev). backendDir: the app's backend/ directory (the static files are ../frontend, the
// migrations ./drizzle). extend(env, errors): the app's own settings, merged into the result; it adds its problems to
// `errors` (every problem is reported at once).
function loadConfig(env = process.env, { app, backendDir, extend = null } = {}) {
  if (!app || !app.id || !backendDir) throw new Error("loadConfig needs the app and its backend directory");
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const errors = [];
  const example = app.origin || `https://${app.id}.mytko.dev`;

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");

  // The administrator: always an account in the database, created or updated from these values (users.js). The
  // password is set on the server only.
  const adminLogin = (env.ADMIN_LOGIN || "").trim().toLowerCase();
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH || "";
  const adminName = (env.ADMIN_NAME || "").trim() || adminLogin;
  if (!LOGIN.test(adminLogin)) errors.push("ADMIN_LOGIN is required: 3–40 lowercase letters, digits, dot, dash or underscore");
  if (adminName.length > 80) errors.push("ADMIN_NAME must be at most 80 characters");
  if (!adminPasswordHash) {
    errors.push("ADMIN_PASSWORD_HASH is required (npm run hash-password)");
  } else {
    try {
      parsePasswordHash(adminPasswordHash);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const publicOrigin = env.PUBLIC_ORIGIN || (isProduction ? "" : "http://localhost:3000");
  if (!publicOrigin) {
    errors.push(`PUBLIC_ORIGIN is required in production (e.g. ${example})`);
  } else if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) {
    errors.push(`PUBLIC_ORIGIN must be an origin without path, e.g. ${example}`);
  } else if (isProduction && !publicOrigin.startsWith("https://")) {
    // The session cookie is Secure with the __Host- prefix only on HTTPS (sessions.js): plain HTTP is for local
    // development only.
    errors.push("PUBLIC_ORIGIN must use https in production");
  }

  let trustProxy = false;
  try {
    trustProxy = parseTrustProxy(env.TRUST_PROXY, isProduction);
  } catch (error) {
    errors.push(error.message);
  }

  const sso = loadSso(env, errors, app.id);
  // Web Push (push.js): null unless PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY are set
  const push = loadPush(env, errors);
  // AI (ai/index.js): null without a key — the app works without it; the assistant connector (assistant.js): null unless
  // ASSISTANT_TOKEN_SHA256 is set
  const ai = loadAi(env, errors, { isProduction });
  const assistant = loadAssistant(env, errors);

  const numbers = {};
  for (const [name, fallback] of Object.entries({
    PORT: 3000, SESSION_TTL_HOURS: 168, RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX: 300,
    AUTH_FAIL_WINDOW_MS: 15 * 60000, AUTH_FAIL_MAX: 10, SHUTDOWN_TIMEOUT_MS: 10000
  })) {
    try {
      numbers[name] = toInt(env[name], fallback);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }

  const extra = extend ? extend(env, errors) || {} : {};

  if (errors.length > 0) {
    const error = new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
    error.code = "CONFIG_INVALID";
    throw error;
  }

  const database = loadDatabaseConfig(env, { app });
  return {
    ...extra,
    database,
    nodeEnv,
    isProduction,
    host: env.HOST || "0.0.0.0",
    port: numbers.PORT,
    publicOrigin,
    trustProxy,
    admin: { login: adminLogin, name: adminName, passwordHash: adminPasswordHash },
    auth: { sessionTtlMs: numbers.SESSION_TTL_HOURS * 3600000, sso },
    push,
    ai,
    assistant,
    rateLimit: {
      windowMs: numbers.RATE_LIMIT_WINDOW_MS,
      max: numbers.RATE_LIMIT_MAX,
      authFailWindowMs: numbers.AUTH_FAIL_WINDOW_MS,
      authFailMax: numbers.AUTH_FAIL_MAX
    },
    shutdownTimeoutMs: numbers.SHUTDOWN_TIMEOUT_MS,
    staticDir: env.STATIC_DIR || path.join(backendDir, "..", "frontend"),
    migrationsDir: path.join(backendDir, "drizzle")
  };
}

// "Zaloguj kontem Mytko" (routes/sso.js): enabled when MYTKO_SSO_ORIGIN, MYTKO_SSO_CLIENT_SECRET and MYTKO_SSO_LOGIN are
// set. MYTKO_SSO_LOGIN is the only Mytko Workflow login let in; it signs in as the administrator. The client id defaults
// to the app's id (e.g. "finance").
function loadSso(env, errors, appId) {
  const origin = env.MYTKO_SSO_ORIGIN || "";
  const clientSecret = env.MYTKO_SSO_CLIENT_SECRET || "";
  if (!origin && !clientSecret) return null;
  if (!origin || !clientSecret) {
    errors.push("MYTKO_SSO_ORIGIN and MYTKO_SSO_CLIENT_SECRET must be set together");
    return null;
  }
  if (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    errors.push("MYTKO_SSO_ORIGIN must be an https origin without path, e.g. https://workflow.mytko.dev");
  }
  if (clientSecret.length < 32) errors.push("MYTKO_SSO_CLIENT_SECRET must be at least 32 characters");
  const clientId = env.MYTKO_SSO_CLIENT_ID || appId;
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(clientId)) errors.push("MYTKO_SSO_CLIENT_ID must be a short lowercase id");
  // Workflow may have several operators; only this one becomes the administrator here.
  const login = env.MYTKO_SSO_LOGIN || "";
  if (!login || login.length > 80) errors.push("MYTKO_SSO_LOGIN (the Mytko Workflow login let in, at most 80 characters) is required with MYTKO_SSO_ORIGIN");
  return { origin, clientSecret, clientId, login };
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
  // Trust only actual proxy peers in production, never every private client or a hop count (which depends on every
  // route having the same length).
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

module.exports = { loadConfig, loadSso, toInt, parseTrustProxy };
