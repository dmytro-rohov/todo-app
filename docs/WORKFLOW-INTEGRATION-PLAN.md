# Mytko Tasks × Workflow — assessment and implementation prompt

Assessment 2026-11-02. Source e8deeda514d76cf9f731a62cf927e4ce6d5f12b4,
Session Implementacja, clean worktree before this document. Existing readiness
reports reference older commits and are historical, not current source inventory.
No standalone roadmap found; checkpoint documents and release-readiness form the
current plan. No database or production connection was made.

## Verified foundations

Express 5, pg 8, Node 24, native frontend ES modules/SCSS. config.js reads runtime
env; db.js alone constructs Pool; server and migrator inject configuration; routers
receive pool. Preserve those boundaries, no ORM or alternate backend. Existing
migrations: 001_baseline, 002_task_integrity, 003_kanban. Ledger/checksums,
advisory migration lock, per-migration transactions and separate owner URL exist.
Repeatability belongs to the ledger: 003 is not a standalone repeatable SQL file.
Rollback is forward repair or approved tested restore, not automatic down SQL.

Current Run: build PASS; frontend 32 PASS, backend 122 PASS, no failures.
PostgreSQL suite skipped for missing approved TEST_* URLs. No browser, Docker,
real PostgreSQL or recovery acceptance inferred. Attachments/archive/job remain
incomplete and outside the reprioritized lightweight MVP. Existing retention
function alone does not provide retention service.

## Minimal configuration boundary (design, not implemented here)

Retain environment delivery as baseline. Add a shared DB config loader used by
server and migrator; accept an explicit env argument for tests. Application code
continues to receive Pool, never a Broker client. Validate postgres/postgresql URLs,
required DB identity, integer limits with bounds, dev/prod environment, TLS policy
and application_name without echoing credentials. No hardcoded targets/fallback DB.
Separate project ID `todo-mytko-tasks`, deployment environment and NODE_ENV
(production Node optimization can also be used in DEV container). Identity labels
are observability/configuration, not authorization evidence.

Broker adaptation point: trusted launcher obtains approved scope, materializes
runtime connection configuration/secret, starts app. URL-shaped contract is the
existing app boundary, not a proposed Broker HTTP API. Do not create guessed Broker
endpoints or auto-fetch tokens. Future lease renewal/revocation requires a formally
reviewed adapter and pool draining/reconnect policy; env injection alone cannot
refresh an existing pool. Startup must fail closed on invalid config, not fall
back to another environment. Local approved DEV config works without Workflow.
Remote Docker only monitors metadata. Resource provisioning and Deploy Executor
are separate trusted responsibilities, never app runtime dependencies.

## DEV approval gate

No authorized allocation returned by same-project context search. Thus cannot
confirm any existing Fujitsu DB is usable. Operator must identify PostgreSQL 17
instance, host/port/TLS, dedicated tasks_dev DB, schema owner tasks_dev_owner,
DML-only tasks_dev_app, public-schema grants and pg_hba/network restrictions.
Names are proposed, not existing resources. Verify no grants/membership/network
access into ORHEA/MOTO or other project DBs, including PUBLIC CONNECT defaults.
Separate disposable tasks_test DB/roles required for tests that DROP tables.
Do not point those tests at DEV data. Read-only identity inspection (current_database,
current_user, version, role/grant metadata) precedes writes on an approved target.
Provisioning approval is separate from permission to migrate existing data.
Approved manual local env delivery may precede Broker availability; never bypass
an applicable Broker policy. No existing DB probing or role creation in this Run.

## Ordered next work

1. Stabilize shared DB config and DEV/PROD templates, bounds/TLS/redaction tests.
2. Finish MVP contracts/UI/categories/forms/ordering errors, preserve migration data.
3. Prepare real migration/backfill/CRUD/filter/concurrency tests in disposable DB;
   run only with approved target. Continue fake-pool/unit/build work meanwhile.
4. Approve DEV resources and run non-destructive DEV migration with backup/review;
   run destructive integration only on separate test DB. Browser acceptance.
5. Independent Audit & Foundation review; operator-approved commit; Mytko PR/review
   and merge. A new branch/worktree must be assigned by Mytko, never agent-created.
