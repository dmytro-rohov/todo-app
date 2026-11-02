# TASKS-LITE-04 — PARTIAL / source checkpoint

2026-11-02. Branch mytko/implementacja-96f75bff; HEAD
 e8deeda514d76cf9f731a62cf927e4ce6d5f12b4; upstream origin/main.
Incoming Lite-01/02 and Workflow integration plan preserved. No commit/new SHA.
No files in Full retention/archive/attachments/migrations edited in this Run.
Full worktree exists but was not accessed. Formal per-file ownership map is NOT
available, so ownership is not asserted beyond avoiding those modules.

## START GATE limitations

GitHub connector get_repo returned 404: no live main verification possible via
that approved connection. No credential/SSH workaround or fetch/sync performed.
Mytko context reports historical Validate failed, completed 2026-10-31 14:58 UTC,
applicability historical_only. Metadata itself marks matches_last_observed_head
false; do not reinterpret this as current pipeline evidence. Logs/reason/config
were not exposed. No repository-owned pipeline file found by filename inspection.
Trusted operator must inspect actual Validate configuration and rerun it after
reviewed commit. Local npm tests do not replace trusted Validate.

## Current Lite manifest and acceptance

Kanban/task CRUD/status/priority/deadline/filter/ordering/auth: implementation exists;
local unit/fake-HTTP regressions PASS, real persisted/browser acceptance BLOCKED.
Categories GET/POST/PUT/DELETE: HTTP and action/renderer tests PASS; duplicate names
allowed; 400/401/403/404 per contract; 409 tested as generic frontend failure.
Used-category FK clearing has real integration test, execution BLOCKED.
Full archive/files/cleanup/AI/calendar excluded; no automatic retention scheduled.
003 archived_at remains reserved; future Full changes must be additive and tested.

Executed this Run: both npm ci PASS; frontend 40 PASS / 0 FAIL / 0 SKIP;
backend 128 PASS / 0 FAIL; PostgreSQL suite SKIPPED (runner reports zero individual
skipped tests); Sass PASS; both audits zero vulnerabilities; smoke Bash and E2E
Node syntax PASS; git diff --check PASS. Backend includes rendered Compose and
health/deployment contracts without daemon. Optional watcher script warning only.
No PostgreSQL, Docker build, backup restore or browser PASS.

Added e2e/lite-acceptance.cjs: production desktop/mobile UI category create/edit/
delete, task create/delete/category label, keyboard cross-column persistence,
injected 409 with retained state/no move, mouse Pointer Events, overflow/console.
This script is syntax-checked only. Playwright and approved live stack required;
real touch, offline, focus and same-column permutations remain acceptance work.
Do not call this a completed browser acceptance. New endpoint/UI tests from
Lite-02 already provide local request deduplication and error coverage.

## One active disposable operator procedure

For Lite, docs/VALIDATION.md top current procedure is authoritative; older
historical sections and checkpoint snippets are not alternative release commands.
Use reviewed clean Session commit; no base SHA substituted for dirty candidate.
Approved Fujitsu disposable runner: Node24/npm, Docker/Compose/Buildx, curl/ss,
unused 3101/55432, official Node24 and postgres:17-alpine digests supplied through
NODE_IMAGE and TEST_POSTGRES_IMAGE. Follow exact current checklist to install,
build once, capture image ID/revision/provenance, then run:

```bash
TASKS_DISPOSABLE_APPROVED=yes TEST_IMAGE="${TEST_IMAGE:?frozen image ID}" \
TEST_POSTGRES_IMAGE="${TEST_POSTGRES_IMAGE:?approved postgres17 digest}" \
bash deploy/smoke-test.sh
```

Smoke uses current DB env names and exact preloaded image, project-only DB/roles/
network/volume; never connect it to DEV. Integration tests DROP test tables. It
checks 001–003 migrations/backfill, ordering/domain and restart/backup restore
according to existing scripts, but verify test output rather than assume coverage.
Real concurrency must be evidenced by PostgreSQL tests, not fake-client PASS.
Save source/image digests and full logs. No production database operations.

Browser runner needs Playwright/Chromium + separately managed approved disposable
stack (smoke removes its stack on exit), then:

```bash
TASKS_DISPOSABLE_APPROVED=yes E2E_BASE=http://127.0.0.1:3101 node e2e/lite-acceptance.cjs
```

## Release freeze and OVH STOP/GO

Existing deploy/app.env.example and migrate.env.example are placeholder templates;
no filled env read. DATABASE_URL app DML, MIGRATION_DATABASE_URL owner only;
TASKS_ENV prod/dev/test accepted by shared loader. Host gateway example is not an
approved OVH DB target. Operator must bind exact private PostgreSQL17 endpoint,
review TLS/CA and TRUST_PROXY, validate no cross-project grants and disable public
DB exposure. Production app cannot depend on Fujitsu/Workflow availability.
Caddy example requires review/TLS acceptance, no live Caddy changes authorized.
Read-only/non-root image, CPU/RAM/pids, health/readiness/graceful shutdown and
backup restore gates retained. Do not deploy until remote main/ownership/Validate,
PG smoke, browser, independent security review and restore evidence all accepted.
App rollback requires schema compatibility; no blind down SQL. Full upgrade needs
separate additive migration/review, DB/files backup and explicit cleanup approval.

Proposed commit: TASKS-LITE: freeze category regression and acceptance candidate
PR: include Lite-01/02 configuration/category diffs plus current E2E/checkpoints;
request Audit & Foundation independent review, then trusted pipeline. Commit only
with separate approval. No commit/push/PR/merge/deploy/Fast Track performed.
Overall PARTIAL: more remains than just OVH release approval.
