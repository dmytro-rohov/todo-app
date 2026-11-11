const express = require("express");
const { withTransaction } = require("../db");
const { recordTaskChanges } = require("../task-history");
const { parseId, validateAssignee } = require("../validation");
const { userId, own, visibleAssignee } = require("../access");

// self: the entry that is an account itself (its picture: accountId = the account, null for the owner, and avatarAt,
// the picture's version, or null without one).
const ASSIGNEE_COLUMNS = `id, name, color, created_at AS "createdAt", (user_id IS NOT DISTINCT FROM $1::integer) AS "mine",
  (account IS NOT NULL) AS "self", CASE WHEN account IS NOT NULL THEN user_id END AS "accountId",
  (SELECT floor(extract(epoch FROM v.updated_at) * 1000)::float8 FROM avatars v WHERE v.account = assignees.account) AS "avatarAt"`;
const accountKey = id => (id === null ? "owner" : `user:${id}`);

// Every account is on its own list of assignees from the start: made the first time its assignees are read, named
// after the account (the owner: "Administrator"; both can rename it).
async function ensureSelf(db, user) {
  const id = userId(user);
  await db.query(
    `INSERT INTO assignees (name, color, user_id, account) VALUES ($1, '#b7e34d', $2, $3) ON CONFLICT (account) DO NOTHING`,
    [(user.name || "Administrator").slice(0, 80), id, accountKey(id)]);
}

module.exports = function createAssigneesRouter(pool) {
  const router = express.Router();

  // One's own entry first, then by name.
  router.get("/", async (req, res) => {
    await ensureSelf(pool, req.user);
    const result = await pool.query(
      `SELECT ${ASSIGNEE_COLUMNS} FROM assignees WHERE ${visibleAssignee("assignees", "$1::integer")}
       ORDER BY (account IS NOT NULL AND user_id IS NOT DISTINCT FROM $1::integer) DESC, name ASC, id ASC`, [userId(req.user)]);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateAssignee(req.body);
    if (error) return res.status(400).json({ message: error });
    const result = await pool.query(
      `INSERT INTO assignees (name, color, user_id) VALUES ($2, $3, $1) RETURNING ${ASSIGNEE_COLUMNS}`, [userId(req.user), value.name, value.color]);
    res.status(201).json(result.rows[0]);
  });

  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid assignee id" });
    const { error, value } = validateAssignee(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const params = [userId(req.user), ...Object.values(value)];
    const assignments = Object.keys(value).map((key, index) => `${key} = $${index + 2}`);
    params.push(id);
    const result = await pool.query(
      `UPDATE assignees SET ${assignments.join(", ")} WHERE id = $${params.length} AND ${own("assignees", "$1::integer")} RETURNING ${ASSIGNEE_COLUMNS}`, params);
    if (!result.rowCount) return res.status(404).json({ message: "Assignee not found" });
    res.json(result.rows[0]);
  });

  // "To ja": an entry someone made for themselves before every account had one. Its tasks go to the account's own
  // entry (each records it) and it is deleted.
  router.post("/:id/into-self", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid assignee id" });
    await ensureSelf(pool, req.user);
    const outcome = await withTransaction(pool, async client => {
      const me = userId(req.user);
      const row = (await client.query(
        `SELECT account FROM assignees a WHERE a.id = $1 AND ${own("a", "$2::integer")} FOR UPDATE`, [id, me])).rows[0];
      if (!row) return 404;
      if (row.account !== null) return 409;
      const self = (await client.query("SELECT id FROM assignees WHERE account = $1", [accountKey(me)])).rows[0].id;
      const moved = await client.query(
        "UPDATE tasks SET assignee_id = $2, updated_at = now() WHERE assignee_id = $1 RETURNING id", [id, self]);
      for (const task of moved.rows) {
        await recordTaskChanges(client, task.id, [{ field: "assignee_id", oldValue: String(id), newValue: String(self) }], req.user.actor);
      }
      await client.query("DELETE FROM assignees WHERE id = $1", [id]);
      return { self, moved: moved.rowCount };
    });
    if (outcome === 404) return res.status(404).json({ message: "Assignee not found" });
    if (outcome === 409) return res.status(409).json({ message: "This is already you" });
    res.json(outcome);
  });

  // Tasks stay, unassigned; each records it. One's own entry stays.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid assignee id" });
    const deleted = await withTransaction(pool, async client => {
      const row = (await client.query(`SELECT account FROM assignees a WHERE a.id = $1 AND ${own("a", "$2::integer")}`, [id, userId(req.user)])).rows[0];
      if (!row) return 0;
      if (row.account !== null) return 409;
      const released = await client.query(
        "UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE assignee_id = $1 RETURNING id", [id]);
      for (const task of released.rows) {
        await recordTaskChanges(client, task.id, [{ field: "assignee_id", oldValue: String(id), newValue: null }], req.user.actor);
      }
      return (await client.query("DELETE FROM assignees WHERE id = $1", [id])).rowCount;
    });
    if (deleted === 409) return res.status(409).json({ message: "Your own entry cannot be deleted" });
    if (!deleted) return res.status(404).json({ message: "Assignee not found" });
    res.json({ message: "Assignee deleted" });
  });

  return router;
};
