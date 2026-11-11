const express = require("express");
const { withTransaction } = require("../db");
const { recordTaskChanges } = require("../task-history");
const { defaultSpaces, keepOwnReferences } = require("../spaces");
const { parseId, validateProject } = require("../validation");
const { isOwner, userId, own, visibleProject, visibleSpace } = require("../access");

const PROJECT_COLUMNS = `id, space_id AS "spaceId", client_id AS "clientId", name, color, position, archived_at AS "archivedAt", created_at AS "createdAt",
  (user_id IS NOT DISTINCT FROM $1::integer) AS "mine"`;

// Projects go into spaces the account can see (its own or shared); clients are the owner's only.
async function spaceExists(db, id, user) {
  return (await db.query(`SELECT 1 FROM spaces s WHERE s.id = $1 AND ${visibleSpace("s", "$2::integer")}`, [id, userId(user)])).rowCount > 0;
}
const clientRefused = (user, value) => !isOwner(user) && (value.clientId ?? null) !== null;

module.exports = function createProjectsRouter(pool) {
  const router = express.Router();

  // ?spaceId=<id> narrows to one space; archived projects are listed only with ?archived=true.
  router.get("/", async (req, res) => {
    const params = [userId(req.user)];
    const conditions = [visibleProject("projects", "$1::integer")];
    if (req.query.spaceId !== undefined) {
      const id = parseId(req.query.spaceId);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(id); conditions.push(`space_id = $${params.length}`);
    }
    if (req.query.archived !== "true") conditions.push("archived_at IS NULL");
    const where = `WHERE ${conditions.join(" AND ")}`;
    const result = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM projects ${where} ORDER BY position ASC, id ASC`, params);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateProject(req.body);
    if (error) return res.status(400).json({ message: error });
    if (value.archived !== undefined) return res.status(400).json({ message: "Unknown or empty fields" });
    if (clientRefused(req.user, value)) return res.status(400).json({ message: "Clients are not available for this account" });
    if (!(await spaceExists(pool, value.spaceId, req.user))) return res.status(400).json({ message: "Space does not exist" });
    const result = await pool.query(
      `INSERT INTO projects (space_id, name, color, position, client_id, user_id) VALUES ($2, $3, $4, $5, $6, $1) RETURNING ${PROJECT_COLUMNS}`,
      [userId(req.user), value.spaceId, value.name, value.color, value.position ?? 0, value.clientId ?? null]
    );
    res.status(201).json(result.rows[0]);
  });

  // Moving a project to another space moves its tasks with it, and each moved task records the change.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid project id" });
    const { error, value } = validateProject(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    if (clientRefused(req.user, value)) return res.status(400).json({ message: "Clients are not available for this account" });
    const project = await withTransaction(pool, async client => {
      const current = await client.query(`SELECT space_id FROM projects p WHERE p.id = $1 AND ${own("p", "$2::integer")} FOR UPDATE`, [id, userId(req.user)]);
      if (!current.rowCount) return { status: 404 };
      if (value.spaceId !== undefined && !(await spaceExists(client, value.spaceId, req.user))) return { status: 400 };
      const columns = { name: "name", color: "color", position: "position", spaceId: "space_id", clientId: "client_id" };
      const params = [userId(req.user)];
      const assignments = Object.entries(value).filter(([key]) => key in columns).map(([key, val]) => {
        params.push(val); return `${columns[key]} = $${params.length}`;
      });
      if (value.archived !== undefined) assignments.push(value.archived ? "archived_at = COALESCE(archived_at, now())" : "archived_at = NULL");
      params.push(id);
      const updated = await client.query(`UPDATE projects SET ${assignments.join(", ")} WHERE id = $${params.length} RETURNING ${PROJECT_COLUMNS}`, params);
      const oldSpace = current.rows[0].space_id;
      if (value.spaceId !== undefined && value.spaceId !== oldSpace) {
        // Other accounts' tasks follow only where their creators can see them; the others go to their creators'
        // private spaces, without the project.
        const home = await client.query(
          `UPDATE tasks t SET space_id = COALESCE((SELECT s.id FROM spaces s WHERE s.key = 'private:' || t.user_id), $3), project_id = NULL, updated_at = now()
           WHERE t.project_id = $1 AND NOT EXISTS (SELECT 1 FROM spaces dest WHERE dest.id = $2 AND ${visibleSpace("dest", "t.user_id")})
           RETURNING t.id, t.space_id`,
          [id, value.spaceId, (await defaultSpaces(client)).private]);
        for (const row of home.rows) {
          await recordTaskChanges(client, row.id, [{ field: "space_id", oldValue: String(oldSpace), newValue: String(row.space_id) }], req.user.actor);
        }
        await keepOwnReferences(client, home.rows.map(row => row.id), req.user.actor, recordTaskChanges);
        const moved = await client.query(
          "UPDATE tasks SET space_id = $1, updated_at = now() WHERE project_id = $2 AND space_id IS DISTINCT FROM $1 RETURNING id, space_id",
          [value.spaceId, id]);
        for (const row of moved.rows) {
          await recordTaskChanges(client, row.id, [{ field: "space_id", oldValue: String(oldSpace), newValue: String(value.spaceId) }], req.user.actor);
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
      if (!(await client.query(`SELECT 1 FROM projects p WHERE p.id = $1 AND ${own("p", "$2::integer")}`, [id, userId(req.user)])).rowCount) return 0;
      const released = await client.query(
        "UPDATE tasks SET project_id = NULL, updated_at = now() WHERE project_id = $1 RETURNING id", [id]);
      for (const row of released.rows) {
        await recordTaskChanges(client, row.id, [{ field: "project_id", oldValue: String(id), newValue: null }], req.user.actor);
      }
      return (await client.query("DELETE FROM projects WHERE id = $1", [id])).rowCount;
    });
    if (!deleted) return res.status(404).json({ message: "Project not found" });
    res.json({ message: "Project deleted" });
  });

  return router;
};
