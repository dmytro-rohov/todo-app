# Meeting briefs

After a meeting with a client, Tasks prepares a **brief**: what was agreed, what to ask, the client's site brief,
proposed tasks and the next meeting. Claude writes it from the meeting notes; you accept what you want.

## Where the notes come from

1. **Gemini in Google Meet (automatic).** Start "Take notes for me" in Meet (Google Workspace). After the meeting Gemini
   e-mails "Notes: “<meeting>”" to the organizer, hello@mytko.dev, which lands in Poczta. After each mail sync Tasks
   picks such e-mails up, matches the meeting (the quoted title around the e-mail's time, else the Meet meeting that
   ended last, within 4 hours), creates the brief, runs Claude and marks the e-mail handled. Poczta shows
   "Notatki ze spotkania → brief".
2. **Pasted notes.** In a meeting: "Brief ze spotkania" → paste notes or a transcript (Zoom, a phone call, notes on
   paper) → "Przygotuj brief (Claude)".

## The brief

- summary, decisions, open questions;
- **site brief** with Website Factory's `brief.json` names (business, about, offer, audience, goal, tone, style,
  notes), only facts said at the meeting; "Kopiuj JSON (Website Factory)" copies it;
- proposed tasks ("Dodaj" / "Dodaj wszystkie": Praca, linked to the meeting and its client; coding tasks are marked
  "kod → Workflow" for stage C6);
- the next meeting: "Zaplanuj spotkanie" opens the meeting dialog with the title, date and guests.

Without an AI key (`AI_API_KEY`, `AI.md`) or with AI turned off, the notes are kept, without a brief. Data: `meeting_briefs` (migration `0008_briefs`),
`backend/briefs.js`, `routes/briefs.js`. Tests: `briefs.test.js`, the Gemini case in `mail.integration.test.js`,
`e2e/ui-mail.mjs`.
