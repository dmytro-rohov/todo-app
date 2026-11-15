// Poczta against a real IMAP server (GreenMail on loopback, TEST_IMAP_PORT), a disposable PostgreSQL, a fake Claude
// API and a fake Google Calendar: sync, client matching, reading marks the message read on the server, leads,
// Claude's proposals, tasks from an e-mail, invitations into the Praca calendar, messages deleted on the server.
//   docker run -d -p 127.0.0.1:3143:3143 -e GREENMAIL_OPTS="-Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0
//     -Dgreenmail.users=hello:imap-test-only@mytko.dev -Dgreenmail.users.login=email" greenmail/standalone:2.1.3
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { ImapFlow } = require("imapflow");

const { createPool } = require("../kit");
const { runMigrations, listMigrations } = require("../kit");
const { startApp, SAME_ORIGIN_JSON } = require("./support");
const { encrypt, parseKey } = require("../secrets");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const IMAP_PORT = Number(process.env.TEST_IMAP_PORT || 0);
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);
const KEY = crypto.randomBytes(32).toString("base64");
const skip = !OWNER_URL || !APP_URL || !IMAP_PORT ? "TEST_* database URLs / TEST_IMAP_PORT not set" : false;
const IMAP = { host: "127.0.0.1", port: IMAP_PORT, secure: false, auth: { user: "hello@mytko.dev", pass: "imap-test-only" }, logger: false };

const message = ({ from, subject, body, id, extra = [], date = "Sat, 07 Nov 2026 10:00:00 +0100" }) => [`From: ${from}`, "To: hello@mytko.dev", `Subject: ${subject}`,
  `Date: ${date}`, `Message-ID: <${id}@test>`, ...extra, "", body, ""].join("\r\n");
const INVITE = message({ from: "Organizator <biuro@agencja-partner.pl>", subject: "Zaproszenie: warsztat", id: "inv", extra: ["MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b"'],
  body: ["--b", "Content-Type: text/plain; charset=utf-8", "", "Zapraszamy na warsztat.", "--b", "Content-Type: text/calendar; method=REQUEST; charset=utf-8", "",
    "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:warsztat-1@agencja-partner.pl", "DTSTART:20261120T090000Z", "DTEND:20261120T110000Z",
    "SUMMARY:Warsztat UX", "ORGANIZER:mailto:biuro@agencja-partner.pl", "ATTENDEE:mailto:hello@mytko.dev", "END:VEVENT", "END:VCALENDAR", "--b--"].join("\r\n") });

function fakeApis() {
  const state = { claude: 0, imported: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      if (req.url === "/v1/messages") {
        state.claude++;
        assert.equal(req.headers["x-api-key"], "sk-test");
        if (JSON.parse(body).tool_choice.name === "meeting_brief") {
          state.briefNotes = JSON.parse(body).messages[0].content;
          return send(200, { content: [{ type: "tool_use", name: "meeting_brief", input: { summary: "Ustalono zakres sklepu.", decisions: ["30 produktów na start"],
            openQuestions: ["Budżet"], siteBrief: { business: { name: "Kwiaciarnia Róża" }, goal: "Zamówienia online" },
            tasks: [{ title: "Przygotować makietę sklepu", priority: "P1", coding: true }], nextMeeting: { needed: true, title: "Prezentacja makiety", date: "2026-11-14" } } }] });
        }
        return send(200, { content: [{ type: "tool_use", name: "propose_tasks", input: { summary: "Prośba o wycenę.", needsReply: true,
          tasks: [{ title: "Przygotować wycenę sklepu", priority: "P1", coding: false }, { title: "Postawić demo sklepu", priority: "P2", coding: true }] } }] });
      }
      if (req.url === "/token") return send(200, { access_token: "at", expires_in: 3600 });
      if (req.url.startsWith("/cal/calendars/primary/events/import")) {
        const event = { id: `imp${state.imported.length + 1}`, status: "confirmed", ...JSON.parse(body) };
        state.imported.push(event);
        return send(200, event);
      }
      send(404, {});
    });
  });
  return { server, state };
}

