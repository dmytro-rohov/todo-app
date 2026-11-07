// Member accounts (the owner is configured on the server and is not a row): validation, password checks and
// sessions. Passwords are scrypt hashes like the owner's; a login is lowercase letters, digits, dot, dash, underscore.
const { hashPassword, parsePasswordHash, verifyPassword } = require("./security");
const { memberUser } = require("./access");

const LOGIN = /^[a-z0-9._-]{3,40}$/;
const MAX_USERS = 20;
const USER_COLUMNS = `id, login, name, disabled_at AS "disabledAt", last_login_at AS "lastLoginAt", created_at AS "createdAt"`;
// Spent on unknown logins too, so the answer time does not reveal which logins exist.
let dummyHash = null;

function validateUser(body, { partial = false, reserved = [] } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const allowed = ["login", "name", "password", "disabled"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || (partial && !Object.keys(body).length)) return { error: "Unknown or empty fields" };
  if (partial && "login" in body) return { error: "The login cannot be changed" };
  const value = {};
  if (!partial || "login" in body) {
    const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
    if (!LOGIN.test(login)) return { error: "Login: 3–40 lowercase letters, digits, dot, dash or underscore" };
    if (reserved.map(item => String(item).toLowerCase()).includes(login)) return { error: "This login is taken" };
    value.login = login;
  }
  if (!partial || "name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) return { error: "Name is required" };
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
  return { value };
}

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) return "Password: at least 12 characters";
  return null;
}

function createUserStore(pool) {
  return {
    // The member with this login and password, or null.
    async verify(login, password) {
      const row = (await pool.query("SELECT id, login, name, password_hash, disabled_at FROM users WHERE login = $1",
        [String(login).trim().toLowerCase()])).rows[0];
      if (!row) {
        dummyHash ??= await hashPassword("not-a-real-password");
        await verifyPassword(String(password), parsePasswordHash(dummyHash));
        return null;
      }
      const ok = await verifyPassword(String(password), parsePasswordHash(row.password_hash));
      if (!ok || row.disabled_at) return null;
      await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [row.id]);
      return memberUser(row);
    },
    // The member behind a session, while the account exists, is active and still has that login.
    async forSession(session) {
      if (!session || !session.userId) return null;
      const row = (await pool.query("SELECT id, login, name FROM users WHERE id = $1 AND disabled_at IS NULL", [session.userId])).rows[0];
      return row && row.login === session.login ? memberUser(row) : null;
    }
  };
}

module.exports = { validateUser, passwordProblem, createUserStore, USER_COLUMNS, MAX_USERS, LOGIN };
