// Member accounts, managed by the owner (mounted behind ownerOnly). A new member gets an empty board with their own
// private space; a shared space shows up for them once they are put in it or join it with a code.
const express = require("express");
const { withTransaction } = require("../kit");
const { hashPassword } = require("../security");
const { validateUser, USER_COLUMNS, MAX_USERS } = require("../users");
const { defaultSpaces, keepOwnReferences } = require("../spaces");
const { memberUser } = require("../access");
const { recordTaskChanges } = require("../task-history");
const { parseId } = require("../validation");

const LIST_COLUMNS = `${USER_COLUMNS}, (SELECT count(*)::int FROM tasks t WHERE t.user_id = users.id AND t.archived_at IS NULL) AS "openTasks",
  (SELECT floor(extract(epoch FROM a.updated_at) * 1000)::bigint FROM avatars a WHERE a.account = 'user:' || users.id) AS "avatarAt"`;
const present = row => (row ? { ...row, avatarAt: row.avatarAt === null ? null : Number(row.avatarAt) } : null);

module.exports = function createUsersRouter(pool, { sessions, reserved }) {
  const router = express.Router();
  const read = async id => present((await pool.query(`SELECT ${LIST_COLUMNS} FROM users WHERE id = $1`, [id])).rows[0]);

  router.get("/", async (req, res) => {
    res.json((await pool.query(`SELECT ${LIST_COLUMNS} FROM users ORDER BY lower(name), id`)).rows.map(present));
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateUser(req.body, { reserved });
    if (error) return res.status(400).json({ message: error });
    if (value.disabled !== undefined) return res.status(400).json({ message: "Unknown or empty fields" });
    if ((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n >= MAX_USERS) {
      return res.status(409).json({ message: "Too many accounts" });
    }
    const passwordHash = await hashPassword(value.password);
    try {
      const id = await withTransaction(pool, async db => {
        const row = (await db.query("INSERT INTO users (login, name, password_hash) VALUES ($1, $2, $3) RETURNING id, login, name",
          [value.login, value.name, passwordHash])).rows[0];
        await defaultSpaces(db, memberUser(row));
        return row.id;
      });
      res.status(201).json(await read(id));
    } catch (failure) {
      if (failure.code === "23505") return res.status(409).json({ message: "This login is taken" });
      throw failure;
    }
  });

  // Name, a new password (ends the member's sessions) or disabling (ends them too; enabling lets them sign in again).
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const { error, value } = validateUser(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const assignments = [];
    const params = [];
    if (value.name !== undefined) { params.push(value.name); assignments.push(`name = $${params.length}`); }
    if (value.password !== undefined) { params.push(await hashPassword(value.password)); assignments.push(`password_hash = $${params.length}`); }
    if (value.disabled !== undefined) assignments.push(value.disabled ? "disabled_at = COALESCE(disabled_at, now())" : "disabled_at = NULL");
    params.push(id);
    const result = await pool.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $${params.length}`, params);
    if (!result.rowCount) return res.status(404).json({ message: "Account not found" });
    if (value.password !== undefined || value.disabled) await sessions.revokeUser(id);
    res.json(await read(id));
  });

  // Deletes the account with everything it created. The owner's tasks in the member's shared spaces and projects stay:
  // they move to the owner's private space, without the project.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const deleted = await withTransaction(pool, async db => {
      if (!(await db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [id])).rowCount) return false;
      const ownerPrivate = (await defaultSpaces(db)).private;
      // each to its own creator's private space (the owner's, or another member's), without the project
      const kept = await db.query(
        `WITH moved AS (
           SELECT t.id, t.space_id AS old_space FROM tasks t
           WHERE t.user_id IS DISTINCT FROM $2 AND (t.space_id IN (SELECT id FROM spaces WHERE user_id = $2) OR t.project_id IN (SELECT id FROM projects WHERE user_id = $2))
           FOR UPDATE)
         UPDATE tasks t SET space_id = COALESCE((SELECT s.id FROM spaces s WHERE s.key = 'private:' || t.user_id), $1), project_id = NULL, updated_at = now()
         FROM moved WHERE t.id = moved.id RETURNING t.id, t.space_id, moved.old_space`, [ownerPrivate, id]);
      for (const row of kept.rows) {
        await recordTaskChanges(db, row.id, [{ field: "space_id", oldValue: row.old_space === null ? null : String(row.old_space), newValue: String(row.space_id) }], "accounts");
      }
      await keepOwnReferences(db, kept.rows.map(row => row.id), "accounts", recordTaskChanges);
      await db.query("DELETE FROM tasks WHERE user_id = $1", [id]);
      await db.query("DELETE FROM projects WHERE user_id = $1 OR space_id IN (SELECT id FROM spaces WHERE user_id = $1)", [id]);
      await db.query("DELETE FROM spaces WHERE user_id = $1", [id]);
      await db.query("DELETE FROM users WHERE id = $1", [id]);
      return true;
    });
    if (!deleted) return res.status(404).json({ message: "Account not found" });
    res.json({ message: "Account deleted" });
  });

  return router;
};
