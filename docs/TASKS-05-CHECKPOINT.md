# TASKS-05 checkpoint — PARTIAL (policy foundation only)

Branch mytko/implementacja-96f75bff, HEAD eeb103532ae6d72a57d1bab7391104cb56423de3.
Incoming TASKS-03/04 changes preserved. Their checkpoints still record partial
API/browser/DB acceptance. No new migrations, API endpoints or frontend actions
were added for TASKS-05. No attachment upload/download or cleanup runner exists.
This checkpoint must not be interpreted as feature completion.

Implemented pure retentionAction policy (not wired to any deletion):
- Archive done tasks at completedAt + 30 * 24 hours, inclusive, using UTC instants.
- On archival persist the actual processing instant as archivedAt; deletion is
  eligible archivedAt + 30 * 24 hours, inclusive. Delayed runs do not backdate it.
- Protection prevents automatic deletion, not archival; manual deletion is separate.
- Restore must clear archivedAt, reopen to todo and clear completedAt; a later
  completion starts a new 30-day period. This transition is specified, not wired.
- Reopened active tasks are kept. Missing/invalid dates never qualify for deletion.
- Historical migration must never delete or run this policy implicitly.

Current Run tests: backend 111 PASS / 0 FAIL, including 11 policy cases covering
29/30/31, 59/60/61, protection, reopening, delayed archival, invalid timestamps,
deterministic decisions. PostgreSQL integration suite skipped. diff check PASS.
No tests of upload/MIME/traversal/DB-filesystem failures ran: code not implemented.

Required implementation work:
- Dedicated attachment table and protected flag migration; durable storage config
  outside public frontend, explicit approved directory, random storage keys.
- Bounded authenticated streaming upload, per-task limits under row lock, allowlisted
  MIME with content verification, sanitized display names, forced download headers.
- Unified single-task and legacy date-delete lifecycle; both currently directly
  DELETE rows and must not bypass file accounting after attachments are introduced.
- Durable deletion outbox: commit deletion intent, unlink only DB-recorded random
  keys under approved root, ENOENT idempotent, retain/retry failed entries; DB/files
  cannot participate in one ACID transaction. Never scan/delete arbitrary paths.
- Explicit operator cleanup with dry-run default, advisory lock, report counts,
  bounded batches and retriable outbox. No production invocation authorized.
- Archive list/restore/protect endpoints and matching board/archive UI, confirmation.
- Integration tests in approved disposable DB/storage; file-fault tests in unique
  temporary directories; full frontend regressions and actual browser acceptance.

No cleanup, database writes, secret reads, infrastructure, Git commit/push/merge
or deployment performed. Status PARTIAL; no full TASKS-05 review readiness.
