const express = require("express");
const { withTransaction } = require("../db");
const { defaultSpaces, publicKey } = require("../spaces");
const { recordTaskChanges } = require("../task-history");
const { isOwner, userId, own, visibleSpace } = require("../access");
const { parseId, validateSpace } = require("../validation");

const SPACE_COLUMNS = `s.id, s.key, s.name, s.color, s.agent_visible AS "agentVisible", s.position, s.created_at AS "createdAt",
  s.shared, (s.user_id IS NOT DISTINCT FROM $1::integer) AS "mine"`;
const FOREIGN_KEY_VIOLATION = "23503";
const shown = row => ({ ...row, key: publicKey(row.key) });

// Tasks leaving a space go to their creator's private space (the owner's or the member's), without a project.
async function sendTasksHome(db, spaceId, actor, onlyOthersOf = undefined) {
  const ownerPrivate = (await defaultSpaces(db)).private;
  const params = [spaceId, ownerPrivate];
  let others = "";
  if (onlyOthersOf !== undefined) { params.push(onlyOthersOf); others = " AND t.user_id IS DISTINCT FROM $3::integer"; }
  const moved = await db.query(
    `UPDATE tasks t SET space_id = COALESCE((SELECT s.id FROM spaces s WHERE s.key = 'private:' || t.user_id), $2), project_id = NULL, updated_at = now()
     WHERE t.space_id = $1${others} RETURNING t.id, t.space_id`, params);
  for (const row of moved.rows) {
    await recordTaskChanges(db, row.id, [{ field: "space_id", oldValue: String(spaceId), newValue: String(row.space_id) }], actor);
  }
}

module.exports = function createSpacesRouter(pool) {
  const router = express.Router();
  const mine = async (db, req, id, lock = "") =>
    (await db.query(`SELECT key, shared FROM spaces s WHERE s.id = $1 AND ${own("s", "$2::integer")}${lock}`, [id, userId(req.user)])).rows[0] || null;

  router.get("/", async (req, res) => {
    await defaultSpaces(pool, req.user);
    const result = await pool.query(
      `SELECT ${SPACE_COLUMNS} FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position ASC, s.id ASC`, [userId(req.user)]);
    res.json(result.rows.map(shown));
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateSpace(req.body);
    if (error) return res.status(400).json({ message: error });
    if (value.agentVisible && !isOwner(req.user)) return res.status(400).json({ message: "Only the owner's spaces can be visible to agents" });
    const result = await pool.query(
      `INSERT INTO spaces AS s (name, color, agent_visible, position, shared, user_id) VALUES ($2, $3, $4, $5, $6, $1) RETURNING ${SPACE_COLUMNS}`,
      [userId(req.user), value.name, value.color, value.agentVisible ?? false, value.position ?? 0, value.shared ?? false]
    );
    res.status(201).json(shown(result.rows[0]));
  });

  // One's own spaces only. Built-in spaces (Praca, Prywatne) can be renamed and recoloured, never shared; private
  // spaces are never visible to agents. Unsharing sends the other accounts' tasks in the space back to their private spaces.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    const { error, value } = validateSpace(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const outcome = await withTransaction(pool, async db => {
      const current = await mine(db, req, id, " FOR UPDATE");
      if (!current) return { status: 404, message: "Space not found" };
      const isPrivate = publicKey(current.key) === "private";
      if (isPrivate && value.agentVisible === true) return { status: 400, message: "The private space is never visible to agents" };
      if (current.key !== null && value.shared === true) return { status: 400, message: "Built-in spaces cannot be shared" };
      if (value.agentVisible === true && !isOwner(req.user)) return { status: 400, message: "Only the owner's spaces can be visible to agents" };
      if (current.shared && value.shared === false) await sendTasksHome(db, id, req.user.actor, userId(req.user));
      const columns = { name: "name", color: "color", position: "position", agentVisible: "agent_visible", shared: "shared" };
      const params = [userId(req.user)];
      const assignments = Object.entries(value).map(([key, val]) => { params.push(val); return `${columns[key]} = $${params.length}`; });
      params.push(id);
      const result = await db.query(`UPDATE spaces s SET ${assignments.join(", ")} WHERE s.id = $${params.length} RETURNING ${SPACE_COLUMNS}`, params);
      return { status: 200, body: shown(result.rows[0]) };
    });
    if (outcome.status !== 200) return res.status(outcome.status).json({ message: outcome.message });
    res.json(outcome.body);
  });

  // One's own, not built-in spaces. Their tasks go back to their creators' private spaces. A space that still has
  // projects is refused.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    try {
      const outcome = await withTransaction(pool, async db => {
        const current = await mine(db, req, id, " FOR UPDATE");
        if (!current) return 404;
        if (current.key !== null) return 409;
        await sendTasksHome(db, id, req.user.actor);
        await db.query("DELETE FROM spaces WHERE id = $1", [id]);
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
