// Poczta: keeps mail_messages in step with the owner's mailbox (IMAP, e.g. OVH Zimbra) every few minutes. The newest
// MAIL_FETCH_LIMIT messages of the mailbox are copied with their text (attachments only by name, a calendar
// invitation in full); messages gone from the server are removed; read flags follow the server. Messages are matched
// to clients by the sender's address, then the company domain. Tasks change the mailbox only by marking messages read.
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { withTransaction } = require("./db");
const { PUBLIC_DOMAINS } = require("./clients");

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_BODY = 50000;
const SYNC_LOCK_ID = 7243917465;

// The IMAP connection, opened per sync (a long-lived one would need reconnect logic for a once-in-3-minutes job).
function createImapSource(config) {
  async function withMailbox(work) {
    const client = new ImapFlow({ host: config.host, port: config.port, secure: config.tls, auth: { user: config.user, pass: config.password },
      logger: false, tls: { rejectUnauthorized: true }, socketTimeout: 60000 });
    await client.connect();
    try {
      const lock = await client.getMailboxLock(config.mailbox);
      try { return await work(client); } finally { lock.release(); }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }
  return {
    // { uidValidity, uids: [all uids, ascending] }
    async state() {
      return withMailbox(async client => ({
        uidValidity: Number(client.mailbox.uidValidity),
        uids: ((await client.search({ all: true }, { uid: true })) || []).map(Number).sort((a, b) => a - b)
      }));
    },
    // Full messages for these uids: [{ uid, seen, size, source? }] (no source above MAX_SOURCE_BYTES).
    async messages(uids) {
      if (!uids.length) return [];
      return withMailbox(async client => {
        const found = [];
        for await (const item of client.fetch(uids.join(","), { uid: true, flags: true, size: true, envelope: true, internalDate: true }, { uid: true })) {
          found.push({ uid: Number(item.uid), seen: item.flags.has("\\Seen"), size: item.size, envelope: item.envelope, internalDate: item.internalDate });
        }
        for (const message of found) {
          if (message.size > MAX_SOURCE_BYTES) continue;
          const fetched = await client.fetchOne(String(message.uid), { source: true }, { uid: true });
          message.source = fetched && fetched.source;
        }
        return found;
      });
    },
    // { uid: seen } for these uids
    async flags(uids) {
      if (!uids.length) return {};
      return withMailbox(async client => {
        const seen = {};
        for await (const item of client.fetch(uids.join(","), { uid: true, flags: true }, { uid: true })) seen[Number(item.uid)] = item.flags.has("\\Seen");
        return seen;
      });
    },
    async markSeen(uid) {
      return withMailbox(client => client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }));
    }
  };
}

const clean = (value, max) => String(value || "").replace(/\u0000/g, "").slice(0, max);
const oneLine = text => text.replace(/\s+/g, " ").trim();

// A fetched message -> row values. Headers come from the parsed source when there is one (it decodes raw UTF-8
// headers that some servers' envelopes mangle), else from the IMAP envelope.
async function toRow(message) {
  const envelope = { ...(message.envelope || {}) };
  let text = "";
  let attachments = [];
  let invite = "";
  if (message.source) {
    const parsed = await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
    if (parsed.subject) envelope.subject = parsed.subject;
    if (parsed.from?.value?.length) envelope.from = parsed.from.value;
    if (parsed.date) envelope.date = parsed.date;
    if (parsed.messageId) envelope.messageId = parsed.messageId;
    for (const key of ["to", "cc"]) if (parsed[key]) envelope[key] = [parsed[key]].flat().flatMap(group => group.value || []);
    text = parsed.text || "";
    for (const attachment of parsed.attachments || []) {
      if (/^(text|application)\/(calendar|ics)/i.test(attachment.contentType) && !invite) invite = attachment.content.toString("utf8");
      else attachments.push({ name: clean(attachment.filename || "załącznik", 200), size: attachment.size || 0, type: clean(attachment.contentType, 100) });
    }
  } else {
    text = "(Wiadomość jest za duża, by pokazać ją w Tasks. Otwórz ją w programie pocztowym.)";
  }
  const from = (envelope.from || [])[0] || {};
  return {
    uid: message.uid,
    messageId: envelope.messageId ? clean(envelope.messageId, 300) : null,
    fromAddress: clean((from.address || "").toLowerCase(), 254),
    fromName: clean(from.name || "", 200),
    toAddresses: JSON.stringify([...(envelope.to || []), ...(envelope.cc || [])].slice(0, 30).map(a => clean((a.address || "").toLowerCase(), 254))),
    subject: clean(envelope.subject || "(bez tematu)", 500),
    sentAt: (envelope.date || message.internalDate || new Date()).toISOString(),
    snippet: clean(oneLine(text), 300),
    bodyText: clean(text, MAX_BODY),
    attachments: attachments.length ? JSON.stringify(attachments.slice(0, 30)) : "",
    invite: clean(invite, 50000),
    seen: message.seen
  };
}

