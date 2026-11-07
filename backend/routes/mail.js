// Poczta (owner only): the mailbox copy kept by mail-sync.js. Reading a message marks it read on the server too;
// "handled" hides it in Tasks only. From a message: a task (POST /api/tasks with mailId), a lead from the sender,
// Claude's proposed tasks, and an invitation added to the Praca calendar.
const express = require("express");
const { withTransaction } = require("../db");
const { parseId } = require("../validation");
const { validateClient, companyDomain } = require("../clients");
const { parseInvite } = require("../ics");
const { proposeFromMail, AiError } = require("../claude");
const { decrypt } = require("../secrets");
const { toRow: eventRow, upsertEvent } = require("../calendar-sync");
const { zonedDay } = require("../booking");

const LIST_COLUMNS = `m.id, m.from_address AS "fromAddress", m.from_name AS "fromName", m.subject, m.sent_at AS "sentAt", m.snippet, m.seen,
  m.handled_at AS "handledAt", m.client_id AS "clientId", (m.invite <> '') AS "hasInvite", (m.attachments <> '') AS "hasAttachments",
  (SELECT count(*)::int FROM tasks t WHERE t.mail_id = m.id) AS "taskCount"`;
const VIEWS = {
  inbox: "m.handled_at IS NULL",
  clients: "m.handled_at IS NULL AND m.client_id IS NOT NULL",
  unread: "m.handled_at IS NULL AND NOT m.seen",
  handled: "m.handled_at IS NOT NULL"
};
const json = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

