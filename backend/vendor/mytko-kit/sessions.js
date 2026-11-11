// Server-side browser sessions. The cookie carries a random 256-bit token; the database keeps only its SHA-256, so
// sessions survive restarts and releases but a database read never yields a usable cookie. Sessions are never
// extended: they end at expires_at or on logout. `npm run revoke-sessions` ends them all.
const crypto = require("node:crypto");
const { withTransaction } = require("./db");

// Per account: signing in on a new device often never pushes another account out.
const MAX_SESSIONS = 16;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Cookie name and attributes ("mytko-<app>-session", e.g. mytko-finance-session). The __Host- prefix (Secure, Path=/,
// no Domain) is used whenever the app is served over HTTPS; plain HTTP is only for local development.
function cookieSettings(publicOrigin, appId) {
  if (typeof appId !== "string" || !APP_ID.test(appId)) throw new Error("cookieSettings needs the app id (e.g. \"finance\")");
  const secure = publicOrigin.startsWith("https://");
  return { name: secure ? `__Host-mytko-${appId}-session` : `mytko-${appId}-session`, secure };
}

function readCookie(req, name) {
  for (const part of (req.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// Options for an app whose sessions table or owner differ (Tasks), defaults = Finance / Fitness:
//   maxSessions      a number, or userId => number (Tasks: 32 for the owner, 8 for a member)
//   ownerWithoutRow  the owner is not a row in users: its sessions have user_id NULL and are capped together
//   ssoLogin         false: the table has no sso_login column (Tasks); "mytko" sessions are then tied to the login only
function createSessionStore(pool, { ttlMs, maxSessions = MAX_SESSIONS, ownerWithoutRow = false, ssoLogin: withSsoLogin = true }) {
  const cap = typeof maxSessions === "function" ? maxSessions : () => maxSessions;
  return {
    ttlMs,

    // ssoLogin: for a "mytko" session, the Mytko Workflow login that signed in (users.js checks it against the
    // configuration on every request). db: a transaction to create the session in (a password change), else its own.
    async create({ userId, login, method = "password", ssoLogin = null }, db = null) {
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + ttlMs);
      const run = db ? fn => fn(db) : fn => withTransaction(pool, fn);
      await run(async client => {
        await client.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
        if (withSsoLogin) {
          await client.query(
            "INSERT INTO auth_sessions (token_hash, user_id, login, method, expires_at, sso_login) VALUES ($1, $2, $3, $4, $5, $6)",
            [hashToken(token), userId, login, method, expiresAt, ssoLogin]);
        } else {
          await client.query(
            "INSERT INTO auth_sessions (token_hash, user_id, login, method, expires_at) VALUES ($1, $2, $3, $4, $5)",
            [hashToken(token), userId ?? null, login, method, expiresAt]);
        }
        // This account's oldest sessions beyond its cap are dropped.
        await client.query(ownerWithoutRow
          ? `DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE user_id IS NOT DISTINCT FROM $1::integer
             ORDER BY id DESC OFFSET ${cap(userId ?? null)})`
          : `DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE user_id = $1
             ORDER BY id DESC OFFSET ${cap(userId)})`, [ownerWithoutRow ? userId ?? null : userId]);
      });
      return { token, expiresAt };
    },

    async verify(token) {
      if (typeof token !== "string" || !TOKEN.test(token)) return null;
      const result = await pool.query(withSsoLogin
        ? `SELECT user_id AS "userId", login, method, sso_login AS "ssoLogin", expires_at AS "expiresAt" FROM auth_sessions
          WHERE token_hash = $1 AND expires_at > now()`
        : `SELECT user_id AS "userId", login, method, expires_at AS "expiresAt" FROM auth_sessions
          WHERE token_hash = $1 AND expires_at > now()`,
        [hashToken(token)]);
      return result.rows[0] || null;
    },

    async revoke(token) {
      if (typeof token !== "string" || !TOKEN.test(token)) return;
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
    },

    // Ends every session of one account (password changed, account blocked).
    async revokeUser(userId) {
      await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
    },

    async revokeAll() {
      await pool.query("DELETE FROM auth_sessions");
    }
  };
}

module.exports = { createSessionStore, cookieSettings, readCookie, hashToken, MAX_SESSIONS };
