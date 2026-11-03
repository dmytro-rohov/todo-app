# SHARED-BASE-01 — approved source handoff candidate

Source Session 96f75bff-c01a-414c-8b48-25e432f15f9b (Implementacja), branch
mytko/implementacja-96f75bff. Base e8deeda514d76cf9f731a62cf927e4ce6d5f12b4.
Target existing Full Features Session 1a78a96f-6bcc-4172-babe-eee57bc5c8cf.
READY FOR COMMIT; sharing BLOCKED until approval and authorized source delivery.
No new checkpoint SHA yet; base SHA does not contain incoming Lite edits.

Machine manifest: docs/SHARED-BASE-01.manifest.json contains relative required
paths and SHA256 bytes for current candidate. Commit SHA identifies final tree;
manifest hashes bind selected code without self-referential commit/hash fields.
Preserve all source files and Lite documentation in the logical checkpoint.

Required dependency groups:
- backend/migrations/001_baseline.sql, 002_task_integrity.sql, 003_kanban.sql;
- backend/task-domain.js, ordering.js, retention-policy.js;
- backend/config.js, database-config.js, db.js, server.js, migrate.js, migrations.js;
- backend/app.js, security.js, routes/, scripts/, package.json and package-lock.json;
- frontend/index.html, js/, styles/*.scss, manifests/lockfile and tests;
- backend/test/, deploy review artifacts, Dockerfile/.dockerignore, AGENTS/README;
- checkpoint/readiness/Workflow integration and Lite handoff docs, e2e scripts.
No filled .env, node_modules, dist, cache, DB dumps or actual secrets shared.

Important contracts: shared config injects pg Pool; app/owner URLs separate.
Kanban serial IDs, three statuses, priorities, dueDate/position, completedAt trigger;
GET/POST/PUT/PATCH/DELETE tasks + POST move, category GET/POST/PUT/DELETE.
HTTP same-origin auth/CSRF middleware precedes all private routes. Pure retention
policy is specification only, not executor. Full must unify all task deletion paths
with attachment lifecycle and extend grants/migrations additively; never alter
applied migration checksums or auto-delete legacy data during upgrade.

Actual checks: frontend 40 PASS, backend 128 PASS, no failures; PostgreSQL suite
skipped for absent approved TEST_* URLs. Sass PASS, audits zero vulnerabilities,
diff check PASS. Real Docker/DB/browser acceptance not claimed. This checkpoint
supports parallel development, not production authorization.

## Operator authorization and transfer

AGENTS.md requires explicit approval before commit. Operator action: approve
"TASKS-SHARED-BASE-01: freeze Lite dependencies for Full Features" on this branch.
Agent may then stage only reviewed Lite/handoff files, inspect staged diff,
commit, report full SHA and clean status. Do not add .env/cache/generated outputs.

After commit the operator must use Mytko's trusted Session/worktree management to
assign the existing Full Features Session an isolated branch/worktree based on the
exact checkpoint SHA, preserving any existing Full work first. No exposed tool in
this Run can assign a Session base; do not invent CLI/API commands or claim it ran.
Do not let the Full agent reset/rebase/cherry-pick its own branch to work around it.
Workflow must confirm resulting HEAD/ancestry and scope before Full implementation.

Alternative native read-only handoff: operator approves snapshot policy for source
Session and required paths. Full Features invokes session_snapshot_policies,
then session_snapshot_request(source_session_id=source, revision=full_checkpoint_SHA,
policy_id=approved_policy_id, path_ids=approved_path_ids), checks status/manifest,
and reads published immutable files. Real opaque IDs must come from the approved
policy, never fabricated. Snapshot grants read evidence, not Git integration or
worktree creation. Same-project discovery is not source access permission.
This Run's policy list was empty; no snapshot requested and no foreign worktree
read. If operator needs a policy proposal, Full uses session_snapshot_access_request
for named paths; approval is required before capture. No deployment/merge needed
for either handoff path.

Ownership: this patch stays in existing Lite files and standalone handoff docs;
no Full branch/worktree touched. Shared app/routes/migrations/security changes in
Full require explicit coordination/review against this exact base. Both sessions
must preserve independent work and use Mytko review/integration, not shared edits.
