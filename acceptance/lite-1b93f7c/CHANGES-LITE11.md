# Lite11 checkpoint — PARTIAL

Only acceptance package changed; candidate1b93f7c and all101 hashes unchanged.
Preserved Lite10 work. No Full worktree or database accessed; no commit.

Implemented: per-run random owner/app/restore/superuser PostgreSQL passwords,
project+run ownership verifier before Compose down, cleanup refusal for foreign
labels, retained Compose logs on failure; negative restore rechecks both DBs;
bounded PG lock timeout55P03/statement timeout57014 and diagnostic advisory-lock
deadlock40P01 tests with rollback. Diagnostic deadlock is not application success
or proof all deadlocks prevented. Separate browser package pins playwright1.56.1
and lockfile, generated with approved registry access without scripts/browser
installation. Run controlled npm ci then explicit approved Chromium install only
on QA runner; npm test requires approved loopback disposable stack.

Actual offline: 3 Node package tests PASS, 2 Python ownership tests PASS,
application52 frontend/128 backend PASS, ci/build/audits/diff PASS, zero advisories;
manifest101 PASS. PostgreSQL suite skipped. New real PG/browser tests NOT RUN.
No Docker call in this Run. Package sources are untracked and need review/approval.

Remaining P0 (do not claim READY FOR OPERATOR PREFLIGHT):
- Full opposite-direction/same-task concurrency and fault/recovery HTTP matrix.
- Basic Auth probe still uses fixed disposable credentials, though DB passwords
  are random. Docker inspect artifact can include DB env secrets; redact before
  retaining/sharing it. Approval/pull and cleanup resource-race hardening incomplete.
- Ownership verifier unit tests exercise data objects, not real Docker refusal.
- Browser scenario copied existing desktop/mobile/category/mouse/keyboard/409 flow;
  offline/timeout/auth/403/500/accessibility matrix is NOT complete.
- Negative occupied-port/missing PG/interruption tests still absent.

Entrypoint remains acceptance.sh; read RUNBOOK but its earlier status claims are
historical. No execution approved until review resolves remaining items.
Proposal eventual commit: TASKS-LITE: harden PostgreSQL and browser acceptance package.
Status PARTIAL, not READY FOR COMMIT or deployment. Do not infer approval from tools.
