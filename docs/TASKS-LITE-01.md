# TASKS-LITE-01 — PARTIAL candidate

Base e8deeda514d76cf9f731a62cf927e4ce6d5f12b4; branch
mytko/implementacja-96f75bff, upstream origin/main. Incoming untracked
WORKFLOW-INTEGRATION-PLAN.md preserved. Live remote main not independently verified
in this Run; cached refs are not evidence of GitHub freshness. Operator must verify
main SHA in trusted GitHub UI before PR. No synchronization performed.

Lite manifest: three-column Kanban, task/category CRUD, P0–P3, optional deadline,
manual pointer/keyboard ordering, PostgreSQL, single-owner Basic/HTTPS, responsive
UI. Full deferred: attachments/archive/retention executor/Calendar/AI. Retention
policy module is unused, no cleanup scheduled, no upload routes. Existing archived_at
column remains for later additive Full migration; do not delete historical tasks.

Changes: shared database-config.js used by server/config/migrator, separate app
and migration URL, URL scheme/target validation, bounded pool/timeouts, TASKS_ENV
(dev/test/prod), explicit application name. Accepts sslmode disable/require/
verify-ca/verify-full; no production certificate validation is implied by require.
Operator must select private network/TLS CA policy; cross-host access needs verified
TLS configuration and tests before GO. Runtime URL and owner role stay separate.
No Broker API dependency; future approved launcher injects config. No provisioning.
Added PUT category API + board create/edit/delete controls. Dedicated UI/HTTP tests
for this newly added category flow remain required before acceptance.

Current checks: both npm ci PASS, Sass PASS, frontend 32 PASS, backend 124 PASS,
both audits zero vulnerabilities, diff check PASS. Real PostgreSQL skipped.
Existing tests cover migration ledger and fake-client ordering, not real parallel
transactions/backfill. Existing smoke deploy/smoke-test.sh + release-smoke.js and
E2E e2e/acceptance.cjs remain operator acceptance artifacts, not executed evidence.

Fujitsu: approve project-only disposable PostgreSQL 17 + app/owner roles, unused
3101/55432 ports, isolated runner and approved immutable images. Use current
procedure in docs/VALIDATION.md after reviewed source commit; save source SHA,
image digest, smoke/restore logs. Supply Playwright/browser for desktop/mobile,
category/task CRUD, pointer/keyboard/reload/409/offline acceptance. No tests that
DROP tables on DEV. Existing DEV data migration needs separate approval/backup.

OVH: dedicated Tasks DB/roles, private network, secret bindings, immutable Node24
image, reviewed Caddy for task.mytko.dev, loopback app, CPU/RAM/PIDs and storage
monitoring. Existing deploy/*.env.example/compose.yaml/Caddyfile.example are review
artifacts, not applied configuration. Verify DB endpoint/TLS and TRUST_PROXY;
production must have no Fujitsu/Workflow runtime dependency. Encrypted off-host
backup + restore drill required. Migration 001–003 only, checksums immutable;
rollback via approved old image compatibility or reviewed restore, no blind down
migration. Remote Deploy Executor readiness is not assumed.

DONE locally: config foundation, existing security/unit regressions/build.
PARTIAL: full Lite UI/API and category tests, URL/TLS edge validation.
BLOCKED: live main verification, real DB/container/browser/security/restore acceptance.
No release SHA assigned: candidate is dirty and uncommitted. Do not use base SHA
as a release SHA. Operator approval needed before commit per AGENTS.md.
Proposed commit: TASKS-LITE-01: isolate Lite scope and unify database configuration
Proposed PR: Stabilize Lite configuration and category CRUD; include local evidence,
DB/browser blockers and request Audit & Foundation review before merge.
No commit, PR, push, merge, deploy or Fast Track performed. Status PARTIAL.
