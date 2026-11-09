# Release 4: tasks to Mytko Workflow by hand or by AI; AI and Workflow switches

Production runs release 3 (`ca8e15a`, migrations up to 0010). This release adds migration **0011_workflow_ai**,
additive only: the `app_settings` table and four nullable columns on `tasks`. Existing data is untouched.

## What changes
- A small Workflow button on every open card in Praca (never Prywatne) sends the task to the Workflow ToDo
  (with "Cofnij").
- Porządek → **AI i Workflow** (owner only):
  - the Workflow connection's state (active / no contact) with an on/off switch;
  - one switch for all AI;
  - three ways tasks reach Workflow: Ręcznie, AI podpowiada, AI wysyła sama.

  See `WORKFLOW-TODO.md`.
- AI behind a provider layer (`AI.md`): Claude by default, OpenAI or any OpenAI-compatible API with `AI_PROVIDER`.
  The old `ANTHROPIC_API_KEY` still works.
- The Język and Rozmiar interfejsu dialogs use radio cards (todo-app#28).

## Before
- Backup of the production database (PRODUCTION.md, section 5).
- No new environment variable. AI needs a key (`AI_API_KEY`, or the old `ANTHROPIC_API_KEY`), and the Workflow connection needs `WORKFLOW_TOKEN_SHA256`,
  as before. Defaults after the release: connection on, AI on, routing **Ręcznie**, so nothing is sent to the AI
  until you choose a mode.

## Release
Through Mytko Workflow (Session → Prepare → Approve → Migracja bazy (TOTP) → Deploy (TOTP)). Approve is valid for
10 minutes, so run the migration and the deploy right after it.

## After
- Porządek → AI i Workflow: Mytko Workflow should be "Aktywne" within 2 minutes while Fujitsu is on.
- A card in Praca → Workflow button → the item appears in Workflow's ToDo after its next sync (or "Synchronizuj").

## Rollback
Previous image. The new table and columns stay, and the old version ignores them.
