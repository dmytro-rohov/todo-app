# TASKS-LITE-02 — source candidate / READY FOR COMMIT

Base HEAD e8deeda514d76cf9f731a62cf927e4ce6d5f12b4, branch
mytko/implementacja-96f75bff, upstream origin/main. Incoming Lite-01 and Workflow
plan retained. No release SHA until authorized commit; source is currently dirty.
No new migrations: 001_baseline, 002_task_integrity, 003_kanban preserved.

Lite: task/category CRUD, three statuses, priority P0–P3, optional due date,
filters/search, pointer/keyboard ordering, authenticated same-origin responsive
board. Full attachments/archive/cleanup remain disabled/not wired. archived_at
and pure policy reserved for later additive upgrade; no automatic deletion.

## Contract and actual evidence

Category duplicate names are allowed (existing nonunique schema); POST returns
201, PUT/GET/DELETE 200; invalid IDs/payloads 400, absent ID 404, anonymous 401,
cross-site mutation 403. 409 is not used for duplicate category names. API 409
errors are still presented by frontend without retry/refresh. Deleting a used
category retains tasks via ON DELETE SET NULL; existing real integration test
asserts this but was NOT executed. Do not substitute fake rows for FK evidence.
HTTP test runs actual Express/router/security with in-memory SQL stand-in. Frontend
tests execute category action/renderer functions used by board, not browser DOM.
Each successful mutation refreshes tasks/categories once. Error paths do not
refresh, busy guard suppresses repeated requests, escaped rows resist HTML/ID XSS.
Manual browser acceptance for the integrated controls remains required.

Shared DB config separates runtime/owner URL, validates protocol/host/database,
TASKS_ENV, TLS mode options, duplicate/unknown URL parameters and bounded settings.
Test environment rejects non-local/non-test names, which is a guard, NOT approval:
only operator allocation authorizes a DB. TLS mode acceptance tests are parser
checks, not proof of encrypted authenticated transport. require is not equivalent
to CA/hostname validation. Production TLS/private network must be reviewed. No
Broker API guessed; approved launcher can inject config later. Runtime pg Pool
may still inherit libpq environment settings: operator environment must be scoped.

Executed this Run: both npm ci PASS, Sass PASS, frontend 40 PASS / 0 FAIL,
backend 128 PASS / 0 FAIL, npm audit both zero vulnerabilities. Syntax checks of
new/changed runtime modules and diff check PASS. Optional watcher install script
warning did not block build and no scripts were approved. PostgreSQL integration
suite SKIPPED (no authorized URLs); Docker/browser acceptance BLOCKED.

## Exact operator acceptance procedure

Use the reviewed candidate on approved disposable Fujitsu runner, never production
or populated DEV. Follow the current top procedure in docs/VALIDATION.md; historical
sections are not active. Requires Node24, npm, Docker/Compose/Buildx, curl, ss,
unused ports 3101/55432 and project-only network/volume. Provide trusted official
Node24 and PostgreSQL17 digests; do not invent SHA values:

```bash
set -euo pipefail
: "${EXPECTED_SOURCE_SHA:?full eventual reviewed Lite commit}"
: "${NODE_IMAGE:?node:24-bookworm-slim@sha256 approved digest}"
: "${TEST_POSTGRES_IMAGE:?postgres:17-alpine@sha256 approved digest}"
[[ $(git rev-parse HEAD) == "$EXPECTED_SOURCE_SHA" ]]
[[ -z $(git status --porcelain) ]]
export SOURCE_SHA="$EXPECTED_SOURCE_SHA" TEST_POSTGRES_IMAGE
[[ "$NODE_IMAGE" =~ ^node:24-bookworm-slim@sha256:[a-f0-9]{64}$ ]]
[[ "$TEST_POSTGRES_IMAGE" =~ ^postgres:17-alpine@sha256:[a-f0-9]{64}$ ]]
docker pull "$TEST_POSTGRES_IMAGE"
docker buildx build --load --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --build-arg GIT_REVISION="$SOURCE_SHA" -t "mytko-tasks:lite-$SOURCE_SHA" .
export TEST_IMAGE
TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "mytko-tasks:lite-$SOURCE_SHA")
TASKS_DISPOSABLE_APPROVED=yes bash deploy/smoke-test.sh
```

Record source/image/base provenance and preserve smoke logs using EVIDENCE_DIR per
current checklist. Smoke starts unique project, migrates, runs destructive tests
only inside disposable DB, verifies restart/backup restore and cleans its own
volume. Browser E2E needs separately managed approved stack + Playwright as in
release-readiness. Explicitly accept category create/edit/delete/duplicate names,
400/401/403/404, used-category deletion, refresh and no double writes. No Full gate.

## PR proposal and commit scope

Title: TASKS-LITE: shared database configuration and category CRUD regressions
Problem: Lite category edit lacked endpoint/UI regression coverage and runtime/
migrator configured DB independently. Change: shared fail-closed DB config,
category update + management controls, serialized mutations/refresh and HTTP/unit
regressions. Validation: local results above; real DB/container/browser pending.
Include all Lite-01/02 files plus preserved Workflow plan; review diff against base.
No lockfile changes, no SQL changes, no Full enablement. Commit requires separate
operator approval per AGENTS.md. No commit/PR/push/merge/deploy/Fast Track performed.
