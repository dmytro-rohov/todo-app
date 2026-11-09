// Meeting briefs (owner only): list per meeting / client / unassigned, one with its notes, Claude's result and the
// meeting's tasks; new from pasted notes (Claude runs at once when configured), run again, assign a meeting, delete.
const express = require("express");
const { parseId, validateText } = require("../validation");
const { createBrief, runBrief } = require("../briefs");

const COLUMNS = `b.id, b.event_id AS "eventId", b.client_id AS "clientId", b.mail_id AS "mailId", b.source, b.error,
  b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.result`;
const parse = row => {
  let result = null;
  try { result = row.result ? JSON.parse(row.result) : null; } catch { /* stored by us; never expected */ }
  return { ...row, result };
};

module.exports = function createBriefsRouter(pool, { ai: aiFor, fetchImpl }) {
  const router = express.Router();
  // Claude when it may be used now (configured and not turned off in Porządek → AI i Workflow), else null
  router.use(async (req, res, next) => { try { req.ai = await aiFor(); next(); } catch (error) { next(error); } });

  async function full(id, ai) {
    const row = (await pool.query(`SELECT ${COLUMNS}, b.notes FROM meeting_briefs b WHERE b.id = $1`, [id])).rows[0];
    if (!row) return null;
    const event = row.eventId ? (await pool.query(
      `SELECT id, title, start_at AS "startAt", end_at AS "endAt", attendees, client_id AS "clientId" FROM calendar_events WHERE id = $1`, [row.eventId])).rows[0] : null;
    if (event) { try { event.attendees = event.attendees ? JSON.parse(event.attendees) : []; } catch { event.attendees = []; } }
    const tasks = row.eventId ? (await pool.query("SELECT id, title, status FROM tasks WHERE meeting_id = $1 AND archived_at IS NULL ORDER BY id", [row.eventId])).rows : [];
    return { ...parse(row), ai: Boolean(ai), event, tasks };
  }

  // ?eventId= | ?clientId= | ?unassigned=true (newest first, without notes)
  router.get("/", async (req, res) => {
    const conditions = [];
    const params = [];
    for (const key of ["eventId", "clientId"]) {
      if (req.query[key] === undefined) continue;
      const id = parseId(req.query[key]);
      if (id === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(id); conditions.push(`b.${key === "eventId" ? "event_id" : "client_id"} = $${params.length}`);
    }
    if (req.query.unassigned === "true") conditions.push("b.event_id IS NULL");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM meeting_briefs b ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT 100`, params);
    res.json({ ai: Boolean(req.ai), briefs: rows.map(parse) });
  });

  router.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const brief = id && await full(id, req.ai);
    if (!brief) return res.status(404).json({ message: "Brief not found" });
    res.json(brief);
  });

  // { eventId?, notes }: pasted notes (Zoom, a phone call, own notes…)
  router.post("/", async (req, res) => {
    const body = req.body || {};
    const eventId = body.eventId === undefined || body.eventId === null ? null : parseId(body.eventId);
    if ((body.eventId != null && eventId === null) || !validateText(body.notes, { min: 20, max: 100000 })) {
      return res.status(400).json({ message: "Notes (at least 20 characters) are required" });
    }
    if (eventId && !(await pool.query("SELECT 1 FROM calendar_events WHERE id = $1", [eventId])).rowCount) {
      return res.status(400).json({ message: "Meeting does not exist" });
    }
    const id = await createBrief(pool, { eventId, notes: body.notes, source: "paste" });
    await runBrief(pool, req.ai, id, { fetchImpl });
    res.status(201).json(await full(id, req.ai));
  });

  router.post("/:id/run", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !(await pool.query("SELECT 1 FROM meeting_briefs WHERE id = $1", [id])).rowCount) return res.status(404).json({ message: "Brief not found" });
    if (!req.ai) return res.status(400).json({ message: "AI is not configured or turned off" });
    await runBrief(pool, req.ai, id, { fetchImpl });
    res.json(await full(id, req.ai));
  });

  // { eventId }: assign the meeting (its client comes along)
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const eventId = parseId(req.body?.eventId);
    if (id === null || eventId === null || Object.keys(req.body).length !== 1) return res.status(400).json({ message: "Invalid request" });
    const event = (await pool.query("SELECT client_id FROM calendar_events WHERE id = $1", [eventId])).rows[0];
    if (!event) return res.status(400).json({ message: "Meeting does not exist" });
    const result = await pool.query("UPDATE meeting_briefs SET event_id = $1, client_id = COALESCE($2, client_id), updated_at = now() WHERE id = $3",
      [eventId, event.client_id, id]);
    if (!result.rowCount) return res.status(404).json({ message: "Brief not found" });
    res.json(await full(id, req.ai));
  });

  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const result = await pool.query("DELETE FROM meeting_briefs WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ message: "Brief not found" });
    res.json({ message: "Brief deleted" });
  });

  return router;
};
