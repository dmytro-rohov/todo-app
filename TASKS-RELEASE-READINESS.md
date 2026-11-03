# Mytko Tasks — TASKS-07P release readiness

Status: **PARTIAL / NO-GO for deployment**. Current branch
mytko/implementacja-96f75bff, committed base eeb103532ae6d72a57d1bab7391104cb56423de3;
TASKS-03–07P changes are uncommitted. This is a review package, not a frozen
release artifact. No OVH/production Database & Docker connection was made.

## Feature → evidence → result → blocker

| Feature | Actual test/evidence | Result | Remaining gate |
|---|---|---|---|
| Kanban/responsive cards | assets + escaped card test, SCSS build | partial | real layout/browser |
| CRUD/categories | existing HTTP fake-DB security tests | local PASS | real DB + category management UI |
| Status/priority | task-domain unit tests | local PASS | migration/HTTP end-to-end |
| Deadline | patch validator date/null tests | local PASS | real persisted readback |
| Pointer DnD/touch | implementation inspection only | BLOCKED | browser pointer/touch |
| Ordering | four fake-client transaction tests | local PASS | PostgreSQL contention/reload |
| Attachments | no implementation | MISSING | upload/download/security/storage |
| Archive UI/actions | no implementation | MISSING | endpoints/restore/protection |
| Cleanup | pure retention policy boundary tests | policy PASS only | runner/outbox/retry/DB/files |
| Login/API security | negative auth/CSRF/CORS/header/rate tests | local PASS | TLS/proxy independent review |
| Persistence/backup restore | operator smoke prepared, not run | BLOCKED | isolated PostgreSQL 17 runner |
| Browser/PWA | executable partial E2E prepared | BLOCKED | Playwright and live disposable app |

## Current Run checks

Frontend: 30 PASS / 0 FAIL. Backend: 122 PASS / 0 FAIL (includes daemon-free
Compose contract checks); PostgreSQL integration suite skipped. Sass PASS.
Both npm audits: zero reported vulnerabilities. Bash smoke and E2E Node syntax,
git diff --check PASS. These are not penetration-test or production guarantees.
No CPU/RAM measurements taken. Firefox exists but Playwright is not installed;
no browser acceptance was executed. No Docker build, real PostgreSQL, HTTPS,
Caddy, OVH or restore test PASS is claimed.

## Implementation gaps and security review

TASKS-03/04 checkpoints remain partial. PATCH response naming needs normalization;
create/edit title limits differ (100/255); new form tests and real database
backfill/filter/CRUD acceptance are missing. DnD has no autoscroll and only a
highlighted handle preview. Attachments/archive/full cleanup are absent. No known
npm advisories were reported, but unknown application weaknesses remain possible.
Basic Auth over HTTPS retained: one owner, no session cookies or token storage;
reliable logout/PWA authentication UX not accepted. Defaults/config validation,
proxy peer allowlisting, CSRF, CSP, no-store, generic logs and graceful shutdown
exist. Security review must specifically examine new ordering locks, PATCH and
trigger privileges before GO. Never run retention against historical data by
migration side effect.

## Migrations and container contract

001_baseline, 002_task_integrity, 003_kanban. Third migration is additive, preserves
IDs and historical tasks, infers old due date from date, uses migration-time for
unknown timestamps, and adds trigger-based legacy completion synchronization.
It has NOT run against PostgreSQL. CREATE OR REPLACE permits disposable test
schema resets that leave the function; applied migration checksums must not be
edited. Migrator uses advisory lock, per-migration transaction and checksums.
No down migration: take a verified backup before applying; prefer forward repair.
Do not assume old application compatibility without rollback rehearsal. Restore
requires operator approval and a controlled outage/reconciliation of later writes.

Dockerfile: official Node 24 override by reviewed digest; multi-stage Sass/npm ci;
non-root uid 1000, root-owned code, no runtime npm, /app/frontend static files,
PORT 3000, SIGTERM and /readyz healthcheck. Build context excludes env secrets.
Production compose: review deploy/compose.yaml plus app/migrate env templates;
separate runtime/migrator credentials, loopback publication, read-only root,
capabilities dropped, no-new-privileges, CPU/RAM/PID bounds. These are artifacts,
not applied host configuration. Caddy reference deploy/Caddyfile.example terminates
TLS for tasks.mytko.dev and blocks public readiness. Actual TLS/firewall peers and
TRUST_PROXY must be validated. No Fujitsu dependency may remain at runtime.

Current production env templates are deploy/app.env.example and
migrate.env.example; all credential values are placeholders. Their host gateway
DB target is an example, not an approved OVH endpoint. Operator must supply exact
private DB hostname/network and sslmode policy; no implicit plaintext remote DB.
The production DB is not provisioned by these manifests. Runtime role tasks_app
gets DML and required sequence use only, owner tasks_owner alone migrates; no
superuser/CREATEDB/CREATEROLE for app, no production owner URL in app container.
Verify role grants, public schema create denial and PostgreSQL 17 server version.

