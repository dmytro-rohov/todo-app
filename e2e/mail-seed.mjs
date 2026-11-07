// Puts test messages into the GreenMail inbox of ui-run.sh (MAIL=1): a client's request, a stranger from gmail.com and
// an invitation with a calendar part. Uses the backend's imapflow.
import { createRequire } from "node:module";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { ImapFlow } = require("imapflow");
const port = Number(process.env.MAIL_PORT || 3144);
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
const msg = (from, subject, body, extra = [], date = new Date()) => [`From: ${from}`, "To: hello@mytko.dev", `Subject: ${subject}`, `Date: ${date.toUTCString()}`, ...extra, "", body, ""].join("\r\n");
const client = new ImapFlow({ host: "127.0.0.1", port, secure: false, auth: { user: "hello@mytko.dev", pass: "imap-test-only" }, logger: false });
await client.connect();
await client.append("INBOX", msg("Anna Róża <anna@kwiaciarnia.pl>", "Wycena sklepu internetowego",
  "Dzień dobry,\r\nprosimy o wycenę sklepu internetowego dla kwiaciarni do piątku.\r\nPrzykład: https://kwiaciarnia.pl/oferta\r\n\r\nAnna", ["Content-Type: text/plain; charset=utf-8"]));
await client.append("INBOX", msg("Jan Nowak <jan.nowak@gmail.com>", "Strona dla mojej firmy", "Szukam kogoś do strony dla warsztatu samochodowego."));
await client.append("INBOX", msg("Agencja Partner <biuro@agencja-partner.pl>", "Zaproszenie: Warsztat UX", ["--b", "Content-Type: text/plain; charset=utf-8", "", "Zapraszamy.",
  "--b", "Content-Type: text/calendar; method=REQUEST; charset=utf-8", "", "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:ux-1@agencja-partner.pl",
  `DTSTART:${day(3)}T090000Z`, `DTEND:${day(3)}T110000Z`, "SUMMARY:Warsztat UX", "ORGANIZER:mailto:biuro@agencja-partner.pl", "END:VEVENT", "END:VCALENDAR", "--b--"].join("\r\n"),
  ["MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b"']));
// Gemini's notes, right after today's 10:00–11:00 meeting with the lead (fake-google.mjs)
const after = new Date(); after.setHours(11, 5, 0, 0);
await client.append("INBOX", msg("Gemini <gemini-notes@google.com>", "Notes: “Spotkanie z leadem: Kwiaciarnia Róża”",
  "Summary\r\nKwiaciarnia chce sklepu internetowego.\r\n\r\nNext steps\r\nMakieta i wycena.", [], after));
await client.logout();
