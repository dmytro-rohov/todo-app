# TASKS-LITE-05 — checkpoint recorded, further changes uncommitted

Approved checkpoint d111d011a6e8415398e4c041b65c6e4f6c531c86:
TASKS-SHARED-BASE-01: freeze Lite dependencies for Full Features.
18 files, 1002 additions/18 deletions. Full list:
backend/config.js, database-config.js, migrate.js, routes/categories.js, server.js,
test/categories.test.js, test/database-config.test.js, test/unit.test.js;
docs/SHARED-BASE-01.manifest.json, SHARED-BASE-01.md, TASKS-LITE-01.md,
TASKS-LITE-02.md, TASKS-LITE-04.md, WORKFLOW-INTEGRATION-PLAN.md;
e2e/lite-acceptance.cjs; frontend/js/board.js, js/category-actions.js,
test/categories.test.js.

All 94 manifest hashes verified before commit AND against git-show bytes at
that full commit after commit. checkpointCommit=null/state=pending in the
committed manifest records preparation-time state, not a live release indicator;
use the full SHA above as immutable source locator with that manifest. Self-SHA
cannot be embedded into its own commit. No manifest edits/amend performed.
Worktree was clean immediately after checkpoint. Git emitted packed-refs.lock
read-only warning but commit/HEAD and tree were successfully verified; no workaround.
No private env, node_modules, generated CSS or cache staged. Full worktree untouched.

Publication: operator/Mytko may publish this exact checkpoint through trusted
source/Session workflow and assign existing Full Features an isolated base at
that SHA. No exposed tool can perform Session-base assignment here. Alternative
approved snapshot policy/capture is described in SHARED-BASE-01; previous policy
list was empty. No push/merge/rebase/reset or foreign worktree operation occurred.
Checkpoint is development source approval, NOT production approval.

## Post-checkpoint code and validation

http.js now enforces 15s request deadline including response body and translates
body/network failures to ApiError status 0; caller cancellation is composed with
deadline, and no retries happen. Timeout does not prove server rolled back: UI
must refresh before manually retrying non-idempotent creation. Two tests added for
stalled body timeout/single request and broken response stream. No second commit.
Local scripts/validate-lite.sh provides pipeline-compatible commands without
invoking trusted Validate, DB or Docker operations. Executed successfully:
42 frontend PASS / 0 FAIL, 128 backend PASS / 0 FAIL, both npm ci, Sass, audits
zero vulnerabilities, smoke/E2E syntax and diff check PASS. PostgreSQL suite
SKIPPED, zero individual skipped tests reported. No real browser/container PASS.

## Operator's executable acceptance path

One authoritative release-engineering checklist: current top section of
 docs/VALIDATION.md. Supply reviewed SOURCE SHA (checkpoint if testing shared base,
future authorized commit if including timeout changes), approved official Node24
and postgres17 image digests; validate no dirty files. Build one immutable image,
record revision and image ID, run deploy/smoke-test.sh with explicit approval.
Smoke uses current runtime/migrator env, private unique Compose project, app/owner
roles, actual migrations/repeat/backfill/concurrent move test, DB outage,
restart persistence and backup restore. These code paths are prepared, not executed.
Destructive integration only in tasks_test container, never populated DEV/PROD.

```bash
# Approved disposable Fujitsu runner, reviewed clean checkout only:
bash scripts/validate-lite.sh # only available after follow-up commit
# For exact shared checkpoint use equivalent npm commands in docs/VALIDATION.md.
# Follow docs/VALIDATION.md current build/provenance steps, then:
TASKS_DISPOSABLE_APPROVED=yes TEST_IMAGE="${TEST_IMAGE:?frozen image ID}" \
TEST_POSTGRES_IMAGE="${TEST_POSTGRES_IMAGE:?approved postgres17 digest}" \
bash deploy/smoke-test.sh
# Separate approved running QA stack + provided Playwright/Chromium:
TASKS_DISPOSABLE_APPROVED=yes E2E_BASE=http://127.0.0.1:3101 node e2e/lite-acceptance.cjs
```

OVH manual release only after smoke/browser/security/restore approval: use reviewed
deploy/compose.yaml, Caddyfile.example and separate app/migrate env templates;
operator provisions dedicated PostgreSQL17 DB/roles/private network/persistent DB
volume, selects verified TLS/CA and exact proxy peers, provides secrets outside
Git, checks CPU/RAM/PIDs/disk/backup policy. Existing production Compose assumes
approved external DB; it does NOT provision it. No guessed Broker/Deploy Executor.
No Fujitsu dependency in application runtime. First migration needs backup and
identified target; owner URL absent from app. Rollback by compatible prior image
or separately approved restore (possible later-write loss), never blind down SQL.
Healthz public minimal, readyz internal, external auth/HTTPS/CSP/readiness acceptance.
No production service/container/DNS/TLS configuration created or modified.

## Blockers and next step

No approved Docker/DB runner or live browser acceptance. Historical Validate failed
metadata needs operator current configuration/logs and rerun; local script PASS is
not trusted pipeline PASS. Live GitHub main and per-file Full ownership need trusted
operator confirmation. Supply reviewed real image digests, isolated runner and QA
browser. Attachments/archive/cleanup remain excluded/inactive. Further timeout/
runner/docs patch needs separate commit authorization; do not mix it into approved
checkpoint. Then independent PR review via Mytko, trusted integration and approval.
Overall PARTIAL, shared source checkpoint available for authorized Full development.
