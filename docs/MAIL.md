# Poczta

The **Poczta** tab (owner only) shows the studio mailbox, hello@mytko.dev on OVH Zimbra, over IMAP. The mailbox stays
the source: Tasks keeps a copy of the newest messages (`MAIL_FETCH_LIMIT`, 200) of `INBOX`, synced every
`MAIL_SYNC_MINUTES` (3) and on "Odśwież". On the server Tasks only marks messages read (when you open one).

From a message:

- **Utwórz zadanie**: the new task dialog with the subject, the sender and the text, in Praca, linked to the e-mail and
  its client; the e-mail is then marked handled (undo in the toast). The task shows "Otwórz wiadomość".
- **Zaproponuj zadania (Claude)**: a summary, whether a reply is expected, and tasks; "Dodaj" adds one. Coding tasks are
  marked "kod → Workflow" (sent to the Mytko Workflow ToDo in stage C6). Needs `ANTHROPIC_API_KEY`.
- **Nowy lead z nadawcy** / client select: e-mails are matched to clients by the sender's address, then the company
  domain (never gmail.com and other public mailboxes).
- **Dodaj do kalendarza Praca**: an invitation (text/calendar) is imported into the Praca Google Calendar as the
  organizer's event; nobody is notified.
- **Odpowiedz** opens your mail program (Thunderbird); **Załatwione** hides the message in Tasks only.

## Settings (Tasks environment)

| Variable | Example | |
| --- | --- | --- |
| `MAIL_IMAP_HOST` | OVH Zimbra IMAP host from the OVH panel | required with the two below |
| `MAIL_IMAP_USER` | `hello@mytko.dev` | |
| `MAIL_IMAP_PASSWORD` | the mailbox password | env file only, `chmod 600` |
| `MAIL_IMAP_PORT` | `993` | TLS always in production |
| `MAIL_MAILBOX` | `INBOX` | |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | optional, Claude proposals |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | optional |

Tests: `backend/test/mail.test.js` (invitations, parsing, settings, Claude), `backend/test/mail.integration.test.js`
(a real IMAP server: GreenMail, `TEST_IMAP_PORT`), `CALENDAR=1 MAIL=1 TEST=e2e/ui-mail.mjs e2e/ui-run.sh …`.
