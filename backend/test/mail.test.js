// Poczta without a server: invitations (.ics), message parsing, sync error messages, MAIL_* / ANTHROPIC_* settings
// and Claude's proposals against a fake API.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseInvite } = require("../ics");
const { toRow, describe: describeError } = require("../mail-sync");
const { loadConfig } = require("../config");
const { proposeFromMail, cleanTasks, AiError } = require("../claude");

const base = { NODE_ENV: "development", DATABASE_URL: "postgres://x@127.0.0.1/x", AUTH_DISABLED: "true" };

test("invitations: Google (UTC), Outlook (Windows zone, folded lines), all-day, cancellation", () => {
  const google = parseInvite(["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:abc@google.com", "DTSTART:20261112T090000Z",
    "DTEND:20261112T100000Z", "SUMMARY:Omówienie strony", "ORGANIZER;CN=Anna:mailto:Anna@Kwiaciarnia.pl",
    "ATTENDEE;CN=hello:mailto:hello@mytko.dev", "DESCRIPTION:Dołącz: https://meet.google.com/abc-defg-hij\\nDo zobaczenia", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  assert.deepEqual([google.method, google.uid, google.title, google.start, google.end, google.organizer, google.attendees, google.link],
    ["REQUEST", "abc@google.com", "Omówienie strony", { dateTime: "2026-11-12T09:00:00.000Z" }, { dateTime: "2026-11-12T10:00:00.000Z" },
      "anna@kwiaciarnia.pl", ["hello@mytko.dev"], "https://meet.google.com/abc-defg-hij"]);
  assert.match(google.description, /\nDo zobaczenia$/);

  const outlook = parseInvite(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Spotkanie w sprawie", "  sklepu", 'DTSTART;TZID="Central European Standard Time":20261112T140000',
    'DTEND;TZID="Central European Standard Time":20261112T143000', "LOCATION:Microsoft Teams Meeting", "X-ALT:https://teams.microsoft.com/l/meetup-join/x",
    "DESCRIPTION:Link: https://teams.microsoft.com/l/meetup-join/19%3a", "END:VEVENT", "END:VCALENDAR"].join("\n"));
  assert.equal(outlook.title, "Spotkanie w sprawie sklepu"); // a folded line is joined (the fold drops one space)
  assert.deepEqual([outlook.start.dateTime, outlook.end.dateTime], ["2026-11-12T13:00:00.000Z", "2026-11-12T13:30:00.000Z"]); // CET
  assert.match(outlook.link, /^https:\/\/teams\.microsoft\.com\//);

  const allDay = parseInvite("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261224\nSUMMARY:Wigilia\nEND:VEVENT");
  assert.deepEqual([allDay.start, allDay.end], [{ date: "2026-12-24" }, { date: "2026-12-24" }]);
  assert.equal(parseInvite("BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nDTSTART:20261112T090000Z\nEND:VEVENT").method, "CANCEL");
  assert.equal(parseInvite("not a calendar"), null);
  assert.equal(parseInvite("BEGIN:VEVENT\nSUMMARY:no start\nEND:VEVENT"), null);
});

test("a fetched message becomes a row: text, snippet, attachments by name, the invitation in full", async () => {
  const source = Buffer.from([
    "From: =?UTF-8?Q?Anna_R=C3=B3=C5=BCa?= <Anna@Kwiaciarnia.PL>", "To: hello@mytko.dev", "Subject: =?UTF-8?Q?Wycena_sklepu?=",
    "Date: Sat, 07 Nov 2026 10:00:00 +0100", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "",
    "--b1", "Content-Type: text/plain; charset=utf-8", "", "Dzień dobry,\r\nprosimy o wycenę   sklepu.", "",
    "--b1", 'Content-Type: application/pdf; name="brief.pdf"', 'Content-Disposition: attachment; filename="brief.pdf"', "Content-Transfer-Encoding: base64", "", "JVBERi0=", "",
    "--b1", "Content-Type: text/calendar; method=REQUEST; charset=utf-8", "", "BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261112T090000Z", "SUMMARY:Call", "END:VEVENT", "END:VCALENDAR", "",
    "--b1--", ""].join("\r\n"));
  const envelope = { from: [{ name: "Anna Róża", address: "Anna@Kwiaciarnia.PL" }], to: [{ address: "hello@mytko.dev" }], subject: "Wycena sklepu",
    date: new Date("2026-11-07T09:00:00Z"), messageId: "<m1@kwiaciarnia.pl>" };
  const row = await toRow({ uid: 7, seen: false, envelope, source });
  assert.deepEqual([row.fromAddress, row.fromName, row.subject, row.sentAt, row.seen], ["anna@kwiaciarnia.pl", "Anna Róża", "Wycena sklepu", "2026-11-07T09:00:00.000Z", false]);
  assert.equal(row.snippet, "Dzień dobry, prosimy o wycenę sklepu.");
  assert.deepEqual(JSON.parse(row.attachments).map(a => a.name), ["brief.pdf"]);
  assert.match(row.invite, /SUMMARY:Call/);
  // raw UTF-8 headers (RFC 6532) are read from the source even when the server's envelope mangled them
  const raw = Buffer.from("From: Gemini <gemini-notes@google.com>\r\nSubject: Notes: “Spotkanie z Różą”\r\nDate: Sat, 07 Nov 2026 11:05:00 +0100\r\n\r\nSummary\r\n", "utf8");
  const mangled = await toRow({ uid: 9, seen: false, envelope: { subject: "Notes: ?Spotkanie z R??\u0105?", from: [{ address: "gemini-notes@google.com" }] }, source: raw });
  assert.deepEqual([mangled.subject, mangled.fromName, mangled.sentAt], ["Notes: “Spotkanie z Różą”", "Gemini", "2026-11-07T10:05:00.000Z"]);
  const big = await toRow({ uid: 8, seen: true, envelope, source: null });
  assert.match(big.bodyText, /za duża/);
});

test("sync errors are described without secrets", () => {
  assert.match(describeError(Object.assign(new Error("x"), { authenticationFailed: true })), /login lub hasło/);
  assert.match(describeError(Object.assign(new Error("x"), { code: "ENOTFOUND" })), /Nie znaleziono/);
  assert.match(describeError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), /Brak połączenia/);
  assert.match(describeError(new Error("weird")), /nie powiodła/);
});

test("MAIL_*, ANTHROPIC_* and WORKFLOW_TOKEN_SHA256 settings", () => {
  assert.equal(loadConfig(base).mail, null);
  assert.equal(loadConfig(base).ai, null);
  const mail = loadConfig({ ...base, MAIL_IMAP_HOST: "ssl0.ovh.net", MAIL_IMAP_USER: "hello@mytko.dev", MAIL_IMAP_PASSWORD: "x" }).mail;
  assert.deepEqual([mail.port, mail.tls, mail.address, mail.mailbox, mail.limit, mail.everyMs], [993, true, "hello@mytko.dev", "INBOX", 200, 180000]);
  assert.throws(() => loadConfig({ ...base, MAIL_IMAP_HOST: "ssl0.ovh.net" }), /set together/);
  assert.throws(() => loadConfig({ ...base, MAIL_IMAP_HOST: "ssl0.ovh.net/x", MAIL_IMAP_USER: "a", MAIL_IMAP_PASSWORD: "b" }), /host name/);
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://app:x@db/tasks", AUTH_USERNAME: "owner",
    AUTH_PASSWORD_HASH: "scrypt:1024:8:1:c2FsdHNhbHQ=:aGFzaGhhc2g=", PUBLIC_ORIGIN: "https://tasks.mytko.dev", TRUST_PROXY: "loopback" };
  assert.throws(() => loadConfig({ ...prod, MAIL_IMAP_HOST: "ssl0.ovh.net", MAIL_IMAP_USER: "a", MAIL_IMAP_PASSWORD: "b", MAIL_IMAP_TLS: "false" }), /not allowed in production/);
  const ai = loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_DEV_BASE: "http://127.0.0.1:1" }).ai;
  assert.deepEqual([ai.model, ai.apiBase], ["claude-sonnet-5-5", "http://127.0.0.1:1"]);
  assert.equal(loadConfig({ ...prod, ANTHROPIC_API_KEY: "sk", ANTHROPIC_DEV_BASE: "http://evil" }).ai.apiBase, "https://api.anthropic.com");
  assert.equal(loadConfig(base).workflow, null);
  assert.equal(loadConfig({ ...base, WORKFLOW_TOKEN_SHA256: "A".repeat(64) }).workflow.tokenSha256, "a".repeat(64));
  assert.throws(() => loadConfig({ ...base, WORKFLOW_TOKEN_SHA256: "plain-token" }), /64 hex/);
});

