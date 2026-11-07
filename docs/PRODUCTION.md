# Mytko Tasks — production runbook (tasks.mytko.dev)

This document is the contract between the application and the operator /
Mytko release pipeline. Nothing in this repository deploys, creates
databases, sets DNS, changes Caddy or handles real secrets; every step marked
**operator** is performed outside the codebase.

For exact-artifact disposable acceptance and the external executor handoff,
follow [VALIDATION.md](VALIDATION.md). No deployment is authorized by that checklist. Dependency remediation and the
strict proxy-peer contract are recorded in [SECURITY-DEPENDENCIES.md](SECURITY-DEPENDENCIES.md).

## 1. Architecture

```
browser ──HTTPS──> Caddy (host, TLS for tasks.mytko.dev)
                     │  reverse_proxy 127.0.0.1:3100
                     ▼
            app container (node:24, uid 1000, read-only rootfs)
              Express 5: /api/* JSON, static frontend, /healthz, /readyz
                     │  DATABASE_URL (role tasks_app: data only)
                     ▼
            PostgreSQL (external, operator-managed)
                     ▲
            migrate container (one-shot, same image)
              MIGRATION_DATABASE_URL (role tasks_owner: owns schema)
```

**Persistent state lives only in PostgreSQL.** The application has no file
uploads or attachments and writes nothing to disk, so there is no data
volume. If attachments are added later, they need their own volume and
backup design.

## 2. Security model

| Concern | Implementation |
|---|---|
| Authentication | One owner account (`AUTH_USERNAME`, scrypt `AUTH_PASSWORD_HASH`), signed in on the app's login screen (same design as Mytko Workflow). Every `/api` route except `/api/auth/*` requires a session; HTTP Basic is still accepted for scripts and the smoke test but never requested (no `WWW-Authenticate`). The app shell and static assets hold no data and are public. Production refuses to start without credentials. |
| Authorization | Single-tenant: there is no user model, so all data belongs to the one authenticated owner. Multi-user support would need a schema change (`owner_id`) and is out of scope. |
| Sessions | Server-side, in `auth_sessions` (migration `0002`): the cookie `__Host-mytko-tasks-session` is a random 256-bit token, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; only its SHA-256 is stored. Sessions last `SESSION_TTL_HOURS` (default 168) from login, are never extended, survive restarts and releases, and end on logout. A new login replaces the browser's previous session; at most 32 are kept. After changing the password run `npm run revoke-sessions` (app role) to end all of them. Basic credentials are cached in memory only as an HMAC digest for 10 minutes. |
| Mytko sign-in | "Zaloguj kontem Mytko" (`routes/sso.js`): authorization code + PKCE S256 against Mytko Workflow (`/api/v1/auth/sso/*`, provider in mytko-workflow). Enabled only with `MYTKO_SSO_ORIGIN` + `MYTKO_SSO_CLIENT_SECRET` (≥ 32 chars) + `MYTKO_SSO_LOGIN` (required: the only Workflow login let in, because Workflow may have several operators); optional `MYTKO_SSO_CLIENT_ID`, default `tasks`. Every request re-checks a Mytko session against the current `MYTKO_SSO_LOGIN`, and password sessions against `AUTH_USERNAME`, so changing either ends older sessions. A valid session keeps working while its address is locked out after failed password guesses. The code is exchanged server to server; the browser only carries a 10-minute `__Host-mytko-tasks-sso` cookie (state + verifier). The login screen tries it automatically once per tab, never after a logout. Failures land on `/?sso=login_required|denied|failed|unavailable`; password login always remains. Requires outbound HTTPS from the app container to the Workflow origin. |
| Availability | Tasks needs only mary-vps: Caddy, the `app` container and its PostgreSQL. Mytko Workflow and the home server (Fujitsu) are needed for releases and for the optional "Zaloguj kontem Mytko" only. Before offering or starting that sign-in the app checks Workflow's public `/api/v1/health` (2.5 s timeout, cached 30 s); when it does not answer, the button is off, nobody is redirected there, and the login and password work as always. |
| Retention | The app archives done tasks after `RETENTION_ARCHIVE_DAYS` (7) and deletes archived ones for good after `RETENTION_DELETE_PRIVATE_DAYS` (7, private space) or `RETENTION_DELETE_WORK_DAYS` (90, everything else), hourly, as the app role (DML only), under an advisory lock. Deletion includes notes, subtasks, timers and history. Backups (§5) keep deleted tasks for their retention period. |
| Calendars | Each space can connect one Google Calendar (`routes/calendar.js`, OAuth with PKCE, scopes `calendar.events` + `calendar.readonly` + `email`). Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TASKS_SECRET_KEY` (all or none). Refresh tokens are AES-256-GCM encrypted in `calendar_accounts`; `calendar_events` is a copy of 60 days back to a year ahead, synced every 5 minutes on the app host (no dependency on the home server). Meetings created in Tasks are written to Google with `sendUpdates=all` (guests get Google's invitations) and optional Meet links. Disconnecting removes the copies, never the events in Google. |
| CSRF | Unsafe methods require `Sec-Fetch-Site: same-origin`. When fetch metadata is absent, a present `Origin` must equal `PUBLIC_ORIGIN`. Bodies must be `application/json`. There is no CORS. |
| XSS | Frontend escapes all user data inserted with `innerHTML`. Colours must be `#rrggbb` both server-side and client-side. A strict CSP is set (`script-src 'self'; style-src 'self'`, no inline). |
| Rate limits | 300 req/min per IP. After 10 failed logins, an IP is locked out for 15 minutes; the lockout is checked before scrypt runs. Limits are in memory, so they are valid for one replica only. |
| Validation | Types, lengths, real calendar dates, ids ≤ int4. Unknown category → 400. The JSON body limit is 10 KiB; compressed requests are rejected (415). |
| Headers | CSP, HSTS (production), nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP, Permissions-Policy. `X-Powered-By` is removed. |
| Errors | A central handler returns only generic messages. Database errors are logged by code only. |
| Health | `/healthz` (liveness) and `/readyz` (DB reachable + all shipped migrations applied) return only `{"status":"ok"|"unavailable"}`. Both are deliberately exempt from Basic auth (and from the auth lockout) so the container HEALTHCHECK and Caddy's active health check work without credentials; they serve nothing else. `/healthz` is also exempt from the rate limit. Caddy does not expose `/readyz` publicly (it triggers a DB query); Caddy's `health_uri` and the HEALTHCHECK reach it on the upstream directly. |
| Container | Non-root uid 1000. The app tree is root-owned and read-only. Read-only rootfs, `/tmp` tmpfs (noexec), `cap_drop: ALL`, `no-new-privileges`, no npm/yarn at runtime. Limits: 0.5 CPU / 256 MB / 128 pids. |
| DB privileges | The app role has SELECT/INSERT/UPDATE/DELETE on every table in `public` (granted by `migrate`), sequence usage, and SELECT on the Drizzle migration history (`drizzle.__drizzle_migrations`). It has no DDL, TRUNCATE or ownership. |

