// Meeting briefs: notes from a meeting -> the AI's brief (ai/proposals.js proposeBrief). Notes come pasted in the meeting, or
// by e-mail: Gemini in Google Meet ("Take notes for me") mails "Notes: “<meeting>” …" to the organizer, hello@, which
// lands in Poczta; after each mail sync such e-mails become briefs of the matching meeting and are marked handled.
const { proposeBrief, AiError } = require("./ai/proposals");
const { zonedDay } = require("./booking");

const TITLE = /[“"„«]([^”"»]{1,300})[”"»]/;

// Gemini's notes e-mail (from …@google.com, "Gemini" in the address or name, subject "Notes"/"Notatki").
function isGeminiNotes(mail) {
  return /@google\.com$/i.test(mail.fromAddress) && /gemini/i.test(`${mail.fromAddress} ${mail.fromName}`) && /^\s*(notes|notatki)\b/i.test(mail.subject);
}

// The meeting the notes belong to: the quoted title in the subject around the e-mail's time, otherwise the Meet
// meeting that ended last, within four hours before the e-mail.
async function matchEvent(db, subject, sentAt) {
  const title = (TITLE.exec(subject) || [])[1];
  if (title) {
    const { rows } = await db.query(
      `SELECT id, client_id FROM calendar_events WHERE lower(title) = lower($1) AND start_at BETWEEN $2::timestamptz - interval '2 days' AND $2::timestamptz + interval '1 hour'
       ORDER BY abs(extract(epoch FROM end_at - $2::timestamptz)) LIMIT 1`, [title.trim(), sentAt]);
    if (rows[0]) return rows[0];
  }
  const { rows } = await db.query(
    `SELECT id, client_id FROM calendar_events WHERE meet_url IS NOT NULL AND end_at BETWEEN $1::timestamptz - interval '4 hours' AND $1::timestamptz + interval '30 minutes'
     ORDER BY end_at DESC LIMIT 1`, [sentAt]);
  return rows[0] || null;
}

async function createBrief(db, { eventId = null, clientId = null, mailId = null, source = "paste", notes }) {
  if (eventId && !clientId) clientId = (await db.query("SELECT client_id FROM calendar_events WHERE id = $1", [eventId])).rows[0]?.client_id ?? null;
  const { rows } = await db.query(
    "INSERT INTO meeting_briefs (event_id, client_id, mail_id, source, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [eventId, clientId, mailId, source, String(notes).slice(0, 100000)]);
  return rows[0].id;
}

// Asks Claude for the brief and stores it (or the reason it failed). Returns the stored row id.
async function runBrief(pool, ai, id, { fetchImpl } = {}) {
  const brief = (await pool.query(
    `SELECT b.notes, e.title, e.start_at, c.name AS client FROM meeting_briefs b LEFT JOIN calendar_events e ON e.id = b.event_id
     LEFT JOIN clients c ON c.id = b.client_id WHERE b.id = $1`, [id])).rows[0];
  if (!brief || !ai) return id;
  try {
    const result = await proposeBrief(ai, { notes: brief.notes, meeting: brief.title ? { title: brief.title, startAt: brief.start_at.toISOString() } : null,
      clientName: brief.client, today: zonedDay(Date.now(), "Europe/Warsaw"), fetchImpl });
    await pool.query("UPDATE meeting_briefs SET result = $1, error = NULL, updated_at = now() WHERE id = $2", [JSON.stringify(result), id]);
  } catch (error) {
    if (!(error instanceof AiError)) console.error("brief failed");
    await pool.query("UPDATE meeting_briefs SET error = $1, updated_at = now() WHERE id = $2",
      [(error instanceof AiError ? error.message : "Nie udało się przygotować briefu.").slice(0, 300), id]);
  }
  return id;
}

// After a mail sync: new Gemini notes e-mails (last 14 days) become briefs; the AI runs on them when it may.
// `ai`: the AI settings, or a function returning them (or null when AI is off), asked again before each brief, so
// turning AI off stops a batch that is already running.
async function processGeminiMail(pool, ai, { fetchImpl } = {}) {
  const { rows } = await pool.query(
    `SELECT m.id, m.from_address AS "fromAddress", m.from_name AS "fromName", m.subject, m.sent_at AS "sentAt", m.body_text AS "bodyText"
     FROM mail_messages m WHERE m.created_at > now() - interval '14 days' AND m.from_address ILIKE '%@google.com'
       AND NOT EXISTS (SELECT 1 FROM meeting_briefs b WHERE b.mail_id = m.id) ORDER BY m.sent_at`);
  const created = [];
  for (const mail of rows.filter(isGeminiNotes)) {
    const event = await matchEvent(pool, mail.subject, mail.sentAt.toISOString());
    const id = await createBrief(pool, { eventId: event?.id ?? null, clientId: event?.client_id ?? null, mailId: mail.id, source: "gemini-mail",
      notes: `${mail.subject}\n\n${mail.bodyText}` });
    await pool.query("UPDATE mail_messages SET handled_at = COALESCE(handled_at, now()), client_id = COALESCE(client_id, $2) WHERE id = $1",
      [mail.id, event?.client_id ?? null]);
    created.push(id);
  }
  for (const id of created) await runBrief(pool, typeof ai === "function" ? await ai() : ai, id, { fetchImpl });
  return created;
}

module.exports = { isGeminiNotes, matchEvent, createBrief, runBrief, processGeminiMail };
