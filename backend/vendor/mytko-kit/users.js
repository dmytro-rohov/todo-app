// Accounts. Every person is a row in `users`: the administrator (role "admin") and member accounts (role "member",
// e.g. a partner) that the administrator creates in the app. The administrator's row is created and kept in step with
// ADMIN_LOGIN / ADMIN_NAME / ADMIN_PASSWORD_HASH from the server's environment, so that password is set on the server
// only. Logins are stored lowercase. Passwords are scrypt hashes (security.js).
//
// An app with more account columns (e.g. Finance's work_enabled, avatar_at) passes `columns` (the SELECT list, which
// must include id, login, name, role, lang) and `toUser` (row -> the frozen account object) to createUserStore, and
// `extraFields` to validateUser.
const { dummyPasswordCheck, hashPassword, parsePasswordHash, verifyPassword } = require("./security");
const { withTransaction } = require("./db");

const LOGIN = /^[a-z0-9._-]{3,40}$/;
const LANGUAGES = ["uk", "pl"];
const MAX_USERS = 20;
const PASSWORD_MIN = 12;
const USER_COLUMNS = "id, login, name, role, lang";

function toUser(row) {
  return Object.freeze({ id: row.id, login: row.login, name: row.name, role: row.role, lang: row.lang });
}

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > 1024) return "Password: at least 12 characters";
  return null;
}

// A new account (all of login, name, password; lang optional) or changes to one (partial: any of name, password,
// disabled, lang; the login never changes). extraFields: the app's own optional fields, { name: value => ({ value }) or
// ({ error }) }, checked after the shared ones in the order given.
function validateUser(body, { partial = false, reserved = [], extraFields = {} } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const extra = Object.keys(extraFields);
  const allowed = [...(partial ? ["name", "password", "disabled", "lang"] : ["login", "name", "password", "lang"]), ...extra];
  if (partial && "login" in body) return { error: "The login cannot be changed" };
  if (Object.keys(body).some(key => !allowed.includes(key)) || (partial && !Object.keys(body).length)) return { error: "Unknown or empty fields" };
  const value = {};
  if (!partial) {
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    if (!LOGIN.test(login)) return { error: "Login: 3–40 lowercase letters, digits, dot, dash or underscore" };
    if (reserved.map(item => String(item).toLowerCase()).includes(login)) return { error: "This login is taken" };
    value.login = login;
  }
  if (!partial || "name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) return { error: "Name is required" };
    value.name = body.name.trim();
  }
  if (!partial || "password" in body) {
    const problem = passwordProblem(body.password);
    if (problem) return { error: problem };
    value.password = body.password;
  }
  if ("disabled" in body) {
    if (typeof body.disabled !== "boolean") return { error: "Invalid disabled" };
    value.disabled = body.disabled;
  }
  if ("lang" in body) {
    if (!LANGUAGES.includes(body.lang)) return { error: "Unsupported language" };
    value.lang = body.lang;
  }
  for (const name of extra) {
    if (!(name in body)) continue;
    const checked = extraFields[name](body[name]);
    if (checked.error) return { error: checked.error };
    value[name] = checked.value;
  }
  return { value };
}