## 3. Operator prerequisites (before first release)

1. **Lockfile for the SCSS build.** The reviewed `frontend/package-lock.json` pins Sass 1.89.2. Preserve it and use `npm ci`; do not regenerate during release validation.
2. **Pin the base image.** Build with `--build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest>` and record the digest.
3. **Build and publish** the image from the reviewed commit, tagged by its git SHA (`--build-arg GIT_REVISION=<sha>`). Use the digest in `APP_IMAGE`.
4. **PostgreSQL 17** (the version used by release acceptance):
   - Create `tasks_owner`, `tasks_app` and the `tasks` database, following `deploy/db-roles.sql.example`. Use new random passwords (≥ 24 characters, different per role) from the secret store. Never reuse a password of another project or of the `postgres` superuser.
   - The roles belong to this project only: no superuser/CREATEROLE/CREATEDB, no membership in other projects' roles, and no grants for other roles on `tasks`. Verify with `\du tasks_*` and `\l tasks`.
   - Make the database reachable from the Docker bridge. When PostgreSQL runs on the host, `pg_hba.conf` and `listen_addresses` must allow the bridge subnet.
   - Use `sslmode=require` if traffic leaves the host.
5. **Secrets and proxy trust.** Create `deploy/app.env` and `deploy/migrate.env` from the `*.example` files on the server only, with `chmod 600`. `PUBLIC_ORIGIN` must be exactly `https://tasks.mytko.dev`: the CSRF check rejects browser writes from any other origin.

   Proxy trust: host Caddy connects to `127.0.0.1:3100`, and Docker forwards that to the container from the bridge gateway of the `mytko-tasks_default` network. The app therefore sees the gateway as its peer. Without trusting exactly that peer, every client shares one rate-limit and login-lockout bucket, so a stranger could lock out the owner. Procedure:
   ```sh
   docker compose up --no-start                # creates mytko-tasks_default, starts nothing
   docker network inspect mytko-tasks_default --format '{{(index .IPAM.Config 0).Gateway}}'
   # app.env: TRUST_PROXY=loopback,<gateway>/32
   ```
   Broad private ranges, `true` and hop counts are rejected in production. Caddy's `reverse_proxy` overwrites client-supplied `X-Forwarded-For` (no `trusted_proxies` configured), so the app sees the real client address; see SECURITY-DEPENDENCIES.md. Acceptance criterion 8 proves the per-client buckets.
   - Generate the hash with `printf '%s' "$PASSWORD" | docker run --rm -i "$APP_IMAGE" node backend/scripts/hash-password.js`. The password must be at least 12 characters.
   - Escape any `$` in DB passwords inside env files as `$$`, or avoid `$` in them.
   - Run the read-only check; it prints check names only, never values, and must report PASS:
     `node deploy/check-env.cjs deploy/app.env deploy/migrate.env`