test("Claude's proposals are forced into the tool and validated; API errors become readable", async () => {
  const requests = [];
  const fake = answer => async (url, init) => { requests.push({ url, body: JSON.parse(init.body), headers: init.headers }); return answer; };
  const ok = { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "propose_tasks", input: {
    summary: "Klient prosi o wycenę sklepu.", needsReply: true,
    tasks: [{ title: "Przygotować wycenę sklepu", description: "Na podstawie briefu", dueDate: "2026-11-10", priority: "P1", coding: false },
      { title: "x", priority: "P9" }, { title: "Postawić demo sklepu", dueDate: "jutro", priority: "P7", coding: true }] } }] }) };
  const ai = { apiKey: "sk-test", model: "claude-sonnet-5-5", apiBase: "https://api.example" };
  const mail = { fromName: "Anna", fromAddress: "anna@kwiaciarnia.pl", subject: "Wycena", sentAt: "2026-11-07", bodyText: "Prosimy o wycenę." };
  const result = await proposeFromMail(ai, mail, { today: "2026-11-07", clientName: "Kwiaciarnia", fetchImpl: fake(ok) });
  assert.equal(requests[0].url, "https://api.example/v1/messages");
  assert.equal(requests[0].headers["x-api-key"], "sk-test");
  assert.deepEqual(requests[0].body.tool_choice, { type: "tool", name: "propose_tasks" });
  assert.match(requests[0].body.messages[0].content, /Nadawca to klient: Kwiaciarnia/);
  assert.deepEqual([result.summary, result.needsReply], ["Klient prosi o wycenę sklepu.", true]);
  assert.deepEqual(result.tasks.map(t => [t.title, t.dueDate, t.priority, t.coding]),
    [["Przygotować wycenę sklepu", "2026-11-10", "P1", false], ["Postawić demo sklepu", null, "P2", true]]);
  for (const [status, message] of [[401, /Klucz API/], [429, /Limit/], [500, /nie odpowiada/]]) {
    await assert.rejects(proposeFromMail(ai, mail, { today: "2026-11-07", fetchImpl: fake({ ok: false, status, json: async () => ({}) }) }),
      error => error instanceof AiError && message.test(error.message));
  }
  await assert.rejects(proposeFromMail(ai, mail, { today: "2026-11-07", fetchImpl: fake({ ok: false, status: 400, json: async () => ({ error: { message: "Your credit balance is too low" } }) }) }),
    /Brak środków/);
  assert.deepEqual(cleanTasks(null), []);
});