// sso: the "Zaloguj kontem Mytko" configuration (null when off); a "mytko" session counts only while it is on and
// MYTKO_SSO_LOGIN is still the Workflow login that started it.
function createUserStore(pool, { admin, sessions = null, sso = null, columns = USER_COLUMNS, toUser: present = toUser }) {
  let adminReady = null;
  // Unknown logins cost a check like the administrator's (the same scrypt parameters as ADMIN_PASSWORD_HASH), so the
  // answer time does not tell the configured login apart from a login that does not exist.
  const adminHash = admin && admin.passwordHash ? parsePasswordHash(admin.passwordHash) : null;

  // Creates the administrator's row on first use, and afterwards keeps its role, name and password equal to the
  // server's configuration. A new ADMIN_PASSWORD_HASH ends the administrator's older sessions in the same transaction,
  // so a failure in between can never leave the new password stored with the old sessions still valid. Another login
  // configured as ADMIN_LOGIN takes the role over; the previous administrator becomes a member. Retried on the next
  // request when the database is not ready yet.
  async function syncAdmin() {
    await withTransaction(pool, async db => {
      const row = (await db.query("SELECT id, role, name, password_hash, disabled_at FROM users WHERE login = $1 FOR UPDATE", [admin.login])).rows[0];
      if (!row) {
        await db.query(
          `INSERT INTO users (login, name, password_hash, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (login) DO NOTHING`,
          [admin.login, admin.name, admin.passwordHash]);
      } else if (row.role !== "admin" || row.name !== admin.name || row.password_hash !== admin.passwordHash || row.disabled_at) {
        await db.query("UPDATE users SET role = 'admin', name = $2, password_hash = $3, disabled_at = NULL WHERE id = $1",
          [row.id, admin.name, admin.passwordHash]);
        if (row.password_hash !== admin.passwordHash) await db.query("DELETE FROM auth_sessions WHERE user_id = $1", [row.id]);
      }
      await db.query("UPDATE users SET role = 'member' WHERE role = 'admin' AND login <> $1", [admin.login]);
    });
  }

  function ensureAdmin() {
    adminReady ??= syncAdmin().catch(error => {
      adminReady = null;
      throw error;
    });
    return adminReady;
  }

  return {
    ensureAdmin,

    // A sign-in that checked no password here ("Zaloguj kontem Mytko"): the account list shows it as the last login.
    async recordLogin(userId) {
      await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
    },

    // The administrator's account ("Zaloguj kontem Mytko" signs in as it).
    async admin() {
      await ensureAdmin();
      const row = (await pool.query(`SELECT ${columns} FROM users WHERE login = $1 AND role = 'admin' AND disabled_at IS NULL`, [admin.login])).rows[0];
      return row ? present(row) : null;
    },

    // Signs in with a login and password: { user, session } or null. The password is checked first (scrypt, slow);
    // the session is then created in a transaction that locks the account row (FOR UPDATE from the start: a shared
    // lock upgraded by the last_login_at update would deadlock two parallel logins) and finds the same password hash
    // still stored. A new password or a block committed in between (they also end the account's sessions) makes this login
    // fail instead of leaving a session that was granted on the old password; one committed after it ends this session
    // too.
    async login(login, password) {
      const checked = await this.verify(login, password, { withHash: true });
      if (!checked) return null;
      const session = await withTransaction(pool, async db => {
        const row = (await db.query("SELECT password_hash FROM users WHERE id = $1 AND disabled_at IS NULL FOR UPDATE", [checked.user.id])).rows[0];
        if (!row || row.password_hash !== checked.hash) return null;
        await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [checked.user.id]);
        return sessions.create({ userId: checked.user.id, login: checked.user.login }, db);
      });
      return session ? { user: checked.user, session } : null;
    },

    // The active account with this login and password, or null (withHash: also the stored hash that matched).
    async verify(login, password, { withHash = false } = {}) {
      await ensureAdmin();
      const row = (await pool.query(`SELECT ${columns}, password_hash, disabled_at FROM users WHERE login = $1`,
        [String(login).trim().toLowerCase()])).rows[0];
      if (!row) {
        await dummyPasswordCheck(password, adminHash);
        return null;
      }
      const ok = await verifyPassword(String(password), parsePasswordHash(row.password_hash));
      if (!ok || row.disabled_at) return null;
      return withHash ? { user: present(row), hash: row.password_hash } : present(row);
    },

    // The session and account behind a browser cookie. The administrator's row is brought in step with the
    // configuration before the session is looked up, so after a restart with a new ADMIN_PASSWORD_HASH (which ends the
    // administrator's sessions) or another ADMIN_LOGIN no older session keeps the old administrator's access.
    async fromToken(token) {
      await ensureAdmin();
      const session = sessions ? await sessions.verify(token) : null;
      const user = await this.forSession(session);
      return user ? { session, user } : { session: null, user: null };
    },

    // The account behind a session, while it exists, is active and still has that login.
    async forSession(session) {
      if (!session || !session.userId) return null;
      if (session.method === "mytko" && (!sso || session.ssoLogin !== sso.login)) return null;
      const row = (await pool.query(`SELECT ${columns} FROM users WHERE id = $1 AND disabled_at IS NULL`, [session.userId])).rows[0];
      return row && row.login === session.login ? present(row) : null;
    },

    async setLang(userId, lang) {
      const row = (await pool.query(`UPDATE users SET lang = $2 WHERE id = $1 RETURNING ${columns}`, [userId, lang])).rows[0];
      return row ? present(row) : null;
    },

    // A member's own password change, in one transaction on the locked account row: the current password is checked
    // against the stored one, the new one replaces it, every session ends and this browser's new session is created.
    // A reset by the administrator at the same time therefore runs wholly before (the current password no longer
    // matches) or wholly after (its own reset wins and ends this new session too). Returns the new session, or null
    // when the current password is wrong.
    async changeOwnPassword(userId, current, next) {
      const hash = await hashPassword(next);
      return withTransaction(pool, async db => {
        const row = (await db.query("SELECT login, password_hash FROM users WHERE id = $1 AND disabled_at IS NULL FOR UPDATE", [userId])).rows[0];
        if (!row || typeof current !== "string" || current.length > 1024 || !(await verifyPassword(current, parsePasswordHash(row.password_hash)))) {
          return null;
        }
        await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, hash]);
        await db.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
        return sessions.create({ userId, login: row.login }, db);
      });
    }
  };
}

module.exports = { createUserStore, toUser, validateUser, passwordProblem, LOGIN, LANGUAGES, MAX_USERS, PASSWORD_MIN, USER_COLUMNS };