Attachment persistent storage is **NOT provisioned or consumed**. Before feature
acceptance, define a project-owned volume outside /app/frontend, uid ownership,
noexec/nodev/nosuid where supported, quotas, backup and verified DB/files restore.
Do not add a writable mount and claim attachment support before implementation.

## Database & Docker handoff

| Area | DEV Fujitsu | PROD OVH |
|---|---|---|
| Project | todo-mytko-tasks | todo-mytko-tasks |
| DB | isolated Tasks DEV; separate disposable test DB | dedicated PostgreSQL 17 Tasks DB |
| Credentials | Broker-approved scope only | app DML and separate migrator owner |
| Isolation | no ORHEA/MOTO grants or networks | private app→DB network; no public DB port |
| Access | approved Database Broker, capability not proven | trusted operator/pipeline only |
| Status | healthz + authenticated app; internal readyz | same plus external TLS probe |
| Telemetry | operator runtime metrics | CPU/RAM/PIDs/disk/DB connections, no secrets |
| Recovery | disposable restore rehearsal | encrypted off-host DB/files backups + restore drill |

Four separate responsibilities, none implicitly ready:
1. Application implementation: this worktree and tests; incomplete features above.
2. Production resource configuration: operator creates exact DB/roles/network,
   volume and secret bindings after review; not done here.
3. Remote Docker monitoring: trusted read-only metrics/status/log collection;
   no socket exposure to agents, capability/operator tests required.
4. Deploy Executor: trusted immutable-artifact build/validate/approval/release,
   health gate and rollback evidence. No executor operation performed here.

Operator actions must be project-scoped, auditable and least privilege. Database
Broker must identify server, DB, role and allowed operations before writes.
Neither a CLI binary nor documentation proves a working Broker/monitor/executor.

## Smoke and E2E handoff

Use the current procedure at the top of docs/VALIDATION.md after reviewed commit.
Approved immutable Node/PostgreSQL images and disposable local runner required.
deploy/smoke-test.sh now also mounts/runs backend/test/release-smoke.js against
http://app:3000 on its isolated network. Probe tests new fields/filter, deadline,
move into done, completedAt, reopen and due-date clearing; removes its own task.
Existing script tests migration, auth, headers, restart persistence, DB outage,
concurrent migration and backup/restore. New probe is syntax-checked, NOT executed.
Archive/attachments/cleanup cannot be smoked until implemented: full MVP is NO-GO.
No destructive reset may target DEV or production; integration suite drops test
tables and is allowed only on this disposable stack.

E2E: e2e/acceptance.cjs requires operator-provided Playwright/Chromium in an isolated
QA checkout/toolchain. Do not install globally or change app dependencies implicitly.
With the approved disposable stack on loopback 3101 only:

```bash
TASKS_DISPOSABLE_APPROVED=yes E2E_BASE=http://127.0.0.1:3101 node e2e/acceptance.cjs
```

Scenario tests desktop/mobile viewport, authenticated create/edit/delete shell,
one created card, keyboard cross-column move, reload persistence, overflow and
console errors. Additional required manual/browser cases: native Basic challenge,
invalid form/server error recovery, pointer/touch same/cross-column DnD, CSP
violations, keyboard focus and reduced motion, archive/files once implemented.
The E2E script needs a running disposable stack; smoke currently cleans its stack
on exit, so the approved QA runner must manage its own isolated stack lifetime.
Never redirect E2E to production. QA failures leave only disposable test data.

## STOP/GO, rollout and review

STOP now: missing archive/files/cleanup, unfrozen source, no real PG/Docker smoke,
no browser acceptance, no independent security review, no restored backup evidence.
GO requires all these closed and evidence tied to one source SHA + image digest,
verified publisher/base digests, no high/critical advisories, role/network/TLS tests,
resource limits + disk monitoring, tested rollback and operator approval.

Sequence: finish feature gaps → separate reviewable commits with approval → Mytko
PR/review against confirmed main (do not silently rebase separate audit lineage) →
freeze source → approved isolated build/smoke/browser/security/restore → operator
creates production resources → backup → approved migrate → exact image rollout →
readiness/TLS/auth checks → monitored observation. Failures stop progression;
restore/rollback only via trusted operator, no automatic destructive DB rollback.
PR creation/push/merge/deploy/Fast Track were not performed.

## Five-task summary

TASKS-03: model and board implemented, API/browser/DB acceptance partial.
TASKS-04: transaction ordering and pointer/keyboard controls, acceptance partial.
TASKS-05: retention policy only; attachments/archive/cleanup missing.
TASKS-06: existing auth retained and hardened; live production security blocked.
TASKS-07P: audit matrix, updated smoke, partial executable E2E and handoff delivered;
production readiness PARTIAL, no deployment authorized or claimed.
