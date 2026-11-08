# Release 3: Ukrainian, board fixes, Cele / Marzenia

Production runs release 2 (`7d91a04`, migrations 0004–0009). This release adds migration **0010_goals**. It only creates the
`goals` table and its index and FK. It is checked with Mytko's Drizzle grammar, and existing data is untouched.

## What changes
- **Język**: Polish (main) or Ukrainian, chosen per device in Porządek → Język or with PL / УКР on the login screen.
  Content people write is never translated.
- **Board**: cards of tasks in a project get a pale tint of the project colour. "Wyczyść filtry" is a labelled
  button, shown only while a filter is on. Turning "Pokaż zakończone" off hides the Zakończone column. Priority can be
  chosen when a task is created. The timer dock lets drags pass through it.
- **Cele / Marzenia**: a new tab, see `GOALS.md`.
- **Timer dock** (merged after release 2): while a timer runs, a small card in the bottom-right corner shows the task
  and its time, with stop and open.

## Before
- Backup of the production database (PRODUCTION.md, section 5). No new environment variable.

## Release
Through Mytko Workflow as usual (Session → Prepare → Approve → Migracja bazy (TOTP) → Deploy (TOTP)).

## After
- Board, list, calendar, Cele / Marzenia (add an item, tick it off, switch month/year), Archiwum, Poczta.
- Porządek → Język → Українська, then back to Polski.

## Rollback
Previous image (`APP_IMAGE=<previous digest> docker compose up -d`). The `goals` table stays and the old version
ignores it.
