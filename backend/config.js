const path = require("node:path");
const { isIP } = require("node:net");

const { parsePasswordHash } = require("./security");
const { loadAi } = require("./ai");

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
  if (authUsername.length > 80) {
    errors.push("AUTH_USERNAME must be at most 80 characters");
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

  const sso = loadSso(env, errors);
  const calendar = loadCalendar(env, errors, publicOrigin);
  const booking = loadBooking(env, errors, { calendar, isProduction });
  const mail = loadMail(env, errors, { isProduction });
  const ai = loadAi(env, errors, { isProduction });
  // Mytko Workflow ToDo (routes/agent.js): the SHA-256 (hex) of the token Workflow sends; the token itself stays in Workflow.
  const workflowTokenSha256 = (env.WORKFLOW_TOKEN_SHA256 || "").toLowerCase();
  if (workflowTokenSha256 && !/^[0-9a-f]{64}$/.test(workflowTokenSha256)) errors.push("WORKFLOW_TOKEN_SHA256 must be 64 hex characters (sha256 of the token)");

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
      passwordHash: authPasswordHash,
      sessionTtlMs: toInt(env.SESSION_TTL_HOURS, 168) * 3600000,
      sso
    },
    rateLimit: {
      windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 60000),
      max: toInt(env.RATE_LIMIT_MAX, 300),
      authFailWindowMs: toInt(env.AUTH_FAIL_WINDOW_MS, 15 * 60000),
      authFailMax: toInt(env.AUTH_FAIL_MAX, 10)
    },
    // Archive after N days done; delete private / other archived tasks after N days in the archive. 0 = off.
    calendar,
    booking,
    mail,
    ai,
    workflow: workflowTokenSha256 ? { tokenSha256: workflowTokenSha256 } : null,
    retention: {
      archiveDays: toInt(env.RETENTION_ARCHIVE_DAYS, 7),
      deletePrivateDays: toInt(env.RETENTION_DELETE_PRIVATE_DAYS, 7),
      deleteWorkDays: toInt(env.RETENTION_DELETE_WORK_DAYS, 90)
    },
    shutdownTimeoutMs: toInt(env.SHUTDOWN_TIMEOUT_MS, 10000),
    staticDir: env.STATIC_DIR || path.join(__dirname, "..", "frontend"),
    migrationsDir: path.join(__dirname, "drizzle")
  };
}

// "Zaloguj kontem Mytko" (routes/sso.js): enabled when MYTKO_SSO_ORIGIN and MYTKO_SSO_CLIENT_SECRET are set.
// MYTKO_SSO_LOGIN is the only Mytko Workflow login let in.
function loadSso(env, errors) {
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
  const clientId = env.MYTKO_SSO_CLIENT_ID || "tasks";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(clientId)) errors.push("MYTKO_SSO_CLIENT_ID must be a short lowercase id");
  // Workflow may have several operators; only this one becomes the owner here.
  const login = env.MYTKO_SSO_LOGIN || "";
  if (!login || login.length > 80) errors.push("MYTKO_SSO_LOGIN (the Mytko Workflow login let in, at most 80 characters) is required with MYTKO_SSO_ORIGIN");
  return { origin, clientSecret, clientId, login };
}

// Google Calendars per space (routes/calendar.js): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (an OAuth "Web application"
// client) and TASKS_SECRET_KEY (encrypts the stored refresh tokens) together, or none.
function loadCalendar(env, errors, publicOrigin) {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TASKS_SECRET_KEY"];
  const set = names.filter(name => env[name]);
  if (!set.length) return null;
  if (set.length !== names.length) {
    errors.push(`${names.join(", ")} must be set together`);
    return null;
  }
  let key = null;
  try {
    key = require("./secrets").parseKey(env.TASKS_SECRET_KEY);
  } catch (error) {
    errors.push(error.message);
  }
  const calendar = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, key, redirectUri: `${publicOrigin}/auth/google/callback` };
  // Local testing only (e2e/fake-google.mjs): other Google endpoints are never accepted in production.
  if (env.NODE_ENV !== "production" && env.GOOGLE_DEV_BASE) {
    Object.assign(calendar, { authBase: env.GOOGLE_DEV_BASE, tokenUrl: `${env.GOOGLE_DEV_BASE}/token`, apiBase: `${env.GOOGLE_DEV_BASE}/cal` });
  }
  return calendar;
}

