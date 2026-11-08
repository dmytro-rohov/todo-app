# Release 2: calendars, clients, accounts, Poczta, briefs, Workflow ToDo

Production runs `9893510` (Tasks 1.0 + PWA). This release adds migrations **0004–0009**, all additive (CREATE TABLE /
INDEX, ADD COLUMN, FK; checked with Mytko's Drizzle grammar): Google calendars, clients, accounts, mail, briefs,
Workflow links. Existing data is untouched; everything that existed belongs to the owner (`user_id NULL`).

## Before
- Backup of the production database (see PRODUCTION.md, section 5).
- No new environment variable is required: every new feature is off until configured (`docs/CALENDAR-SETUP.md`,
  `BOOKING.md`, `MAIL.md`, `BRIEFS.md`, `WORKFLOW-TODO.md`; `deploy/app.env.example` lists them).

## Release
Through Mytko Workflow as usual (Session → Prepare → Approve → Deploy with TOTP); the "Migracja bazy" step applies
0004–0009 before the new image starts. `/readyz` answers only when all of them are applied.

## After
- Sign in (password and "Zaloguj kontem Mytko"), board, list, calendar, archive; a task's panel; the timer.
- Porządek → Konta (owner only); Rozmiar interfejsu.
- Then turn features on one by one: set the variables in `deploy/app.env`, `node deploy/check-env.cjs …`,
  `docker compose up -d app` (no new release needed).

## Rollback
Previous image (`APP_IMAGE=<previous digest> docker compose up -d`). The new tables and columns stay; the old version
ignores them.