describe("Poczta", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let ctx;
  let apis;
  let imap;

  before(async () => {
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
    await owner.query(`DROP TABLE IF EXISTS public.push_log, public.push_subscriptions, public.avatars, public.space_invites, public.space_members, public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions,
      public.task_history, public.task_time_entries, public.task_subtasks, public.task_notes, public.task_labels, public.tasks, public.projects, public.spaces,
      public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: "tasks_app", log: () => {} });
    imap = new ImapFlow(IMAP);
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try { if (imap.mailbox.exists) await imap.messageDelete("1:*"); } finally { lock.release(); }
    await imap.append("INBOX", message({ from: "Anna <anna@kwiaciarnia.pl>", subject: "Wycena sklepu", id: "a1", body: "Prosimy o wycenę sklepu do piątku." }));
    await imap.append("INBOX", message({ from: "Jan Nowak <jan.nowak@gmail.com>", subject: "Strona dla mojej firmy", id: "j1", body: "Szukam kogoś do strony." }));
    await imap.append("INBOX", INVITE);
    apis = fakeApis();
    await new Promise(resolve => apis.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${apis.server.address().port}`;
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS,
      // development: a plain-text IMAP test server and a fake Claude are refused in production
      env: { NODE_ENV: "development", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", TASKS_SECRET_KEY: KEY,
        MAIL_IMAP_HOST: "127.0.0.1", MAIL_IMAP_PORT: String(IMAP_PORT), MAIL_IMAP_TLS: "false", MAIL_IMAP_USER: "hello@mytko.dev",
        MAIL_IMAP_PASSWORD: "imap-test-only", ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_DEV_BASE: base },
      appOptions: { googleUrls: { authBase: base, tokenUrl: `${base}/token`, apiBase: `${base}/cal` }, mailFirstRunMs: 3600000 } });
    // the Praca calendar is connected (the fake Google answers every token request)
    const work = (await call("/api/spaces")).body.find(s => s.key === "work");
    await owner.query("INSERT INTO calendar_accounts (space_id, account_email, refresh_token_enc) VALUES ($1, 'hello@mytko.dev', $2)",
      [work.id, encrypt(parseKey(KEY), "refresh")]);
    const kwiaciarnia = (await call("/api/clients", "POST", { name: "Kwiaciarnia Róża", email: "anna@kwiaciarnia.pl" })).body;
    // a Meet meeting with the client that has just ended
    const account = (await owner.query("SELECT id FROM calendar_accounts")).rows[0].id;
    await owner.query(`INSERT INTO calendar_events (account_id, external_id, title, start_at, end_at, meet_url, client_id)
      VALUES ($1, 'meet-1', 'Omówienie sklepu', now() - interval '90 minutes', now() - interval '30 minutes', 'https://meet.google.com/abc', $2)`, [account, kwiaciarnia.id]);
  });

  after(async () => {
    await ctx?.close();
    await imap?.logout().catch(() => {});
    await new Promise(resolve => apis?.server.close(resolve));
    await appPool.end();
    await owner.end();
  });

  const call = async (url, method = "GET", body) => {
    const res = await ctx.request(url, method === "GET" ? {} : { method, headers: SAME_ORIGIN_JSON, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const byFrom = async (address, view = "inbox") => (await call(`/api/mail?view=${view}`)).body.messages.find(m => m.fromAddress === address);
  const seenOnServer = async id => {
    const lock = await imap.getMailboxLock("INBOX");
    try {
      for await (const item of imap.fetch("1:*", { envelope: true, flags: true })) if (item.envelope.messageId === `<${id}@test>`) return item.flags.has("\\Seen");
    } finally { lock.release(); }
    return null;
  };

  test("sync copies the inbox, matches the client by address and lists the newest first", async () => {
    const before = (await call("/api/mail")).body;
    assert.deepEqual([before.configured, before.address, before.ai, before.messages.length], [true, "hello@mytko.dev", true, 0]);
    const sync = await call("/api/mail/sync", "POST", {});
    assert.deepEqual([sync.status, sync.body.added, sync.body.error], [200, 3, undefined]);
    assert.equal((await call("/api/mail/sync", "POST", {})).body.added, 0); // nothing new the second time
    const list = (await call("/api/mail")).body;
    assert.deepEqual(list.counts, { open: 3, unread: 3, clients: 1 });
    const anna = list.messages.find(m => m.fromAddress === "anna@kwiaciarnia.pl");
    assert.deepEqual([anna.subject, anna.snippet, anna.seen, anna.taskCount, Boolean(anna.clientId)], ["Wycena sklepu", "Prosimy o wycenę sklepu do piątku.", false, 0, true]);
    assert.equal((await call("/api/mail?view=clients")).body.messages.length, 1);
    assert.equal((await call("/api/mail?q=strony")).body.messages[0].fromAddress, "jan.nowak@gmail.com");
  });

  test("opening marks the message read here and on the server; Claude proposes tasks; a task links back", async () => {
    const anna = await byFrom("anna@kwiaciarnia.pl");
    const full = (await call(`/api/mail/${anna.id}`)).body;
    assert.equal(full.bodyText.trim(), "Prosimy o wycenę sklepu do piątku.");
    assert.equal(full.uid, undefined); // server internals stay inside
    assert.equal((await call(`/api/mail/${anna.id}/seen`, "POST", {})).status, 200);
    assert.equal((await byFrom("anna@kwiaciarnia.pl")).seen, true);
    for (let i = 0; i < 20 && !(await seenOnServer("a1")); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await seenOnServer("a1"), true);

    const suggestion = (await call(`/api/mail/${anna.id}/suggest`, "POST", {})).body;
    assert.deepEqual(suggestion.tasks.map(t => [t.title, t.coding]), [["Przygotować wycenę sklepu", false], ["Postawić demo sklepu", true]]);
    assert.equal((await call(`/api/mail/${anna.id}`)).body.suggestion.summary, "Prośba o wycenę.");
    const task = (await call("/api/tasks", "POST", { title: suggestion.tasks[0].title, date: "2026-11-07", mailId: anna.id, clientId: anna.clientId })).body;
    assert.equal(task.mailId, anna.id);
    assert.deepEqual((await call(`/api/mail/${anna.id}`)).body.tasks.map(t => t.id), [task.id]);
    assert.equal((await call(`/api/mail/${anna.id}`, "PATCH", { handled: true })).body.handledAt !== null, true);
    assert.equal((await call("/api/mail?view=handled")).body.messages.length, 1);
    assert.equal((await call("/api/mail")).body.counts.open, 2);
  });

  test("a lead from a sender with a public mailbox; the invitation goes into the Praca calendar", async () => {
    const jan = await byFrom("jan.nowak@gmail.com");
    const lead = await call(`/api/mail/${jan.id}/lead`, "POST", {});
    assert.equal(lead.status, 201);
    const client = (await call(`/api/clients/${lead.body.clientId}`)).body;
    assert.deepEqual([client.name, client.status, client.source, client.domain], ["Jan Nowak", "lead", "mail", null]);
    assert.equal((await byFrom("jan.nowak@gmail.com")).clientId, client.id);
    assert.equal((await call(`/api/mail/${jan.id}/lead`, "POST", {})).body.clientId, client.id); // the same client again

    const invite = await byFrom("biuro@agencja-partner.pl");
    assert.equal(invite.hasInvite, true);
    const full = (await call(`/api/mail/${invite.id}`)).body;
    assert.deepEqual([full.invite.title, full.invite.start, full.invite.organizer], ["Warsztat UX", { dateTime: "2026-11-20T09:00:00.000Z" }, "biuro@agencja-partner.pl"]);
    assert.equal((await call(`/api/mail/${jan.id}/invite`, "POST", {})).status, 404);
    const added = await call(`/api/mail/${invite.id}/invite`, "POST", {});
    assert.equal(added.status, 201);
    assert.deepEqual([apis.state.imported[0].iCalUID, apis.state.imported[0].organizer.email], ["warsztat-1@agencja-partner.pl", "biuro@agencja-partner.pl"]);
    const event = (await call("/api/calendar/events?from=2026-11-19&to=2026-11-21")).body.find(e => e.id === added.body.eventId);
    assert.equal(event.title, "Warsztat UX");
  });

  test("Gemini's notes e-mail becomes the meeting's brief; pasted notes make one too", async () => {
    await imap.append("INBOX", message({ from: "Gemini <gemini-notes@google.com>", subject: "Notes: “Omówienie sklepu”", id: "g1", date: new Date().toUTCString(), // Gemini mails right after the meeting
      body: "Summary\r\nKlientka chce sklep z dostawą.\r\nNext steps\r\nMakieta do piątku." }));
    const sync = (await call("/api/mail/sync", "POST", {})).body;
    assert.deepEqual([sync.added, sync.briefs], [1, 1]);
    const event = (await owner.query("SELECT id, client_id FROM calendar_events WHERE external_id = 'meet-1'")).rows[0];
    const listed = (await call(`/api/briefs?eventId=${event.id}`)).body.briefs;
    assert.equal(listed.length, 1);
    const brief = (await call(`/api/briefs/${listed[0].id}`)).body;
    assert.deepEqual([brief.source, brief.clientId, brief.event.title, brief.result.summary, brief.result.nextMeeting.title],
      ["gemini-mail", event.client_id, "Omówienie sklepu", "Ustalono zakres sklepu.", "Prezentacja makiety"]);
    assert.match(apis.state.briefNotes, /Spotkanie: „Omówienie sklepu”[\s\S]*Klient: Kwiaciarnia Róża[\s\S]*Makieta do piątku/);
    const mail = (await call("/api/mail?view=handled")).body.messages.find(m => m.fromAddress === "gemini-notes@google.com");
    assert.equal(mail.clientId, event.client_id); // handled, with the meeting's client
    assert.equal((await call(`/api/mail/${mail.id}`)).body.brief.eventId, event.id);
    assert.equal((await call("/api/mail/sync", "POST", {})).body.briefs, 0); // once only

    assert.equal((await call("/api/briefs", "POST", { eventId: event.id, notes: "krótko" })).status, 400);
    const pasted = await call("/api/briefs", "POST", { notes: "Rozmowa telefoniczna z Anną: chce zmienić termin makiety na poniedziałek." });
    assert.deepEqual([pasted.status, pasted.body.source, pasted.body.event, Boolean(pasted.body.result)], [201, "paste", null, true]);
    assert.equal((await call("/api/briefs?unassigned=true")).body.briefs.length, 1);
    assert.equal((await call(`/api/briefs/${pasted.body.id}`, "PATCH", { eventId: event.id })).body.event.id, event.id);
    assert.equal((await call(`/api/briefs?eventId=${event.id}`)).body.briefs.length, 2);
    assert.equal((await call(`/api/briefs/${pasted.body.id}/run`, "POST", {})).body.result.decisions[0], "30 produktów na start");
    assert.equal((await call(`/api/briefs/${pasted.body.id}`, "DELETE")).status, 200);
  });

  test("messages deleted on the server disappear; tasks made from them stay", async () => {
    const anna = await byFrom("anna@kwiaciarnia.pl", "handled");
    const lock = await imap.getMailboxLock("INBOX");
    try { await imap.messageDelete({ header: { "message-id": "<a1@test>" } }); } finally { lock.release(); }
    assert.equal((await call("/api/mail/sync", "POST", {})).body.removed, 1);
    assert.equal((await call(`/api/mail/${anna.id}`)).status, 404);
    const task = (await call("/api/tasks")).body.find(t => t.title === "Przygotować wycenę sklepu");
    assert.equal(task.mailId, null);
  });
});