6. Broker formal acceptance: authorization/identity/expiry/rotation/revocation/
   observability tests. Then configuration adapter, no business-logic redesign.
7. OVH resource approval, immutable artifact, restore/security/browser acceptance,
   Validate → Deploy → Rollback → Ship via trusted pipeline only.

Future Calendar multi-source mapping and AI proposal approval are deferred.
No automatic AI/calendar writes to task board; design later with proposal audit.

## Ready-to-use prompt — existing Implementacja Session / Codex

Implement MYTKO-TASKS-MVP-CONFIG-01: stabilize lightweight Kanban and prepare the
DB configuration boundary for Workflow without requiring Broker availability.

START GATE: read AGENTS.md, pwd/root/branch/HEAD/upstream/status/worktrees. Work
only current Mytko Session branch; preserve incoming edits. Expected assessment
base e8deeda, verify actual current source rather than resetting. No new Session,
branch switching/creation, merge/rebase/cherry-pick/push/deploy or production access.
If Mytko assigned a new stage branch, use it; otherwise stay current and report.

A. Inspect config.js, db.js, server.js, migrate.js, migrations.js, all migrations,
routers, security and board. Keep Express/pg, injection and native ES modules.
Create one shared DB configuration loader used by runtime and migration entrypoint.
Separate app/migrator credentials. Preserve current env compatibility; no actual
secret reads. Add project/environment identity, bounded numeric settings, URL and
TLS validation/redaction. Do not invent Broker API. Document env-based injection
as current adapter point and future lease refresh/revocation requirements. Verify
DEV startup does not contact Workflow; absent/invalid config fails clearly.

B. Complete MVP consistency: same field naming and title limits across create,
PUT/PATCH/GET/UI; optional deadlines, three statuses, P0–P3, category selection and
light category management; explicit ordering independent of priority. Preserve old
records/IDs. Verify completedAt/reopen semantics and migration defaults. Improve
new board form tests (single POST, validation and API errors), ordering busy/error
handling, focus/touch behavior. Do not add attachments/archive/retention executor,
Google Calendar/AI, multi-tenancy or a new auth system in this stage.

C. Extend tests for migration/backfill/trigger/CRUD/filter/due-date/roles/parallel
moves using approved disposable test DB only. Existing integration drops tables:
never run it on DEV or unidentified data. If not approved, prepare tests and label
DB execution BLOCKED; finish every independent code/build/test task. No Docker
socket workaround, global installs, role/container creation or infrastructure
changes. Provide exact operator approval/identity checks and separate DEV/test
provisioning requirements. Broker unavailability alone is not a development block.

D. Update AGENTS/README and current roadmap to real current architecture (old
http helper/readiness paths instructions may be stale). Safe DEV/PROD templates
only; deployment config separate from app. Explain non-destructive migrations,
checksum immutability, backup, forward repair/approved restore and app rollback
compatibility. Include Database Broker/Remote Docker/Deploy Executor boundaries.

E. npm ci backend/frontend with allowed worktree cache; build; full frontend and
backend regression; audits; diff check. Remove TEST_* URLs for local fake-pool run;
use loopback NO_PROXY where required. Real DB/browser tests only in approved QA.
Report exact PASS/FAIL/SKIP/BLOCKED; never infer live acceptance from fake clients.
Use existing Audit & Foundation for independent review, no new sessions. Do not
access its worktree; use approved snapshots/context for evidence when necessary.

Deliver changed files, one current checkpoint/roadmap, configuration contract,
MVP acceptance matrix and test evidence. Prepare commit title and PR description;
commit only after distinct operator approval per AGENTS.md. Mytko handles PR,
push/review/merge and all trusted pipeline steps. No production readiness claim
without DB/browser/security/restore evidence.

## Readiness estimate

Lightweight MVP ~60%, heuristic acceptance-weighted: domain/API 20/25, board UX
15/25, config/security foundations 15/20, real DB/browser/release evidence 10/30.
This is not measured code coverage; score reflects implemented foundations and
missing live evidence. Broader attachments/archive scope would score lower.
Next work belongs to Implementacja (Codex); independent review to existing
Audit & Foundation. This plan changes no application behavior or infrastructure.
