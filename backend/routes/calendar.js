// Google Calendars per space: connect (OAuth), list, sync, and the events shown and edited in Tasks.
const crypto = require("node:crypto");
const express = require("express");
const { encrypt, decrypt } = require("../secrets");
const { syncAccount, toRow, upsertEvent } = require("../calendar-sync");
const { parseId, isValidDate } = require("../validation");

const EVENT_COLUMNS = `e.id, a.space_id AS "spaceId", e.title, e.description, e.location, e.start_at AS "startAt", e.end_at AS "endAt",
  e.all_day AS "allDay", e.meet_url AS "meetUrl", e.html_link AS "htmlLink", e.attendees, e.status, e.client_id AS "clientId",
  (SELECT count(*)::int FROM tasks t WHERE t.meeting_id = e.id AND t.archived_at IS NULL) AS "taskCount"`;
const EMAIL = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[A-Za-z]{2,}$/;
const MAX_RANGE_DAYS = 120;

function publicEvent(row) {
  let attendees = [];
  try { attendees = row.attendees ? JSON.parse(row.attendees) : []; } catch { /* keep empty */ }
  return { ...row, attendees };
}

// Validates a create/patch body into Google's event shape. Returns { error } or { value, meet }.
function validateEvent(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const value = {};
  if (!partial || "title" in body) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 500) return { error: "Invalid title" };
    value.summary = body.title.trim();
  }
  for (const [key, max] of [["description", 8000], ["location", 500]]) {
    if (key in body) {
      if (typeof body[key] !== "string" || body[key].length > max) return { error: `Invalid ${key}` };
      value[key] = body[key];
    }
  }
  if (!partial || "start" in body || "end" in body || "allDay" in body) {
    const allDay = body.allDay === true;
    if (allDay) {
      if (!isValidDate(body.start) || !isValidDate(body.end) || body.end <= body.start) return { error: "Invalid dates" };
      value.start = { date: body.start };
      value.end = { date: body.end };
    } else {
      const start = new Date(body.start);
      const end = new Date(body.end);
      if (typeof body.start !== "string" || typeof body.end !== "string" || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return { error: "Invalid dates" };
      }
      value.start = { dateTime: start.toISOString() };
      value.end = { dateTime: end.toISOString() };
    }
  }
  if ("attendees" in body) {
    if (!Array.isArray(body.attendees) || body.attendees.length > 50 || !body.attendees.every(e => typeof e === "string" && EMAIL.test(e.trim()))) {
      return { error: "Invalid attendees" };
    }
    value.attendees = [...new Set(body.attendees.map(e => e.trim().toLowerCase()))].map(email => ({ email }));
  }
  if ("meet" in body && typeof body.meet !== "boolean") return { error: "Invalid meet" };
  return { value, meet: body.meet === true };
}

