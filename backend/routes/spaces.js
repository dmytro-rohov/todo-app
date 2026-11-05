const express = require("express");
const { withTransaction } = require("../db");
const { defaultSpaces } = require("../spaces");
const { recordTaskChanges } = require("../task-history");
const { parseId, validateSpace } = require("../validation");

const SPACE_COLUMNS = `id, key, name, color, agent_visible AS "agentVisible", position, created_at AS "createdAt"`;
const FOREIGN_KEY_VIOLATION = "23503";

module.exports = function createSpacesRouter(pool) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    await defaultSpaces(pool);
    const result = await pool.query(`SELECT ${SPACE_COLUMNS} FROM spaces ORDER BY position ASC, id ASC`);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateSpace(req.body);
    if (error) return res.status(400).json({ message: error });
    const result = await pool.query(
      `INSERT INTO spaces (name, color, agent_visible, position) VALUES ($1, $2, $3, $4) RETURNING ${SPACE_COLUMNS}`,
      [value.name, value.color, value.agentVisible ?? false, value.position ?? 0]
    );
    res.status(201).json(result.rows[0]);
  });

  // Built-in spaces can be renamed and recoloured, but the private space can never become visible to agents.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    const { error, value } = validateSpace(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const current = await pool.query("SELECT key FROM spaces WHERE id = $1", [id]);
    if (!current.rowCount) return res.status(404).json({ message: "Space not found" });
    if (current.rows[0].key === "private" && value.agentVisible === true) {
      return res.status(400).json({ message: "The private space is never visible to agents" });
    }
    const columns = { name: "name", color: "color", position: "position", agentVisible: "agent_visible" };
    const params = Object.values(value);
    const assignments = Object.keys(value).map((key, index) => `${columns[key]} = $${index + 1}`);
    params.push(id);
    const result = await pool.query(`UPDATE spaces SET ${assignments.join(", ")} WHERE id = $${params.length} RETURNING ${SPACE_COLUMNS}`, params);
    res.json(result.rows[0]);
  });

  // Tasks of a deleted space fall back to private (fail closed). A space that still has projects is refused.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    try {
      const outcome = await withTransaction(pool, async client => {
        const current = await client.query("SELECT key FROM spaces WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rowCount) return 404;
        if (current.rows[0].key !== null) return 409;
        const spaces = await defaultSpaces(client);
        const moved = await client.query(
          "UPDATE tasks SET space_id = $1, updated_at = now() WHERE space_id = $2 RETURNING id", [spaces.private, id]);
        for (const row of moved.rows) {
          await recordTaskChanges(client, row.id, [{ field: "space_id", oldValue: String(id), newValue: String(spaces.private) }]);
        }
        await client.query("DELETE FROM spaces WHERE id = $1", [id]);
        return 200;
      });
      if (outcome === 404) return res.status(404).json({ message: "Space not found" });
      if (outcome === 409) return res.status(409).json({ message: "Built-in spaces cannot be deleted" });
      res.json({ message: "Space deleted" });
    } catch (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) return res.status(409).json({ message: "Space still has projects" });
      throw error;
    }
  });

  return router;
};