// Sender address first, then the company domain (never a public mailbox domain).
async function matchMail(db) {
  await db.query(
    `UPDATE mail_messages m SET client_id = c.id FROM clients c
     WHERE m.client_id IS NULL AND c.status <> 'archived' AND c.email IS NOT NULL AND m.from_address = c.email`);
  await db.query(
    `UPDATE mail_messages m SET client_id = c.id FROM clients c
     WHERE m.client_id IS NULL AND c.status <> 'archived' AND c.domain IS NOT NULL
       AND split_part(m.from_address, '@', 2) = c.domain AND NOT (split_part(m.from_address, '@', 2) = ANY($1::text[]))`,
    [[...PUBLIC_DOMAINS]]);
}

// One sync. Returns { added, removed, error? }; never throws.
async function syncMail(pool, source, config) {
  try {
    const { uidValidity, uids } = await source.state();
    const mailbox = config.mailbox;
    const window = uids.slice(-config.limit);
    const known = new Set((await pool.query("SELECT uid FROM mail_messages WHERE mailbox = $1 AND uid_validity = $2", [mailbox, uidValidity])).rows.map(r => Number(r.uid)));
    const fresh = window.filter(uid => !known.has(uid));
    const rows = [];
    for (let i = 0; i < fresh.length; i += 25) {
      for (const message of await source.messages(fresh.slice(i, i + 25))) rows.push(await toRow(message));
    }
    const seen = await source.flags([...known].filter(uid => uids.includes(uid)));
    const result = await withTransaction(pool, async db => {
      const { rows: [lock] } = await db.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [SYNC_LOCK_ID]);
      if (!lock.ok) return { added: 0, removed: 0 };
      // gone from the server, or from an older UIDVALIDITY (the server renumbered the mailbox)
      const removed = (await db.query(
        "DELETE FROM mail_messages WHERE mailbox = $1 AND (uid_validity <> $2 OR NOT (uid = ANY($3::bigint[])))", [mailbox, uidValidity, uids])).rowCount;
      for (const row of rows) {
        await db.query(
          `INSERT INTO mail_messages (mailbox, uid_validity, uid, message_id, from_address, from_name, to_addresses, subject, sent_at, snippet,
             body_text, attachments, invite, seen)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (mailbox, uid_validity, uid) DO NOTHING`,
          [mailbox, uidValidity, row.uid, row.messageId, row.fromAddress, row.fromName, row.toAddresses, row.subject, row.sentAt, row.snippet,
            row.bodyText, row.attachments, row.invite, row.seen]);
      }
      for (const [uid, isSeen] of Object.entries(seen)) {
        await db.query("UPDATE mail_messages SET seen = $1 WHERE mailbox = $2 AND uid_validity = $3 AND uid = $4 AND seen <> $1", [isSeen, mailbox, uidValidity, Number(uid)]);
      }
      await matchMail(db);
      return { added: rows.length, removed };
    });
    return result;
  } catch (error) {
    return { added: 0, removed: 0, error: describe(error) };
  }
}

// A short, secret-free reason for the Poczta screen.
function describe(error) {
  if (error.authenticationFailed || /auth/i.test(error.responseText || "")) return "Serwer poczty odrzucił login lub hasło.";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(error.code)) return "Nie znaleziono serwera poczty.";
  if (["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(error.code)) return "Brak połączenia z serwerem poczty.";
  if (/certificate|self.signed/i.test(error.message || "")) return "Certyfikat serwera poczty jest nieprawidłowy.";
  return "Synchronizacja poczty nie powiodła się.";
}

// Every config.everyMs, plus on demand (status() / now()). afterSync runs after each successful sync (meeting briefs
// from Gemini's notes e-mails, briefs.js); its failure never breaks the sync.
function scheduleMailSync(pool, source, config, { firstRunMs = 15000, afterSync = null } = {}) {
  const status = { lastSyncAt: null, error: null, running: null };
  const run = () => {
    if (status.running) return status.running;
    status.running = syncMail(pool, source, config).then(async result => {
      if (!result.error && afterSync) {
        try { result.briefs = (await afterSync()).length; } catch { console.error("after mail sync failed"); }
      }
      Object.assign(status, { lastSyncAt: new Date().toISOString(), error: result.error || null, running: null });
      return result;
    });
    return status.running;
  };
  const first = setTimeout(run, firstRunMs);
  const every = setInterval(run, config.everyMs);
  first.unref(); every.unref();
  return { status, now: run, stop() { clearTimeout(first); clearInterval(every); } };
}

module.exports = { createImapSource, syncMail, scheduleMailSync, toRow, matchMail, describe };
