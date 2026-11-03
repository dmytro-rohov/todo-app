# TASKS-LITE-RELEASE-01 — MVP Lite release to https://tasks.mytko.dev

Status of the release candidate is recorded in the PR review; this file is the
operator contract. Nothing here deploys, pushes, merges or changes DNS/OVH.

## What is released

| Item | Value |
|---|---|
| Accepted application | `1b93f7c228cacc569915f00a3b1258da68cc0926` (full local acceptance PASS, evidence `/home/dima/mytko-artifacts/tasks/lite-acceptance-pass`) |
| Release candidate | the commit on `mytko/implementacja-96f75bff` that contains this file (descendant of `1b93f7c`) |
| Delta vs `1b93f7c` | `acceptance/` package, `deploy/` templates and `check-env.cjs`, docs, `backend/test/release-config.test.js` |
| Image inputs | byte-identical to `1b93f7c` (proof below) — the release image has the same content as the accepted image; only the `org.opencontainers.image.revision` label differs |
| Domain | `https://tasks.mytko.dev` (not `task.mytko.dev`) |

Proof that the image content equals the accepted one (must print nothing):

```sh
git diff --stat 1b93f7c <release-sha> -- backend/package.json backend/package-lock.json \
  ':(glob)backend/*.js' backend/routes backend/migrations backend/scripts \
  frontend/package.json frontend/package-lock.json frontend/index.html frontend/js frontend/styles
```

`.dockerignore` is an allowlist of exactly these paths; `deploy/`, `docs/`,
tests and env files never enter the image.

## Security fixes from `f4cbe97` (Audit & Foundation)

All present in `1b93f7c`; nothing backported and the Audit branch is not merged:
`inflate: false` + 415 for compressed bodies, production `TRUST_PROXY` peer
validation, canonical client address for rate limit and login lockout,
dependency overrides `proxy-addr 2.0.8`, `body-parser 2.4.0`, `qs 6.16.2`
(locked), `brace-expansion 5.0.12` (override kept; package no longer in the tree
after `nodemon` removal), regression tests and conservative `TRUST_PROXY`
templates.

## Historical PostgreSQL credential

Full-history scan of all local refs: the only real credential is the
`postgres@localhost` superuser password in `e1510f2` (`todo-backend/db.js`),
reachable from `origin/main`. Other matches are library code in the then-committed
`node_modules`, per-run random test passwords, disposable test fixtures and
placeholders. No password was printed, used or changed. Owner decisions and the
production rules are in [PRODUCTION.md §8](PRODUCTION.md#8-known-limitations--follow-ups);
`deploy/check-env.cjs` rejects `postgres` as app or migration role.

## Pipeline

Existing flow only: Mytko validate → independent review of the PR → Mytko
deploy. Trusted `check` runs `npm --prefix frontend test`, `npm --prefix backend
test` (includes `release-config.test.js`) and both audits. The audits need the npm
registry; a DNS failure (`EAI_AGAIN`) is an executor environment fault, not a
release failure, and must be fixed in the executor, not by skipping the audit.
Backend tests that call the app on `127.0.0.1` need `NO_PROXY=127.0.0.1,localhost,::1`
when the executor sets `NODE_USE_ENV_PROXY`.

## Operator steps (in order, each requires operator authority)

1. Supply the verified Browser QA runner (`tasks-lite-qa-tools/browser/run.cjs`,
   mobile drag-and-drop fix) to this Session; it is committed into
   `acceptance/lite-1b93f7c/browser/run.cjs` with a regression test. Until then the
   package runner differs from the one that produced Browser QA 20/20.
2. Mytko validate on the release SHA; independent review of the PR (code is
   unchanged from `1b93f7c`, review the delta listed above).
3. Approve merge; Mytko builds the image from the release SHA with
   `NODE_IMAGE` from `acceptance/lite-1b93f7c/images.env` (`docker.io/library/node@sha256:a43f7fc3…`, the digest used by acceptance)
   and `GIT_REVISION=<release-sha>`, records the digest.
4. OVH, outside the pipeline: PostgreSQL 17 with `deploy/db-roles.sql.example`
   (new random passwords ≥ 24 chars per role, from the secret store); confirm the
   historical `postgres` password does not exist there; no public PostgreSQL port.
5. On the server: `app.env` / `migrate.env` from the examples (`chmod 600`),
   `TRUST_PROXY=loopback,<bridge gateway>/32` per PRODUCTION.md §3.5, then
   `node deploy/check-env.cjs deploy/app.env deploy/migrate.env` → PASS.
6. Backup set up and one restore drill into a scratch DB (PRODUCTION.md §5).
7. DNS `tasks.mytko.dev` → OVH host; Caddy site from `deploy/Caddyfile.example`.
8. Mytko deploy with `APP_IMAGE=<registry>/mytko-tasks@sha256:<digest>`; then all
   12 first-release acceptance criteria in PRODUCTION.md §7.

Rollback for the first release: stop `app`, remove the Caddy site; keep the DB.
