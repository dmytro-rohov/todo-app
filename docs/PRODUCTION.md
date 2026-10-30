# Mytko Tasks — production runbook (task.mytko.dev)

This document is the contract between the application and the operator /
Mytko release pipeline. Nothing in this repository deploys, creates
databases, sets DNS, changes Caddy or handles real secrets; every step marked
**operator** is performed outside the codebase.

## 1. Architecture

```
browser ──HTTPS──> Caddy (host, TLS for task.mytko.dev)
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
| Authentication | HTTP Basic auth for the single owner (`AUTH_USERNAME`, scrypt `AUTH_PASSWORD_HASH`). Covers the app shell, static assets and API. Production refuses to start without it. |
| Authorization | Single-tenant: there is no user model, so all data belongs to the one authenticated owner. Multi-user support would need a schema change (`owner_id`) and is out of scope. |
| Sessions | Stateless: the browser re-sends Basic credentials. No cookies, so there is no session fixation and no cookie theft. To log out, close the browser. Credentials are cached in memory only as an HMAC digest for 10 minutes, to avoid running scrypt on every request. |
| CSRF | Unsafe methods require `Sec-Fetch-Site: same-origin`. When fetch metadata is absent, a present `Origin` must equal `PUBLIC_ORIGIN`. Bodies must be `application/json`. There is no CORS. |
| XSS | Frontend escapes all user data inserted with `innerHTML`. Colours must be `#rrggbb` both server-side and client-side. A strict CSP is set (`script-src 'self'; style-src 'self'`, no inline). |
| Rate limits | 300 req/min per IP. After 10 failed logins, an IP is locked out for 15 minutes; the lockout is checked before scrypt runs. Limits are in memory, so they are valid for one replica only. |
| Validation | Types, lengths, real calendar dates, ids ≤ int4. Unknown category → 400. The JSON body limit is 10 kB. |
| Headers | CSP, HSTS (production), nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP, Permissions-Policy. `X-Powered-By` is removed. |
| Errors | A central handler returns only generic messages. Database errors are logged by code only. |
| Health | `/healthz` (liveness) and `/readyz` (DB reachable + all shipped migrations applied) return only `{"status":"ok"|"unavailable"}`. |
| Container | Non-root uid 1000. The app tree is root-owned and read-only. Read-only rootfs, `/tmp` tmpfs (noexec), `cap_drop: ALL`, `no-new-privileges`, no npm/yarn at runtime. Limits: 0.5 CPU / 256 MB / 128 pids. |
| DB privileges | The app role has SELECT/INSERT/UPDATE/DELETE on `tasks` and `categories`, sequence usage, and SELECT on `schema_migrations`. It has no DDL, TRUNCATE or ownership. |

## 3. Operator prerequisites (before first release)

1. **Lockfile for the SCSS build.** With Node 24 run `cd frontend && npm install` and commit `frontend/package-lock.json`. The Dockerfile uses `npm ci` and refuses to build without it.
2. **Pin the base image.** Build with `--build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest>` and record the digest.
3. **Build and publish** the image from the reviewed commit, tagged by its git SHA (`--build-arg GIT_REVISION=<sha>`). Use the digest in `APP_IMAGE`.
4. **PostgreSQL**, version ≥ 15 recommended:
   - Create `tasks_owner`, `tasks_app` and the `tasks` database, following `deploy/db-roles.sql.example`. Use passwords from the secret store.
   - Make the database reachable from the Docker bridge. When PostgreSQL runs on the host, `pg_hba.conf` and `listen_addresses` must allow the bridge subnet.
   - Use `sslmode=require` if traffic leaves the host.
5. **Secrets.** Create `deploy/app.env` and `deploy/migrate.env` from the `*.example` files on the server only, with `chmod 600`.
   - Generate the hash with `printf '%s' "$PASSWORD" | docker run --rm -i "$APP_IMAGE" node backend/scripts/hash-password.js`. The password must be at least 12 characters.
   - Escape any `$` in DB passwords inside env files as `$$`, or avoid `$` in them.
6. **Backups** are configured and one restore has been tested (section 5) before real data is entered.
7. **DNS.** `task.mytko.dev` A/AAAA records point to the OVH host.
8. **Caddy.** Add a site block equivalent to `deploy/Caddyfile.example` and reload Caddy. Caddy must reach `127.0.0.1:3100`.
9. **Smoke test.** `deploy/smoke-test.sh` passes on the build host (Docker + Compose v2 + curl).

## 4. Release procedure (operator)

```sh
cd deploy
export APP_IMAGE=<registry>/mytko-tasks@sha256:<digest>
# 1. pre-release backup (skip only for the very first release on an empty DB)
pg_dump -Fc -d "$OWNER_URL" -f "tasks-$(date -u +%Y%m%dT%H%M%SZ)-pre-$SHA.dump"
# 2. migrate, then start app (compose orders them; app waits for migrate)
docker compose up -d
# 3. verify
docker compose ps                       # app healthy, migrate exited 0
curl -fsS https://task.mytko.dev/healthz
curl -fsS https://task.mytko.dev/readyz
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

The dump contains `schema_migrations`, so the ledger always matches the
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

All must hold before announcing task.mytko.dev:

1. `deploy/smoke-test.sh` passes against the exact image digest being released.
2. `docker compose ps`: `migrate` exited 0 and `app` is `healthy`.
3. `docker inspect` of `app` shows user `1000:1000`, `ReadonlyRootfs=true`, `CapDrop=[ALL]`, memory limit 256 MiB, and no port bound to anything other than `127.0.0.1`.
4. `curl -sI https://task.mytko.dev/` returns `401` with `WWW-Authenticate: Basic`, a valid TLS certificate, and `Strict-Transport-Security` and `Content-Security-Policy` headers.
5. `curl -s https://task.mytko.dev/healthz` and `/readyz` both return exactly `{"status":"ok"}`.
6. In a browser:
   - Log in with the owner credentials.
   - Create a category and a task, toggle it, delete it, and use "Wyczyść wszystko".
   - The browser console shows no CSP violations, and the page is fully styled (`/dist/style.css` returns 200).
7. A cross-site write is rejected: `curl -u owner:… -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: application/json' -d '{}' https://task.mytko.dev/api/tasks` returns `403`.
8. Eleven wrong-password attempts from one IP produce `429`.
9. `docker compose restart app` causes no data loss, and `docker compose stop app` exits with code 0.
10. In PostgreSQL:
    - `\dt` shows the tables owned by `tasks_owner`.
    - `tasks_app` cannot run `CREATE TABLE` or `DROP TABLE`.
    - `schema_migrations` lists `001_baseline` and `002_task_integrity`.
11. A first backup has been taken and successfully restored into a scratch database.
12. `app.env` and `migrate.env` are mode 600 on the server and absent from git. `git grep -i password` shows no real credentials.

## 8. Known limitations / follow-ups

- Rate limits and the auth cache are per process, so run exactly one `app` replica.
- Basic auth has no logout or MFA. If more than one user is needed, replace it with real accounts and per-user data (schema change).
- `cors` remains in `backend/package.json` but is no longer used. Remove it together with a lockfile regeneration (requires npm).
- Line endings in the repository are mixed (CRLF/LF). Consider adding `.gitattributes`.
