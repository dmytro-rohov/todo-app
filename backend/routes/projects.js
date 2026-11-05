const express = require("express");
const { withTransaction } = require("../db");
const { recordTaskChanges } = require("../task-history");
const { parseId, validateProject } = require("../validation");

const PROJECT_COLUMNS = `id, space_id AS "spaceId", name, color, position, archived_at AS "archivedAt", created_at AS "createdAt"`;

async function spaceExists(db, id) {
  return (await db.query("SELECT 1 FROM spaces WHERE id = $1", [id])).rowCount > 0;
}

module.exports = function createProjectsRouter(pool) {
  const router = express.Router();

  // ?spaceId=<id> narrows to one space; archived projects are listed only with ?archived=true.
  router.get("/", async (req, res) => {
    const conditions = [];
    const params = [];
    if (req.query.spaceId !== undefined) {
      const id = parseId(req.query.spaceId);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(id); conditions.push(`space_id = $${params.length}`);
    }
    if (req.query.archived !== "true") conditions.push("archived_at IS NULL");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM projects ${where} ORDER BY position ASC, id ASC`, params);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateProject(req.body);
    if (error) return res.status(400).json({ message: error });
    if (value.archived !== undefined) return res.status(400).json({ message: "Unknown or empty fields" });
    if (!(await spaceExists(pool, value.spaceId))) return res.status(400).json({ message: "Space does not exist" });
    const result = await pool.query(
      `INSERT INTO projects (space_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING ${PROJECT_COLUMNS}`,
      [value.spaceId, value.name, value.color, value.position ?? 0]
    );
    res.status(201).json(result.rows[0]);
  });

  // Moving a project to another space moves its tasks with it, and each moved task records the change.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid project id" });
    const { error, value } = validateProject(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const project = await withTransaction(pool, async client => {
      const current = await client.query("SELECT space_id FROM projects WHERE id = $1 FOR UPDATE", [id]);
      if (!current.rowCount) return { status: 404 };
      if (value.spaceId !== undefined && !(await spaceExists(client, value.spaceId))) return { status: 400 };
      const columns = { name: "name", color: "color", position: "position", spaceId: "space_id" };
      const params = [];
      const assignments = Object.entries(value).filter(([key]) => key in columns).map(([key, val]) => {
        params.push(val); return `${columns[key]} = $${params.length}`;
      });
      if (value.archived !== undefined) assignments.push(value.archived ? "archived_at = COALESCE(archived_at, now())" : "archived_at = NULL");
      params.push(id);
      const updated = await client.query(`UPDATE projects SET ${assignments.join(", ")} WHERE id = $${params.length} RETURNING ${PROJECT_COLUMNS}`, params);
      const oldSpace = current.rows[0].space_id;
      if (value.spaceId !== undefined && value.spaceId !== oldSpace) {
        const moved = await client.query(
          "UPDATE tasks SET space_id = $1, updated_at = now() WHERE project_id = $2 AND space_id IS DISTINCT FROM $1 RETURNING id, space_id",
          [value.spaceId, id]);
        for (const row of moved.rows) {
          await recordTaskChanges(client, row.id, [{ field: "space_id", oldValue: String(oldSpace), newValue: String(value.spaceId) }]);
        }
      }
      return { status: 200, body: updated.rows[0] };
    });
    if (project.status === 404) return res.status(404).json({ message: "Project not found" });
    if (project.status === 400) return res.status(400).json({ message: "Space does not exist" });
    res.json(project.body);
  });

  // Tasks keep existing without the project; each records that it left it.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid project id" });
    const deleted = await withTransaction(pool, async client => {
      const released = await client.query(
        "UPDATE tasks SET project_id = NULL, updated_at = now() WHERE project_id = $1 RETURNING id", [id]);
      for (const row of released.rows) {
        await recordTaskChanges(client, row.id, [{ field: "project_id", oldValue: String(id), newValue: null }]);
      }
      return (await client.query("DELETE FROM projects WHERE id = $1", [id])).rowCount;
    });
    if (!deleted) return res.status(404).json({ message: "Project not found" });
    res.json({ message: "Project deleted" });
  });

  return router;
};
