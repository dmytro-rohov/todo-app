// Accounts, managed by the administrator (mounted behind adminOnly): the list, new member accounts with their login,
// start password and language, a new password, blocking and deleting. The administrator's own account is configured on
// the server (ADMIN_*) and cannot be changed here.
//
// Options for an app's own needs:
//   reserved       logins nobody may take (the administrator's, "admin", …)
//   removeAccount  async (db, id) => what deleting a member takes, inside the transaction that locked the account row:
//                  the account's own data first, then the row. Return { status, message } to refuse instead
//                  (e.g. Finance: 409 when the account has shared history). Default: the row only.
//   listColumns    the SELECT list of the account list (default below) and present(row) -> JSON for each row
//   extraFields    { name: { column, check(value) -> { value } | { error }, insert(value) -> db value, update(value) -> db value } }
//                  more account fields set by the administrator (e.g. Finance's work_enabled, admin_note)
//   beforeUpdate   async (db, id, value) => the app's checks of a change, inside its transaction before the update:
//                  { status, message } refuses it (nothing is changed), { endSessions: true } also ends the account's
//                  sessions (e.g. Finance: another currency, refused while the account is in a group in another one)
// Express is the app's own dependency, loaded when a router is made (the kit itself loads with Node alone: an app's
// configuration check runs without node_modules).
const loadExpress = () => require("express");
const { hashPassword } = require("../security");
const { withTransaction } = require("../db");
const { validateUser, MAX_USERS } = require("../users");

const ACCOUNTS_LOCK_ID = 7243917463;
const LIST_COLUMNS = `id, login, name, role, lang, disabled_at AS "disabledAt", last_login_at AS "lastLoginAt",
  created_at AS "createdAt"`;
const COLUMN = /^[a-z_]+$/;

function parseId(value) {
  return /^[1-9][0-9]{0,9}$/.test(String(value)) && Number(value) <= 2147483647 ? Number(value) : null;
}

async function removeRow(db, id) {
  await db.query("DELETE FROM users WHERE id = $1 AND role = 'member'", [id]);
}

function createUsersRouter(pool, { reserved = [], removeAccount = removeRow, listColumns = LIST_COLUMNS, present = row => row ?? null,
  extraFields = {}, beforeUpdate = null } = {}) {
  const router = loadExpress().Router();
  const extras = Object.entries(extraFields);
  if (extras.some(([, field]) => !COLUMN.test(field.column))) throw new Error("extraFields need a plain column name");
  const checks = Object.fromEntries(extras.map(([name, field]) => [name, field.check]));
  const read = async id => present((await pool.query(`SELECT ${listColumns} FROM users WHERE id = $1`, [id])).rows[0]);
  // A member's row (null: no such account, "admin": the administrator's).
  const target = async id => {
    const row = (await pool.query("SELECT role FROM users WHERE id = $1", [id])).rows[0];
    return row ? row.role : null;
  };

  router.get("/", async (req, res) => {
    const rows = (await pool.query(`SELECT ${listColumns} FROM users ORDER BY (role = 'admin') DESC, lower(name), id`)).rows;
    res.json(rows.map(present));
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateUser(req.body, { reserved, extraFields: checks });
    if (error) return res.status(400).json({ message: error });
    const hash = await hashPassword(value.password);
    const columns = ["login", "name", "password_hash", "role", "lang", ...extras.map(([, field]) => field.column)];
    const params = [value.login, value.name, hash, value.lang || "uk", ...extras.map(([name, field]) => field.insert(value[name]))];
    // $1, $2, $3, 'member', $4, …: every value a parameter except the fixed role
    const placeholders = ["$1", "$2", "$3", "'member'", ...params.slice(3).map((_, index) => `$${index + 4}`)];
    try {
      // the limit is counted and the account added under one lock, so parallel requests cannot pass it together
      const id = await withTransaction(pool, async db => {
        await db.query("SELECT pg_advisory_xact_lock($1)", [ACCOUNTS_LOCK_ID]);
        if ((await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n >= MAX_USERS) return null;
        return (await db.query(
          `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
          params)).rows[0].id;
      });
      if (id === null) return res.status(409).json({ message: "Too many accounts" });
      res.status(201).json(await read(id));
    } catch (failure) {
      if (failure.code === "23505") return res.status(409).json({ message: "This login is taken" });
      throw failure;
    }
  });

  // Name, language, the app's own fields, a new password (ends the account's sessions) or blocking (ends them too;
  // unblocking lets the person sign in again).
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const { error, value } = validateUser(req.body, { partial: true, extraFields: checks });
    if (error) return res.status(400).json({ message: error });
    const role = await target(id);
    if (!role) return res.status(404).json({ message: "Account not found" });
    if (role === "admin") return res.status(400).json({ message: "The administrator is configured on the server" });
    const assignments = [];
    const params = [];
    const set = (column, item) => { params.push(item); assignments.push(`${column} = $${params.length}`); };
    if (value.name !== undefined) set("name", value.name);
    if (value.lang !== undefined) set("lang", value.lang);
    for (const [name, field] of extras) if (value[name] !== undefined) set(field.column, field.update(value[name]));
    if (value.password !== undefined) set("password_hash", await hashPassword(value.password));
    if (value.disabled !== undefined) assignments.push(value.disabled ? "disabled_at = COALESCE(disabled_at, now())" : "disabled_at = NULL");
    params.push(id);
    // a new password or blocking (or what the app's beforeUpdate asks for) ends the account's sessions in the same
    // transaction
    const refused = await withTransaction(pool, async db => {
      const checked = (beforeUpdate && await beforeUpdate(db, id, value)) || {};
      if (checked.status) return checked;
      await db.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $${params.length} AND role = 'member'`, params);
      if (value.password !== undefined || value.disabled || checked.endSessions) await db.query("DELETE FROM auth_sessions WHERE user_id = $1", [id]);
      return null;
    });
    if (refused) return res.status(refused.status).json({ message: refused.message });
    res.json(await read(id));
  });

  // Deletes a member account with its sessions and what removeAccount takes with it.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const role = await target(id);
    if (!role) return res.status(404).json({ message: "Account not found" });
    if (role === "admin") return res.status(400).json({ message: "The administrator is configured on the server" });
    const refused = await withTransaction(pool, async db => {
      if (!(await db.query("SELECT id FROM users WHERE id = $1 AND role = 'member' FOR UPDATE", [id])).rowCount) {
        return { status: 404, message: "Account not found" };
      }
      return (await removeAccount(db, id)) || null;
    });
    if (refused) return res.status(refused.status).json({ message: refused.message });
    res.json({ message: "Account deleted" });
  });

  return router;
}

module.exports = { createUsersRouter, parseId, LIST_COLUMNS };
