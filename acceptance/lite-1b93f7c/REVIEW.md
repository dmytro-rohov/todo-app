# Lite07 review handoff — 2026-11-02
Source 1b93f7c228cacc569915f00a3b1258da68cc0926, parent d111d011.
PR proposal: Bound HTTP requests and report failed board refresh accurately.
Diff: git diff d111d011..1b93f7c (8 files). Source manifest supplied separately.
Local checks: frontend52/backend128 PASS, zero failures, CI/audits/build PASS.
SKIP: PostgreSQL integration suite, no authorized URLs.
BLOCKED: trusted Validate, PG/Docker, browser, real backup restore, independent security.
No known local test failure; historical Validate failure is NOT classified as an
npm infrastructure failure without its logs. Production executor registry fix unknown.
P0 acceptance gates: real disposable smoke + browser/security/restore evidence.
P1: explicit induced PG mid-write rollback/deadlock/connection-break acceptance
must be demonstrated beyond existing fake-client and concurrent-move tests.

Operator: first ensure trusted npm registry executor patch is actually deployed,
then use Mytko trusted Validate on exact SHA including npm audit (no ignore-failure).
Agent contract forbids invoking trusted integration action here. Inspect logs and
separate test assertion failure from registry/network/tooling failure.

Use acceptance.sh only in approved isolated disposable runner. Does not deploy.
All image digests must be approved by operator; no digest invented. Existing smoke
removes its own unique project volume, never use on existing DEV/other-project DB.
Preserve source/image/build/smoke logs. No database target override allowed.

Browser: existing e2e/lite-acceptance.cjs, operator-installed Playwright/Chromium,
approved separate disposable app stack on 127.0.0.1:3101 (smoke tears its stack down).
TASKS_DISPOSABLE_APPROVED=yes E2E_BASE=http://127.0.0.1:3101 node e2e/lite-acceptance.cjs
Manual additions before GO: actual touch, focus, offline/timeout recovery, negative
Basic challenge and CSRF, CSP console, same-column order and reload. No PASS assumed.

OVH: reviewed existing deploy/compose.yaml and Caddyfile.example, independent private
PostgreSQL17/volume and DML app/owner roles, runtime secrets, exact app digest,
TLS/proxy/limits/backup. No Fujitsu dependency. Take and restore-test backup before
migration. N-1 image compatibility rehearsal or approved restore with write-loss
assessment; no automatic reverse SQL. Post-deploy health/TLS/auth/read/write checks
only after explicit release authorization. Pipeline review/merge/release owned by
Mytko; no Fast Track. This package is local evidence, not trusted approval.