function createCalendarRouter(pool, { google, key, cookie }) {
  const router = express.Router();
  const pendingCookie = cookie.secure ? "__Host-mytko-tasks-google" : "mytko-tasks-google";
  const ctx = { google, key };

  async function accountForSpace(spaceId) {
    return (await pool.query("SELECT * FROM calendar_accounts WHERE space_id = $1", [spaceId])).rows[0] || null;
  }

  async function accountForEvent(id) {
    return (await pool.query(
      "SELECT a.*, e.external_id FROM calendar_events e JOIN calendar_accounts a ON a.id = e.account_id WHERE e.id = $1", [id])).rows[0] || null;
  }

  async function readEvent(id) {
    const row = (await pool.query(`SELECT ${EVENT_COLUMNS} FROM calendar_events e JOIN calendar_accounts a ON a.id = e.account_id WHERE e.id = $1`, [id])).rows[0];
    return row ? publicEvent(row) : null;
  }

  function googleFailure(res, error) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      return res.status(502).json({ message: "Google rejected the request: reconnect the calendar or check the event" });
    }
    console.error("calendar write failed", error.status || "");
    return res.status(502).json({ message: "Google Calendar is not answering, try again" });
  }

  router.get("/accounts", async (req, res) => {
    if (!google) return res.json({ configured: false, accounts: [] });
    const { rows } = await pool.query(
      `SELECT id, space_id AS "spaceId", account_email AS "accountEmail", calendar_id AS "calendarId",
         last_sync_at AS "lastSyncAt", last_error AS "lastError" FROM calendar_accounts ORDER BY id`);
    res.json({ configured: true, accounts: rows });
  });

  // Starts the OAuth consent for one space; the browser is sent to the returned URL.
  router.post("/connect", async (req, res) => {
    if (!google) return res.status(404).json({ message: "Google Calendar is not configured" });
    const spaceId = parseId(req.body?.spaceId);
    // the owner's spaces only (a member's space is never connected to the owner's Google account)
    if (spaceId === null || !(await pool.query("SELECT 1 FROM spaces WHERE id = $1 AND user_id IS NULL", [spaceId])).rowCount) {
      return res.status(400).json({ message: "Space does not exist" });
    }
    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    res.cookie(pendingCookie, `${state}.${verifier}.${spaceId}`, { httpOnly: true, secure: cookie.secure, sameSite: "lax", path: "/", maxAge: 10 * 60000 });
    res.json({ url: google.authUrl(state, challenge) });
  });

  router.post("/accounts/:id/sync", async (req, res) => {
    const id = parseId(req.params.id);
    const account = id && (await pool.query("SELECT * FROM calendar_accounts WHERE id = $1", [id])).rows[0];
    if (!account || !google) return res.status(404).json({ message: "Calendar not found" });
    res.json(await syncAccount(pool, account, ctx));
  });

  router.delete("/accounts/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const result = await pool.query("DELETE FROM calendar_accounts WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ message: "Calendar not found" });
    res.json({ message: "Calendar disconnected" });
  });

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 120 days), optionally &spaceId= and &clientId=
  router.get("/events", async (req, res) => {
    const { from, to } = req.query;
    if (!isValidDate(from) || !isValidDate(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS) {
      return res.status(400).json({ message: "Invalid range" });
    }
    const params = [`${from}T00:00:00Z`, `${to}T23:59:59Z`];
    let space = "";
    for (const [key, column] of [["spaceId", "a.space_id"], ["clientId", "e.client_id"]]) {
      if (req.query[key] === undefined) continue;
      const value = parseId(req.query[key]);
      if (value === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(value);
      space += ` AND ${column} = $${params.length}`;
    }
    // A day of margin each side: the client places events by its local time zone.
    const { rows } = await pool.query(
      `SELECT ${EVENT_COLUMNS} FROM calendar_events e JOIN calendar_accounts a ON a.id = e.account_id
       WHERE e.end_at >= $1::timestamptz - interval '1 day' AND e.start_at <= $2::timestamptz + interval '1 day'${space}
       ORDER BY e.start_at, e.id LIMIT 2000`, params);
    res.json(rows.map(publicEvent));
  });

  router.post("/events", async (req, res) => {
    const spaceId = parseId(req.body?.spaceId);
    const { error, value, meet } = validateEvent(req.body);
    if (error) return res.status(400).json({ message: error });
    const account = spaceId !== null && await accountForSpace(spaceId);
    if (!account || !google) return res.status(400).json({ message: "This space has no connected calendar" });
    try {
      const token = await google.accessToken(decrypt(key, account.refresh_token_enc));
      const created = await google.insertEvent(token, account.calendar_id, value, { meet });
      const id = await upsertEvent(pool, account.id, toRow(created));
      res.status(201).json(await readEvent(id));
    } catch (failure) {
      return googleFailure(res, failure);
    }
  });

  router.patch("/events/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const { error, value, meet } = validateEvent(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const account = await accountForEvent(id);
    if (!account || !google) return res.status(404).json({ message: "Event not found" });
    try {
      const token = await google.accessToken(decrypt(key, account.refresh_token_enc));
      const updated = await google.patchEvent(token, account.calendar_id, account.external_id, value, { meet });
      await upsertEvent(pool, account.id, toRow(updated));
      res.json(await readEvent(id));
    } catch (failure) {
      return googleFailure(res, failure);
    }
  });

  // Links a meeting to a client in Tasks only (nothing changes in Google).
  router.put("/events/:id/client", async (req, res) => {
    const id = parseId(req.params.id);
    const clientId = req.body?.clientId === null ? null : parseId(req.body?.clientId);
    if (id === null || (req.body?.clientId !== null && clientId === null)) return res.status(400).json({ message: "Invalid request" });
    try {
      const result = await pool.query("UPDATE calendar_events SET client_id = $1 WHERE id = $2", [clientId, id]);
      if (!result.rowCount) return res.status(404).json({ message: "Event not found" });
      res.json(await readEvent(id));
    } catch (error) {
      if (error.code === "23503") return res.status(400).json({ message: "Client does not exist" });
      throw error;
    }
  });

  router.delete("/events/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid id" });
    const account = await accountForEvent(id);
    if (!account || !google) return res.status(404).json({ message: "Event not found" });
    try {
      const token = await google.accessToken(decrypt(key, account.refresh_token_enc));
      await google.deleteEvent(token, account.calendar_id, account.external_id);
      await pool.query("DELETE FROM calendar_events WHERE id = $1", [id]);
      res.json({ message: "Event deleted" });
    } catch (failure) {
      return googleFailure(res, failure);
    }
  });

  router.pendingCookie = pendingCookie;
  return router;
}

// GET /auth/google/callback: Google sends the browser back here. Needs this browser's owner session and the pending
// cookie set by /api/calendar/connect; stores the encrypted refresh token for the space and syncs once.
function createGoogleCallback(pool, { google, key, cookie, pendingCookie, isOwner }) {
  const router = express.Router();
  const { readCookie } = require("../kit");
  const done = (res, outcome) => res.redirect(303, `/?calendar=${outcome}#manage-spaces`);
  router.get("/callback", async (req, res) => {
    const pending = readCookie(req, pendingCookie) || "";
    res.clearCookie(pendingCookie, { httpOnly: true, secure: cookie.secure, sameSite: "lax", path: "/" });
    const [state, verifier, spaceRaw] = pending.split(".");
    if (!(await isOwner(req))) return done(res, "login");
    const expected = Buffer.from(String(state || ""));
    const given = Buffer.from(String(req.query.state || ""));
    if (!state || !verifier || expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return done(res, "failed");
    if (req.query.error) return done(res, req.query.error === "access_denied" ? "denied" : "failed");
    const spaceId = parseId(spaceRaw);
    if (spaceId === null || typeof req.query.code !== "string" || req.query.code.length > 1024) return done(res, "failed");
    try {
      const { refreshToken, email } = await google.exchangeCode(req.query.code, verifier);
      const { rows } = await pool.query(
        `INSERT INTO calendar_accounts (space_id, account_email, refresh_token_enc) VALUES ($1, $2, $3)
         ON CONFLICT (space_id) DO UPDATE SET account_email = EXCLUDED.account_email, refresh_token_enc = EXCLUDED.refresh_token_enc,
           last_error = NULL RETURNING *`, [spaceId, String(email || "konto Google").slice(0, 200), encrypt(key, refreshToken)]);
      syncAccount(pool, rows[0], { google, key }).catch(() => {});
      return done(res, "connected");
    } catch (error) {
      console.error("google connect failed", error.status || "");
      return done(res, "failed");
    }
  });
  return router;
}

module.exports = { createCalendarRouter, createGoogleCallback, validateEvent };
