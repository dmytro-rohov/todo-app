const express = require("express");
const { withTransaction } = require("../db");
const { recordTaskChanges } = require("../task-history");
const { parseId, validateAssignee } = require("../validation");
const { userId, own, visibleAssignee } = require("../access");

const ASSIGNEE_COLUMNS = `id, name, color, created_at AS "createdAt", (user_id IS NOT DISTINCT FROM $1::integer) AS "mine"`;

module.exports = function createAssigneesRouter(pool) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const result = await pool.query(`SELECT ${ASSIGNEE_COLUMNS} FROM assignees a WHERE ${visibleAssignee("a", "$1::integer")} ORDER BY name ASC, id ASC`, [userId(req.user)]);
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
      `UPDATE assignees a SET ${assignments.join(", ")} WHERE a.id = $${params.length} AND ${own("a", "$1::integer")} RETURNING ${ASSIGNEE_COLUMNS}`, params);
    if (!result.rowCount) return res.status(404).json({ message: "Assignee not found" });
    res.json(result.rows[0]);
  });

  // Tasks stay, unassigned; each records it.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid assignee id" });
    const deleted = await withTransaction(pool, async client => {
      if (!(await client.query(`SELECT 1 FROM assignees a WHERE a.id = $1 AND ${own("a", "$2::integer")}`, [id, userId(req.user)])).rowCount) return 0;
      const released = await client.query(
        "UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE assignee_id = $1 RETURNING id", [id]);
      for (const row of released.rows) {
        await recordTaskChanges(client, row.id, [{ field: "assignee_id", oldValue: String(id), newValue: null }], req.user.actor);
      }
      return (await client.query("DELETE FROM assignees WHERE id = $1", [id])).rowCount;
    });
    if (!deleted) return res.status(404).json({ message: "Assignee not found" });
    res.json({ message: "Assignee deleted" });
  });

  return router;
};