6. **Backups** are configured and one restore has been tested (section 5) before real data is entered.
7. **DNS.** `tasks.mytko.dev` A/AAAA records point to the OVH host (operator; not part of the pipeline).
8. **Caddy.** Add a site block equivalent to `deploy/Caddyfile.example` and reload Caddy. Caddy must reach `127.0.0.1:3100`.
9. **Smoke test.** `TASKS_DISPOSABLE_APPROVED=yes TEST_IMAGE=<immutable-image> TEST_POSTGRES_IMAGE=<approved-postgres-17-digest> deploy/smoke-test.sh` passes on the approved disposable build host (Docker + Compose v2 + curl).

## 4. Release procedure (operator)

```sh
cd deploy
export APP_IMAGE=<registry>/mytko-tasks@sha256:<digest>
# 0. read-only configuration check (must print PASS)
node check-env.cjs app.env migrate.env
# 1. pre-release backup (skip only for the very first release on an empty DB)
pg_dump -Fc -d "$OWNER_URL" -f "tasks-$(date -u +%Y%m%dT%H%M%SZ)-pre-$SHA.dump"
# 2. migrate, then start app (compose orders them; app waits for migrate)
docker compose up -d
# 3. verify
docker compose ps                       # app healthy, migrate exited 0
curl -fsS https://tasks.mytko.dev/healthz
curl -fsS http://127.0.0.1:3100/readyz  # on the host; publicly 404 by design
```

A failed migration exits non-zero. The failed migration's transaction is rolled back, and `app` does not start or replace the running one. Fix it forward and re-run.

## 5. Backup and restore

**What to back up:** the PostgreSQL database `tasks`, and nothing else. The image is rebuilt from git and secrets live in the secret store.

| Item | Requirement |
|---|---|
| Method | `pg_dump -Fc` as `tasks_owner`, or a dedicated read-only backup role |
| Frequency | Daily, plus mandatory before every release that contains a migration |
| Storage | Off-host (e.g. OVH Object Storage), encrypted at rest, not writable from the app host's backup credentials after upload |
| Retention | 7 daily, 4 weekly, 3 monthly |
| Objectives | RPO ≤ 24 h, RTO ≤ 1 h |
| Verification | Restore drill into a scratch database monthly and after any schema change. `deploy/smoke-test.sh` exercises dump → delete → restore. |

Restore:

```sh
docker compose stop app
pg_restore -d "$OWNER_URL" --clean --if-exists --single-transaction tasks-<ts>.dump
docker compose run --rm migrate      # re-applies grants, verifies migration ledger
docker compose start app
```

The dump contains the Drizzle history (`drizzle.__drizzle_migrations`), so it always matches the
restored schema.

## 6. Rollback

Application code and database schema are versioned and rolled back separately.

**Application code (image).** Redeploy the previous image digest:
`APP_IMAGE=<previous digest> docker compose up -d`.
- The old `migrate` sees newer migrations and only warns about them; it never alters them.
- The old app becomes ready as long as its own migrations are present.
- This is safe because of the migration policy below.

**Database schema.** There are no down-migrations.
1. Preferred: a forward fix, i.e. a new migration.
2. If a migration damaged data: stop `app`, restore the pre-release backup (section 5), then deploy the previous image. Writes made after the backup are lost. Record this in the incident notes.

**First release.** There is no previous version to roll back to. Stop `app`, then remove or disable the Caddy site. The database can be kept for a retry.

