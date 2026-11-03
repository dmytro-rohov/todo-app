# TASKS-LITE-06 — READY FOR COMMIT (source), PARTIAL (acceptance)

HEAD d111d011a6e8415398e4c041b65c6e4f6c531c86 is immutable Full source checkpoint.
No commit/amend or other Session operation performed. Current patch has no SHA.
Preserved incoming timeout/tests, validate-lite.sh and Lite-05 checkpoint.
Changed only Lite HTTP/board/ordering tests and this checkpoint; Full not activated.

HTTP deadline covers headers and body; caller AbortController composes with deadline.
400/401/403/404/409/500/503 preserve ApiError status/message. No retry of mutations.
Stream failures normalized to status 0. Timeout reports uncertain server outcome and
asks for refresh before retry; abort is not server rollback or exactly-once delivery.
Request timeouts validated as positive integer within native timer bounds.
Board load returns false on failed refresh; ordering no longer masks refresh failure
as successful current state. Reload uses persisted data. New test asserts message
and aria-busy reset. This does not replace actual browser/offline acceptance.

Actual final script run: scripts/validate-lite.sh PASS, including npm ci both,
Sass build, frontend 52 PASS / 0 FAIL / 0 SKIP, backend 128 PASS / 0 FAIL.
PostgreSQL integration suite SKIPPED; individual skipped count is zero because
suite body did not run. Both npm audits zero vulnerabilities; shell/E2E syntax and
diff check PASS. No current trusted Validate: Mytko metadata still historical failed
for e8deeda, completed 2026-10-31 14:58:40 UTC; current checkpoint differs. Local
runner is suitable command input to pipeline, but actual pipeline wiring/logs need
operator verification. Never claim local script is trusted Validate.

## Acceptance gates

Real PostgreSQL17/Docker/browser remain BLOCKED (no approved runner/URLs). Existing
integration tests implement ledger/repeat, backfill, role restrictions, concurrent
moves and domain contracts. Smoke checks restart, database outage and dump/restore.
Unit fake-client rollback is not PG rollback/deadlock evidence. Explicit induced
mid-move PG failure/deadlock/connection-break acceptance remains outstanding; do not
claim all DB scenarios merely because test files exist. Keep destructive tests on
new tasks_test only, no DEV/ORHEA/MOTO. Approved operator instructions are current
section at top of docs/VALIDATION.md and Lite-02/Lite-05 handoff, not historical
blocks. Build reviewed clean source once with approved Node24/Postgres17 digests;
run exact TEST_IMAGE ID, preserve logs/digests. Separate QA stack lifetime required
for e2e/lite-acceptance.cjs + provided Playwright/Chromium. Browser script prepared,
not executed. Real touch/focus/offline/restart/negative auth acceptance still needed.

OVH artifacts remain deploy/compose.yaml, env templates, Caddy example. Operator
provisions separate PG17 private DB/volume/app+owner roles, secrets outside Git,
validated CA/TLS/proxy peers and resource/backup monitoring. No production resources
created here. Follow read-only/non-root/capability/CPU/RAM/PID contract, healthz and
internal readyz; independent security review and real HTTPS mandatory. Forward-only
001–003 checksum migrations; N-1 app rollback needs rehearsal against migrated
schema, not automatic down migration. Before migration verify target identity and
backup restore. Post-deploy smoke checks TLS/auth/CRUD/readiness and rollback
thresholds; only trusted operator approved release can execute it. Hotfix = isolated
reviewed branch assigned by Mytko, regression, immutable image, Validate/approval,
release and observation, never ad hoc production edits. App does not call Fujitsu.

Proposed commit: TASKS-LITE: bound HTTP requests and preserve refresh failures
Proposed PR: HTTP timeout/cancellation regressions, explicit uncertain-write warning,
refresh-error handling and local validation runner. Include test evidence and
BLOCKED acceptance matrix. Commit requires new operator approval; prior approval
was only d111d011. Then review by Audit & Foundation and authorized pipeline.
Overall PARTIAL; more than release authorization remains. No PR/push/merge/deploy.
