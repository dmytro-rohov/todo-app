# Lite10 — PARTIAL, not approved for full operator execution yet

Candidate 1b93f7c unchanged (verify.py still checks original manifest). All changes
confined to untracked acceptance/ package; no Full worktree accessed. No commit.

Main remains acceptance.sh. It now calls package-owned smoke.sh and labeled
compose.test.yaml rather than candidate's old restore-in-source script. Exact
candidate image/code remains unchanged; external test fixtures overlay test folder.
Separate initdb creates tasks_restore_owner/tasks_restore_test, PUBLIC revoked.
Restore never targets source. Schema dump, canonical task/category/ledger JSON,
checksums, source unchanged and corrupt archive refusal are checked. Tools require
major17. Test-only credentials are constants, not production secrets. Random per-run
credentials and improved secret-scoped environment remain hardening work.

transaction.test.js adds bounded real mid-move controlled SQL exception with
snapshot rollback assertion: first row update succeeds, second fails. Runs only in
private db/tasks_test via explicit runner injection. Existing candidate concurrent
HTTP move tests retained. Opposite-direction matrix, explicit lock timeout/deadlock
SQLSTATE probes and post-corrupt-backup data recheck still need completion.
No claim all transaction/concurrency requirements are met.

Local actual: 3 package tests PASS; 52 frontend PASS; 128 backend PASS; both npm ci,
Sass/audits/syntax/diff checks PASS, zero vulnerabilities. PostgreSQL suite SKIP.
Real Docker/PG/browser BLOCKED by no authorized runner; no daemon calls performed.
Historical local validation log remains labeled old evidence; this Run log is
.npm-cache/lite10.log. Test package approval refusal runs without touching Docker.

Existing RUNBOOK is historical where it references old restore behavior; current
main script now selects this package smoke. Operator must review these changed
fixtures and approve package independently. Still outstanding before READY FOR
OPERATOR PREFLIGHT: comprehensive concurrency/deadlock/timeout tests, robust
preflight for every mutable operation and ownership-verified cleanup, pinned
browser project/lockfile and full browser matrix. No new production authority.

Use separate clean SOURCE_DIR at candidate SHA, approved local disposable Docker
runner, real official platform-approved image digests, TASKS_DISPOSABLE_APPROVED
and ALLOW_IMAGE_FETCH gates. No ORHEA/MOTO/DEV targets, no host socket to sandbox.
No release/migration/restore authorization implied. Proposal after completion:
TASKS-LITE: harden disposable acceptance and independent restore.