module.exports = function createMailRouter(pool, { mail, source, sync, ai, google, key, fetchImpl }) {
  const router = express.Router();
  const read = async id => (await pool.query(`SELECT ${LIST_COLUMNS}, m.uid, m.to_addresses AS "toAddresses", m.body_text AS "bodyText",
    m.attachments, m.invite, m.suggestion FROM mail_messages m WHERE m.id = $1`, [id])).rows[0] || null;

  router.get("/", async (req, res) => {
    if (!mail) return res.json({ configured: false, messages: [] });
    const view = VIEWS[req.query.view] ? req.query.view : "inbox";
    const params = [];
    const conditions = [VIEWS[view]];
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(`(m.subject ILIKE $1 OR m.from_address ILIKE $1 OR m.from_name ILIKE $1 OR m.snippet ILIKE $1)`);
    }
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM mail_messages m WHERE ${conditions.join(" AND ")} ORDER BY m.sent_at DESC, m.id DESC LIMIT 300`, params);
    const counts = (await pool.query(`SELECT count(*) FILTER (WHERE handled_at IS NULL)::int AS open, count(*) FILTER (WHERE handled_at IS NULL AND NOT seen)::int AS unread,
      count(*) FILTER (WHERE handled_at IS NULL AND client_id IS NOT NULL)::int AS clients FROM mail_messages`)).rows[0];
    res.json({ configured: true, address: mail.address, ai: Boolean(ai), status: { lastSyncAt: sync.status.lastSyncAt, error: sync.status.error },
      counts, messages: rows });
  });

  router.post("/sync", async (req, res) => {
    if (!mail) return res.status(400).json({ message: "Mail is not configured" });
    const result = await sync.now();
    res.json({ ...result, lastSyncAt: sync.status.lastSyncAt });
  });

  // One message, with its text, attachments' names, the parsed invitation, Claude's proposals and tasks made from it.
  router.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const message = id && await read(id);
    if (!message) return res.status(404).json({ message: "E-mail not found" });
    const { uid, invite, suggestion, attachments, toAddresses, ...rest } = message;
    const tasks = (await pool.query("SELECT id, title, status FROM tasks WHERE mail_id = $1 ORDER BY id", [id])).rows;
    res.json({ ...rest, to: json(toAddresses, []), attachments: json(attachments, []), invite: parseInvite(invite), suggestion: json(suggestion, null), tasks });
  });

  // Opening a message: read in Tasks and on the server (best effort; the next sync corrects it anyway).
  router.post("/:id/seen", async (req, res) => {
    const id = parseId(req.params.id);
    const message = id && await read(id);
    if (!message) return res.status(404).json({ message: "E-mail not found" });
    if (!message.seen) {
      await pool.query("UPDATE mail_messages SET seen = true WHERE id = $1", [id]);
      source.markSeen(message.uid).catch(() => {});
    }
    res.json({ seen: true });
  });

  // { handled: boolean } and/or { clientId: id | null }
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body || {};
    if (id === null || !Object.keys(body).length || Object.keys(body).some(k => !["handled", "clientId"].includes(k))) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const sets = [];
    const params = [];
    if ("handled" in body) {
      if (typeof body.handled !== "boolean") return res.status(400).json({ message: "Invalid handled" });
      sets.push(body.handled ? "handled_at = COALESCE(handled_at, now())" : "handled_at = NULL");
    }
    if ("clientId" in body) {
      const clientId = body.clientId === null ? null : parseId(body.clientId);
      if (body.clientId !== null && clientId === null) return res.status(400).json({ message: "Invalid client" });
      params.push(clientId); sets.push(`client_id = $${params.length}`);
    }
    params.push(id);
    try {
      const result = await pool.query(`UPDATE mail_messages SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      if (!result.rowCount) return res.status(404).json({ message: "E-mail not found" });
    } catch (error) {
      if (error.code === "23503") return res.status(400).json({ message: "Client does not exist" });
      throw error;
    }
    res.json((await pool.query(`SELECT ${LIST_COLUMNS} FROM mail_messages m WHERE m.id = $1`, [id])).rows[0]);
  });

  // A lead from the sender (or the existing client with that address), linked to this and the sender's other e-mails.
  router.post("/:id/lead", async (req, res) => {
    const id = parseId(req.params.id);
    const message = id && await read(id);
    if (!message) return res.status(404).json({ message: "E-mail not found" });
    if (!message.fromAddress) return res.status(400).json({ message: "The e-mail has no sender address" });
    const clientId = await withTransaction(pool, async db => {
      const existing = (await db.query("SELECT id FROM clients WHERE email = $1 AND status <> 'archived' ORDER BY id LIMIT 1", [message.fromAddress])).rows[0];
      let target = existing?.id;
      if (!target) {
        const domain = companyDomain(message.fromAddress);
        const name = (message.fromName || (domain ? domain.split(".")[0] : message.fromAddress.split("@")[0])).slice(0, 120);
        const { value, error } = validateClient({ name: name.length >= 2 ? name : message.fromAddress.slice(0, 120), status: "lead",
          email: message.fromAddress, source: "mail" });
        if (error) return null;
        const keys = Object.keys(value);
        target = (await db.query(`INSERT INTO clients (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
          keys.map(k => value[k]))).rows[0].id;
      }
      await db.query("UPDATE mail_messages SET client_id = $1 WHERE from_address = $2 AND client_id IS NULL", [target, message.fromAddress]);
      await db.query("UPDATE mail_messages SET client_id = $1 WHERE id = $2", [target, id]);
      return target;
    });
    if (!clientId) return res.status(400).json({ message: "Could not create the lead" });
    res.status(201).json({ clientId });
  });

  // Claude's proposals (summary, whether a reply is expected, tasks), stored with the message.
  router.post("/:id/suggest", async (req, res) => {
    if (!ai) return res.status(400).json({ message: "Claude is not configured" });
    const id = parseId(req.params.id);
    const message = id && await read(id);
    if (!message) return res.status(404).json({ message: "E-mail not found" });
    const clientName = message.clientId ? (await pool.query("SELECT name FROM clients WHERE id = $1", [message.clientId])).rows[0]?.name : null;
    try {
      const suggestion = await proposeFromMail(ai, message, { today: zonedDay(Date.now(), "Europe/Warsaw"), clientName, fetchImpl });
      await pool.query("UPDATE mail_messages SET suggestion = $1 WHERE id = $2", [JSON.stringify(suggestion), id]);
      res.json(suggestion);
    } catch (error) {
      if (error instanceof AiError) return res.status(502).json({ message: error.message });
      throw error;
    }
  });

  // The invitation into the Praca calendar (Google events.import: the organizer's event, nobody is notified).
  router.post("/:id/invite", async (req, res) => {
    const id = parseId(req.params.id);
    const message = id && await read(id);
    const invite = message && parseInvite(message.invite);
    if (!invite) return res.status(404).json({ message: "No invitation in this e-mail" });
    if (invite.method === "CANCEL") return res.status(400).json({ message: "This e-mail cancels a meeting" });
    const account = google && (await pool.query(
      "SELECT a.id, a.calendar_id, a.refresh_token_enc FROM calendar_accounts a JOIN spaces s ON s.id = a.space_id WHERE s.key = 'work'")).rows[0];
    if (!account) return res.status(400).json({ message: "Connect the Praca calendar first" });
    try {
      const token = await google.accessToken(decrypt(key, account.refresh_token_enc));
      const imported = await google.importEvent(token, account.calendar_id, {
        iCalUID: invite.uid || `mytko-mail-${id}@tasks.mytko.dev`, summary: invite.title, location: invite.location,
        description: [invite.link, invite.description].filter(Boolean).join("\n\n").slice(0, 8000),
        start: invite.start, end: invite.end, ...(invite.organizer ? { organizer: { email: invite.organizer } } : {}),
        attendees: invite.attendees.map(email => ({ email }))
      });
      const eventId = await upsertEvent(pool, account.id, eventRow(imported));
      if (message.clientId) await pool.query("UPDATE calendar_events SET client_id = $1 WHERE id = $2 AND client_id IS NULL", [message.clientId, eventId]);
      res.status(201).json({ eventId });
    } catch (error) {
      console.error("mail invite import failed", error.status || "");
      res.status(502).json({ message: "Google Calendar did not accept the invitation" });
    }
  });

  return router;
};
