// Public booking API for the own form on mytko.dev (no session; CORS only for BOOKING_ORIGINS):
//   GET  /api/public/booking?from=YYYY-MM-DD&days=7  free slots of the booking space's Google Calendar
//   POST /api/public/booking                         books a slot: a Google event with Meet and the guest (Google sends
//                                                    the invitation), a lead in Klienci and a preparation task in ToDo.
const express = require("express");
const { withTransaction } = require("../db");
const { decrypt } = require("../secrets");
const { toRow, upsertEvent } = require("../calendar-sync");
const { validateClient } = require("../clients");
const { freeSlots, validateBooking, zonedDay, DAY_MS } = require("../booking");
const { recordTaskChanges, taskChanges } = require("../task-history");
const { rateLimit, createWindowCounter } = require("../security");
const { isValidDate } = require("../validation");
const { loadTask } = require("./tasks");

const CACHE_MS = 60000;

module.exports = function createBookingRouter(pool, { google, key, settings }) {
  const router = express.Router();
  const perIp = rateLimit({ windowMs: 3600000, max: settings.perHour });
  const perDay = createWindowCounter({ windowMs: DAY_MS });
  const cache = new Map();
  router.stoppables = [perIp, perDay];

  // CORS for the listed sites only; requests without an Origin (curl, server side) are not browsers and pass.
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", Vary: "Origin", "Cross-Origin-Resource-Policy": "cross-origin" });
    const origin = req.get("origin");
    if (origin) {
      if (!settings.origins.includes(origin)) return res.status(403).json({ message: "Origin not allowed" });
      res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "600" });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  const account = async () => (await pool.query(
    `SELECT a.id, a.space_id, a.calendar_id, a.refresh_token_enc FROM calendar_accounts a JOIN spaces s ON s.id = a.space_id WHERE s.key = $1`,
    [settings.spaceKey])).rows[0] || null;

  // Busy: the booking calendar (Google free/busy, which honours "free" events) and the timed events of the other
  // connected calendars, e.g. the private one (their all-day events, like birthdays, do not block).
  async function busyTimes(acc, token, timeMin, timeMax) {
    const remote = await google.freeBusy(token, [acc.calendar_id], timeMin, timeMax);
    const { rows } = await pool.query(
      `SELECT start_at, end_at FROM calendar_events WHERE account_id <> $1 AND NOT all_day AND status <> 'cancelled' AND end_at > $2 AND start_at < $3`,
      [acc.id, timeMin, timeMax]);
    return [...remote, ...rows.map(r => ({ start: r.start_at.toISOString(), end: r.end_at.toISOString() }))];
  }

  async function slotsFor(acc, from, count, { fresh = false } = {}) {
    const cacheKey = `${acc.id}:${from}:${count}`;
    const hit = cache.get(cacheKey);
    if (!fresh && hit && hit.at > Date.now() - CACHE_MS) return hit.days;
    const token = await google.accessToken(decrypt(key, acc.refresh_token_enc));
    const timeMin = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS).toISOString();
    const timeMax = new Date(Date.parse(`${from}T00:00:00Z`) + (count + 1) * DAY_MS).toISOString();
    const days = freeSlots(settings, await busyTimes(acc, token, timeMin, timeMax), { from, count });
    if (cache.size > 100) cache.clear();
    cache.set(cacheKey, { at: Date.now(), days });
    return days;
  }

  const unavailable = res => res.status(503).json({ message: "Booking is not available right now" });

  router.get("/", async (req, res) => {
    const acc = await account();
    if (!acc) return unavailable(res);
    const today = zonedDay(Date.now(), settings.timeZone);
    const from = isValidDate(req.query.from) && req.query.from > today ? req.query.from : today;
    const count = Math.min(14, Math.max(1, Number.parseInt(req.query.days, 10) || 7));
    try {
      res.json({ timeZone: settings.timeZone, slotMinutes: settings.slotMinutes, days: await slotsFor(acc, from, count) });
    } catch (error) {
      console.error("booking slots failed", error.status || error.code || "");
      unavailable(res);
    }
  });

  router.post("/", perIp, express.json({ limit: "10kb", inflate: false }), async (req, res) => {
    const { error, value, spam } = validateBooking(req.body);
    if (spam) return res.status(201).json({ status: "booked" }); // looks the same to a bot; nothing is booked
    if (error) return res.status(400).json({ message: error });
    if (perDay.peek("all").count >= settings.perDay) return res.status(429).json({ message: "Too many bookings today, please write to us" });
    const acc = await account();
    if (!acc) return unavailable(res);
    const upcoming = await pool.query(
      `SELECT count(*)::int AS n FROM calendar_events WHERE account_id = $1 AND end_at > now() AND status <> 'cancelled' AND attendees ILIKE $2`,
      [acc.id, `%"email":"${value.email.replace(/[\\%_]/g, "\\$&")}"%`]);
    if (upcoming.rows[0].n >= 2) return res.status(409).json({ message: "You already have meetings booked with us" });
    const start = Date.parse(value.start);
    const end = start + settings.slotMinutes * 60000;
    const day = zonedDay(start, settings.timeZone);
    let created;
    try {
      // The slot must still be free right now, not only when the page was loaded.
      const days = await slotsFor(acc, day, 1, { fresh: true });
      if (!days[0]?.slots.includes(value.start)) return res.status(409).json({ message: "This time is no longer available" });
      const token = await google.accessToken(decrypt(key, acc.refresh_token_enc));
      const description = [value.message, "", `${value.name} <${value.email}>`, value.phone ? `tel. ${value.phone}` : null, value.company || null,
        "", "Rezerwacja przez formularz na mytko.dev"].filter(line => line !== null).join("\n").trim();
      created = await google.insertEvent(token, acc.calendar_id, {
        summary: `Rozmowa: ${value.name}${value.company ? ` (${value.company})` : ""}`.slice(0, 500),
        description,
        start: { dateTime: new Date(start).toISOString(), timeZone: settings.timeZone },
        end: { dateTime: new Date(end).toISOString(), timeZone: settings.timeZone },
        attendees: [{ email: value.email, displayName: value.name }]
      }, { meet: true });
    } catch (failure) {
      console.error("booking failed", failure.status || failure.code || "");
      return unavailable(res);
    }
    perDay.hit("all");
    await withTransaction(pool, async db => {
      const eventId = await upsertEvent(db, acc.id, toRow(created));
      let clientId = (await db.query("SELECT id FROM clients WHERE email = $1 AND status <> 'archived' ORDER BY id LIMIT 1", [value.email])).rows[0]?.id;
      if (!clientId) {
        const lead = validateClient({ name: value.company.length >= 2 ? value.company.slice(0, 120) : value.name, status: "lead", email: value.email,
          company: value.company, phone: value.phone, notes: value.message, source: "booking" }).value;
        const keys = Object.keys(lead);
        clientId = (await db.query(`INSERT INTO clients (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
          keys.map(k => lead[k]))).rows[0].id;
      }
      await db.query("UPDATE calendar_events SET client_id = $1 WHERE id = $2", [clientId, eventId]);
      const task = await db.query(
        `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
         INSERT INTO tasks (id, title, date, description, status, priority, due_date, position, space_id, client_id, meeting_id)
         SELECT next.id, $1, $2::date, $3, 'todo', 'P1', $4::date, next.id, $5, $6, $7 FROM next RETURNING id`,
        [`Przygotować się do rozmowy: ${value.name}`.slice(0, 255), zonedDay(Date.now(), settings.timeZone), value.message, day, acc.space_id, clientId, eventId]);
      const taskId = task.rows[0].id;
      await recordTaskChanges(db, taskId, taskChanges(null, await loadTask(db, taskId)), "booking");
    });
    res.status(201).json({ status: "booked", start: new Date(start).toISOString(), end: new Date(end).toISOString(), meetUrl: toRow(created).meetUrl });
  });

  return router;
};