**Migration policy** (keeps code rollback safe):
- Migrations are **expand-only** within a release. The previous release's code must keep working on the new schema.
- Dropping or renaming a column happens in a *later* release, once no deployed code uses it.
- Never edit an applied migration. The migrator refuses checksum mismatches.
- Each migration runs in its own transaction with `lock_timeout = 10s`. Concurrent migrators serialize on a PostgreSQL advisory lock.

## 7. First-release acceptance criteria

All must hold before announcing tasks.mytko.dev:

1. `TASKS_DISPOSABLE_APPROVED=yes TEST_IMAGE=<immutable-image> TEST_POSTGRES_IMAGE=<approved-postgres-17-digest> deploy/smoke-test.sh` passes against the exact image digest being released.
2. `docker compose ps`: `migrate` exited 0 and `app` is `healthy`.
3. `docker inspect` of `app` shows user `1000:1000`, `ReadonlyRootfs=true`, `CapDrop=[ALL]`, memory limit 256 MiB, and no port bound to anything other than `127.0.0.1`.
4. `curl -sI https://tasks.mytko.dev/` returns `200` (login screen) and `curl -s -o /dev/null -w '%{http_code}' https://tasks.mytko.dev/api/tasks` returns `401` without `WWW-Authenticate`, with a valid TLS certificate, and `Strict-Transport-Security` and `Content-Security-Policy` headers.
5. `curl -s https://tasks.mytko.dev/healthz` and, on the host, `curl -s http://127.0.0.1:3100/readyz` both return exactly `{"status":"ok"}`. `curl -s -o /dev/null -w '%{http_code}' https://tasks.mytko.dev/readyz` returns `404`.
6. In a browser at `https://tasks.mytko.dev` (desktop and phone):
   - Log in with the owner credentials.
   - Create a category and a task, edit the task, move it between Kanban columns (keyboard and drag), reload, then delete the task and the category.
   - The browser console shows no CSP violations or errors, and the page is fully styled (`/dist/style.css` returns 200).
7. A cross-site write is rejected: `curl -u owner:… -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: application/json' -d '{}' https://tasks.mytko.dev/api/tasks` returns `403`.
8. Eleven wrong-password attempts from one client IP produce `429`, and a request from a second client IP right afterwards still gets `401`, not `429` (proves `TRUST_PROXY` sees real client addresses).
9. `docker compose restart app` causes no data loss, and `docker compose stop app` exits with code 0.
10. In PostgreSQL:
    - `\dt` shows the tables owned by `tasks_owner`.
    - `tasks_app` cannot run `CREATE TABLE` or `DROP TABLE`.
    - `drizzle.__drizzle_migrations` holds one row per shipped migration (`0000_initial`, `0001_tasks_1_0`, `0002_auth_sessions`, `0003_long_term_plans`); the hashes match `backend/drizzle/*.sql`.
11. A first backup has been taken and successfully restored into a scratch database.
12. `app.env` and `migrate.env` are mode 600 on the server and absent from git; `node deploy/check-env.cjs deploy/app.env deploy/migrate.env` reports PASS. `git grep -i password` shows no real credentials.

## 8. Known limitations / follow-ups

- Rate limits and the auth cache are per process, so run exactly one `app` replica.
- The owner login has no MFA. If more than one user is needed, replace it with real accounts and per-user data (schema change).
- `cors` remains in `backend/package.json` but is no longer used. Remove it together with a lockfile regeneration (requires npm).
- Line endings in the repository are mixed (CRLF/LF). Consider adding `.gitattributes`.
- **Historical credential in Git.** Commit `e1510f2` (`todo-backend/db.js`, an ancestor of `main` and published to `origin`) contains a hardcoded PostgreSQL superuser password for `postgres@localhost`. A full-history scan (all local refs) found no other real credential: remaining matches are library code in the then-committed `node_modules`, per-run random test passwords, disposable test-stack fixtures and `CHANGE_ME` placeholders. Treat the historical password as compromised:
  - the owner rotates it on every PostgreSQL instance where it was ever used (decision and timing are the owner's; nothing here changes any password);
  - it must not exist on the OVH PostgreSQL for any role, and `tasks_owner` / `tasks_app` get new random passwords;
  - check that no server exposes PostgreSQL with that login (`listen_addresses`, firewall, `pg_hba.conf`).

  Rewriting history is optional and owner-approved only, because it requires a force push. Rotation is what actually removes the risk.
