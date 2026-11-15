# Release 11: push notifications, app switcher, Mytko Kit 0.13.1

Production runs release 10 (`c5dfd13`). **Migration `0014_push`** (additive: tables `push_subscriptions`, `push_log`,
their indexes and foreign keys; `prefs` is text with JSON so it passes Mytko's migration grammar).

## What changes
- Web Push: a device can turn on notifications; the "Na dziś" digest once a day, on the first run from 8:00 Warsaw time (the job runs every 15 minutes, so by 8:15). Needs `PUSH_VAPID_PUBLIC_KEY` and
  `PUSH_VAPID_PRIVATE_KEY` in the production env (already set on mary-vps).
- The Mytko app switcher.
- `/api/assistant` tools `tasks.add_task` and `tasks.today` (off until `ASSISTANT_TOKEN_SHA256` is set, for Mytko Home);
  the assistant's deadline, priority and description go through the form's checks.
- Mytko Kit 0.13.1 (AI: strict-schema fix, pictures in structured(), aiModels()).

## Release
Through Mytko Workflow: Session → Prepare → Approve → **Migracja bazy** (TOTP) → Deploy (TOTP). Run the migration and
the deploy right after Approve (approval is valid for 10 minutes).
