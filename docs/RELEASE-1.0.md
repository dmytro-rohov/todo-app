# Mytko Tasks 1.0 — production release checklist

From the Lite release (`a5aed09`, live on `tasks.mytko.dev`) to 1.0. Two schema migrations come with it, so the order
below matters: **a Mytko release only replaces the `app` container and never migrates, while `/readyz` requires
every migration the image ships**. Deploying first would leave the new container unready.

## What changes for the owner

- Login screen instead of the browser's password dialog: the same login and password as before (`AUTH_USERNAME` /
  `AUTH_PASSWORD_HASH`), then a 7-day session. "Zaloguj kontem Mytko" stays disabled until step 6.
- The new interface (board, list, calendar, task panel). Existing tasks keep their ids, titles, dates and order and
  appear in the private space ("Prywatne"); move them to "Praca" or into projects as needed.

## Steps (operator)

1. **Image.** In Mytko Workflow, prepare the release of the current `main` (build-attest builds and signs
   `ghcr.io/dmytro-rohov/todo-app@sha256:…`). Note the digest; do not deploy yet.
2. **Backup** on mary-vps, as `tasks_owner` (PRODUCTION.md §5):
   `pg_dump -Fc -d "$OWNER_URL" -f tasks-$(date -u +%Y%m%dT%H%M%SZ)-pre-1.0.dump`
3. **Migrate with the new image** (applies `0001_tasks_1_0` and `0002_auth_sessions`, additive only, and grants the
   app role DML on every table in `public`):
   `cd /srv/apps/mytko-tasks/release/deploy && APP_IMAGE=<digest from step 1> docker compose run --rm migrate`
   It must end with `applied 2 migration(s)`. If the migration is applied by Mytko's Database Broker instead, run
   the same command afterwards anyway: it is idempotent and is what grants the app role access to the new tables.
4. **Deploy** through Mytko (approve → preview → authenticator code). The release waits for `/readyz`.
5. **Verify:**
   - `curl -s -o /dev/null -w '%{http_code}' https://tasks.mytko.dev/` → `200` (login screen);
   - `curl -s -o /dev/null -w '%{http_code}' https://tasks.mytko.dev/api/tasks` → `401`, no `WWW-Authenticate`;
   - sign in in a browser, open the board, drag a card, open a task, add a note, log out.
6. **"Zaloguj kontem Mytko" (optional, after the Workflow PR `feat/sso-provider` is merged and released):**
   - `SECRET=$(openssl rand -base64 36)`; register client `tasks` with
     `redirect_uri=https://tasks.mytko.dev/auth/mytko/callback` in Workflow (`docs/web-login.md` there);
   - in `deploy/app.env` on mary-vps: `MYTKO_SSO_ORIGIN=https://workflow.mytko.dev`,
     `MYTKO_SSO_CLIENT_SECRET=$SECRET`, `MYTKO_SSO_LOGIN=<Workflow panel login>` (required); run
     `node deploy/check-env.cjs app.env migrate.env`, then recreate the `app` container;
   - the app container needs outbound HTTPS to `workflow.mytko.dev`;
   - check: signed in to Workflow, opening `tasks.mytko.dev` in the same browser lands on the board.

## Retention starts with this release

About a minute after the new container starts, done tasks older than 7 days move to the archive; private archived
tasks are deleted after 7 more days, others after 90 (`RETENTION_*` in app.env change this; 0 switches a step off).
Existing old done tasks are therefore archived right away, and deleted 7 or 90 days later.

## Rollback

- **Application:** Mytko "Recover" to the previous image. The Lite image tolerates the newer migrations, but it
  only knows three statuses: tasks in "Needs review" show as "In progress" there, and spaces, projects, labels,
  people, notes, subtasks and timers are invisible (not lost). Its login is the browser's Basic dialog again.
- **Schema:** nothing to roll back (additive). Restoring the step-2 dump is only for data loss, never routine.

## Ongoing

- After changing the owner password: `npm run revoke-sessions` (app role) ends every browser session.
- UI regression check against a seeded dev instance: `e2e/ui-seed.sh` then `node e2e/ui-smoke.mjs`.