// The public booking API for the own form on mytko.dev (routes/booking.js): on when BOOKING_ORIGINS lists the sites
// allowed to call it (CORS) and the Google Calendar settings are set. Slots come from the BOOKING_SPACE's calendar.
function loadBooking(env, errors, { calendar, isProduction }) {
  if (!env.BOOKING_ORIGINS) return null;
  if (!calendar) {
    errors.push("BOOKING_ORIGINS needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TASKS_SECRET_KEY");
    return null;
  }
  const origins = env.BOOKING_ORIGINS.split(",").map(item => item.trim()).filter(Boolean);
  for (const origin of origins) {
    const local = !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin) && !local) errors.push(`BOOKING_ORIGINS: "${origin}" is not an https origin without path`);
  }
  const timeZone = env.BOOKING_TIME_ZONE || "Europe/Warsaw";
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { errors.push("BOOKING_TIME_ZONE must be an IANA time zone, e.g. Europe/Warsaw"); }
  const hours = (env.BOOKING_HOURS || "09:00-17:00").split("-");
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (hours.length !== 2 || !hours.every(h => time.test(h)) || hours[0] >= hours[1]) errors.push("BOOKING_HOURS must look like 09:00-17:00");
  const days = parseDays(env.BOOKING_DAYS || "1-5");
  if (!days) errors.push("BOOKING_DAYS must list weekdays 1 (Monday) to 7, e.g. 1-5 or 1,2,4");
  const bounded = (name, fallback, min, max) => {
    const value = toInt(env[name], fallback);
    if (value < min || value > max) errors.push(`${name} must be between ${min} and ${max}`);
    return value;
  };
  const spaceKey = env.BOOKING_SPACE || "work";
  if (!/^[a-z0-9_-]{1,20}$/.test(spaceKey)) errors.push("BOOKING_SPACE must be a space key, e.g. work");
  return {
    origins, timeZone, hours, days: days || [], spaceKey,
    slotMinutes: bounded("BOOKING_SLOT_MINUTES", 30, 15, 240),
    bufferMinutes: bounded("BOOKING_BUFFER_MINUTES", 15, 0, 120),
    noticeHours: bounded("BOOKING_NOTICE_HOURS", 24, 0, 336),
    horizonDays: bounded("BOOKING_HORIZON_DAYS", 28, 1, 90),
    perHour: bounded("BOOKING_IP_HOURLY_MAX", 5, 1, 100),
    perDay: bounded("BOOKING_DAILY_MAX", 20, 1, 500)
  };
}

// Poczta (routes/mail.js): the owner's mailbox over IMAP, e.g. OVH Zimbra. Host, user and password together, or none.
// TLS always in production; MAIL_IMAP_TLS=false only for a local test server.
function loadMail(env, errors, { isProduction }) {
  const names = ["MAIL_IMAP_HOST", "MAIL_IMAP_USER", "MAIL_IMAP_PASSWORD"];
  const set = names.filter(name => env[name]);
  if (!set.length) return null;
  if (set.length !== names.length) {
    errors.push(`${names.join(", ")} must be set together`);
    return null;
  }
  const tls = env.MAIL_IMAP_TLS !== "false";
  if (!tls && isProduction) errors.push("MAIL_IMAP_TLS=false is not allowed in production");
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(env.MAIL_IMAP_HOST)) errors.push("MAIL_IMAP_HOST must be a host name, e.g. ssl0.ovh.net");
  const port = toInt(env.MAIL_IMAP_PORT, tls ? 993 : 143);
  if (port < 1 || port > 65535) errors.push("MAIL_IMAP_PORT must be a port number");
  const limit = toInt(env.MAIL_FETCH_LIMIT, 200);
  if (limit < 10 || limit > 2000) errors.push("MAIL_FETCH_LIMIT must be between 10 and 2000");
  return {
    host: env.MAIL_IMAP_HOST, port, tls, user: env.MAIL_IMAP_USER, password: env.MAIL_IMAP_PASSWORD,
    address: (env.MAIL_ADDRESS || env.MAIL_IMAP_USER).toLowerCase(), mailbox: env.MAIL_MAILBOX || "INBOX",
    limit, everyMs: toInt(env.MAIL_SYNC_MINUTES, 3) * 60000
  };
}


function parseDays(value) {
  const days = new Set();
  for (const part of value.split(",").map(item => item.trim())) {
    const match = /^([1-7])(?:-([1-7]))?$/.exec(part);
    if (!match) return null;
    const [from, to] = [Number(match[1]), Number(match[2] || match[1])];
    if (from > to) return null;
    for (let day = from; day <= to; day++) days.add(day);
  }
  return [...days];
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
