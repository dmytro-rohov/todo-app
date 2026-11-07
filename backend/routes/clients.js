const express = require("express");
const { withTransaction } = require("../db");
const { validateClient, matchMeetings } = require("../clients");
const { recordTaskChanges } = require("../task-history");
const { parseId } = require("../validation");

const CLIENT_COLUMNS = `c.id, c.name, c.status, c.company, c.email, c.phone, c.website, c.domain, c.color, c.notes, c.source,
  c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.archived_at IS NULL AND t.status <> 'done' AND (t.client_id = c.id OR (t.client_id IS NULL AND p.client_id = c.id))) AS "openTasks",
  (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id AND p.archived_at IS NULL) AS "projects",
  (SELECT min(e.start_at) FROM calendar_events e WHERE e.client_id = c.id AND e.end_at >= now()) AS "nextMeetingAt"`;
const COLUMNS = { name: "name", status: "status", company: "company", email: "email", phone: "phone", website: "website",
  domain: "domain", color: "color", notes: "notes", source: "source" };

module.exports = function createClientsRouter(pool) {
  const router = express.Router();
  const read = async id => (await pool.query(`SELECT ${CLIENT_COLUMNS} FROM clients c WHERE c.id = $1`, [id])).rows[0] || null;

  router.get("/", async (req, res) => {
    const archived = req.query.archived === "true" ? "" : "WHERE c.status <> 'archived'";
    res.json((await pool.query(`SELECT ${CLIENT_COLUMNS} FROM clients c ${archived} ORDER BY c.status = 'lead' DESC, lower(c.name), c.id`)).rows);
  });

  router.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const client = id && await read(id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateClient(req.body);
    if (error) return res.status(400).json({ message: error });
    const keys = Object.keys(value);
    const { rows } = await pool.query(
      `INSERT INTO clients (${keys.map(k => COLUMNS[k]).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      keys.map(k => value[k]));
    await matchMeetings(pool);
    res.status(201).json(await read(rows[0].id));
  });

  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const { error, value } = validateClient(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const keys = Object.keys(value);
    const result = await pool.query(
      `UPDATE clients SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 1}`).join(", ")}, updated_at = now() WHERE id = $${keys.length + 1}`,
      [...keys.map(k => value[k]), id]);
    if (!result.rowCount) return res.status(404).json({ message: "Client not found" });
    await matchMeetings(pool);
    res.json(await read(id));
  });

  // Projects, tasks and meetings stay, without the client; tasks record it.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const deleted = await withTransaction(pool, async client => {
      const released = await client.query("UPDATE tasks SET client_id = NULL, updated_at = now() WHERE client_id = $1 RETURNING id", [id]);
      for (const row of released.rows) await recordTaskChanges(client, row.id, [{ field: "client_id", oldValue: String(id), newValue: null }]);
      return (await client.query("DELETE FROM clients WHERE id = $1", [id])).rowCount;
    });
    if (!deleted) return res.status(404).json({ message: "Client not found" });
    res.json({ message: "Client deleted" });
  });

  return router;
};
