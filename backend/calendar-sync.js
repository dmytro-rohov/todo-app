// Keeps calendar_events in step with each connected Google Calendar: every 5 minutes, a window from 60 days back
// to a year ahead is read and upserted; events gone from Google within the window are removed.
const { withTransaction } = require("./db");
const { decrypt } = require("./secrets");
const { matchMeetings } = require("./clients");

const WINDOW_BACK_DAYS = 60;
const WINDOW_AHEAD_DAYS = 365;
const EVERY_MS = 5 * 60000;
const SYNC_LOCK_ID = 7243917464;

function attendeesOf(event) {
  return JSON.stringify((event.attendees || []).slice(0, 50).map(a => ({
    email: String(a.email || "").slice(0, 200), name: String(a.displayName || "").slice(0, 200),
    response: a.responseStatus || "needsAction", organizer: Boolean(a.organizer), self: Boolean(a.self)
  })));
}

// Google event -> row values. All-day events are stored at UTC midnight of their date (end exclusive).
function toRow(event) {
  const allDay = Boolean(event.start?.date);
  const start = allDay ? `${event.start.date}T00:00:00Z` : event.start?.dateTime;
  const end = allDay ? `${event.end?.date || event.start.date}T00:00:00Z` : (event.end?.dateTime || start);
  const video = (event.conferenceData?.entryPoints || []).find(e => e.entryPointType === "video")?.uri;
  return {
    externalId: String(event.id).slice(0, 300),
    title: String(event.summary || "(bez tytułu)").slice(0, 500),
    description: String(event.description || "").slice(0, 20000),
    location: String(event.location || "").slice(0, 500),
    start, end, allDay,
    meetUrl: (event.hangoutLink || video || null)?.slice(0, 300) ?? null,
    htmlLink: event.htmlLink ? String(event.htmlLink).slice(0, 600) : null,
    attendees: attendeesOf(event),
    status: String(event.status || "confirmed").slice(0, 20)
  };
}

async function upsertEvent(db, accountId, row) {
  const result = await db.query(
    `INSERT INTO calendar_events (account_id, external_id, title, description, location, start_at, end_at, all_day, meet_url, html_link, attendees, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
       location = EXCLUDED.location, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day,
       meet_url = EXCLUDED.meet_url, html_link = EXCLUDED.html_link, attendees = EXCLUDED.attendees, status = EXCLUDED.status, updated_at = now()
     RETURNING id`,
    [accountId, row.externalId, row.title, row.description, row.location, row.start, row.end, row.allDay, row.meetUrl, row.htmlLink, row.attendees, row.status]);
  return result.rows[0].id;
}

async function syncAccount(pool, account, { google, key }) {
  const now = Date.now();
  const timeMin = new Date(now - WINDOW_BACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(now + WINDOW_AHEAD_DAYS * 86400000).toISOString();
  try {
    const token = await google.accessToken(decrypt(key, account.refresh_token_enc));
    const events = (await google.listEvents(token, account.calendar_id, timeMin, timeMax)).filter(e => e.status !== "cancelled" && e.start);
    await withTransaction(pool, async client => {
      const kept = [];
      for (const event of events) {
        const row = toRow(event);
        kept.push(row.externalId);
        await upsertEvent(client, account.id, row);
      }
      await client.query(
        `DELETE FROM calendar_events WHERE account_id = $1 AND end_at >= $2 AND start_at <= $3 AND NOT (external_id = ANY($4::text[]))`,
        [account.id, timeMin, timeMax, kept]);
      await client.query("UPDATE calendar_accounts SET last_sync_at = now(), last_error = NULL WHERE id = $1", [account.id]);
      await matchMeetings(client);
    });
    return { ok: true, events: events.length };
  } catch (error) {
    const message = error.status === 400 || error.status === 401 ? "Brak dostępu do kalendarza — połącz go ponownie." : "Synchronizacja nie powiodła się, spróbuję ponownie.";
    await pool.query("UPDATE calendar_accounts SET last_error = $1 WHERE id = $2", [message, account.id]).catch(() => {});
    console.error("calendar sync failed", account.id, error.status || "");
    return { ok: false, error: message };
  }
}

async function syncAll(pool, ctx) {
  const lock = await pool.query("SELECT pg_try_advisory_lock($1) AS ok", [SYNC_LOCK_ID]);
  if (!lock.rows[0].ok) return [];
  try {
    const { rows } = await pool.query("SELECT * FROM calendar_accounts ORDER BY id");
    const results = [];
    for (const account of rows) results.push(await syncAccount(pool, account, ctx));
    return results;
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_ID]).catch(() => {});
  }
}

function scheduleCalendarSync(pool, ctx, { firstRunMs = 20000 } = {}) {
  if (!ctx) return { stop() {} };
  const run = () => syncAll(pool, ctx).catch(() => console.error("calendar sync run failed"));
  const first = setTimeout(run, firstRunMs);
  const every = setInterval(run, EVERY_MS);
  first.unref(); every.unref();
  return { stop() { clearTimeout(first); clearInterval(every); } };
}

module.exports = { toRow, upsertEvent, syncAccount, syncAll, scheduleCalendarSync };
