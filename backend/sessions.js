// Server-side browser sessions. The cookie carries a random 256-bit token; the database keeps only its SHA-256,
// so sessions survive restarts and releases but a database read never yields a usable cookie. Sessions are never
// extended: they end at expires_at or on logout. After a password change, `npm run revoke-sessions` ends them all.
const crypto = require("node:crypto");
const { withTransaction } = require("./db");

const MAX_SESSIONS = 32;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Cookie name and attributes. The __Host- prefix (Secure, Path=/, no Domain) is used whenever the app is served
// over HTTPS; plain HTTP is only for local development.
function cookieSettings(publicOrigin) {
  const secure = publicOrigin.startsWith("https://");
  return { name: secure ? "__Host-mytko-tasks-session" : "mytko-tasks-session", secure };
}

function readCookie(req, name) {
  for (const part of (req.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function createSessionStore(pool, { ttlMs }) {
  return {
    ttlMs,

    async create({ login, method }) {
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + ttlMs);
      await withTransaction(pool, async client => {
        await client.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
        await client.query(
          "INSERT INTO auth_sessions (token_hash, login, method, expires_at) VALUES ($1, $2, $3, $4)",
          [hashToken(token), login, method, expiresAt]);
        // Oldest sessions beyond the cap are dropped.
        await client.query(
          `DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions ORDER BY id DESC OFFSET ${MAX_SESSIONS})`);
      });
      return { token, expiresAt };
    },

    async verify(token) {
      if (typeof token !== "string" || !TOKEN.test(token)) return null;
      const result = await pool.query(
        `SELECT login, method, expires_at AS "expiresAt" FROM auth_sessions WHERE token_hash = $1 AND expires_at > now()`,
        [hashToken(token)]);
      return result.rows[0] || null;
    },

    async revoke(token) {
      if (typeof token !== "string" || !TOKEN.test(token)) return;
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
    },

    async revokeAll() {
      await pool.query("DELETE FROM auth_sessions");
    }
  };
}

module.exports = { createSessionStore, cookieSettings, readCookie, hashToken, MAX_SESSIONS };
