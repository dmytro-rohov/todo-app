# TASKS-03 checkpoint — PARTIAL

Source base: eeb103532ae6d72a57d1bab7391104cb56423de3 on
mytko/implementacja-96f75bff. No commit or infrastructure operation performed.

Implemented: additive 003_kanban migration preserves serial IDs and historical
records, backfills status from completed, due date from legacy date, position
from id. Historical creation/completion times are unknown and use migration time.
New domain: description, three statuses, P0–P3, optional due date, timestamps,
completion time, position, reserved archived_at. Reopening clears completed_at;
entering done records a new timestamp. Trigger synchronizes legacy completed.
No migration executed. Ordering is position/id, independent of priority.

Existing GET/POST/PUT/DELETE /api/tasks retained; GET supports status, priority,
categoryId filters; PATCH /api/tasks/:id validates partial fields without rejecting
unchanged historical titles. POST stores new fields atomically. New board uses
existing authenticated same-origin API and http.js. Three columns, counts, cards,
search/filters, create/edit dialog, confirmed deletion, busy/error/empty states,
responsive one-column layout, labels, focus styles and safe escaped templates.
Legacy modules retained for compatibility/regression tests; main loads board.

Executed: npm ci both packages PASS, Sass PASS, frontend 30 PASS / 0 FAIL,
backend 122 PASS / 0 FAIL, npm audits both zero vulnerabilities, diff check PASS.
PostgreSQL suite skipped; no Docker/DB PASS. New tests cover domain validation
and card escaping; legacy event tests remain, but do NOT validate the new board
form. No real browser/mobile acceptance performed.

Open acceptance work:
- Real PostgreSQL 17 migration/backfill/CRUD/filter/due-date/persistence tests.
- New board form integration tests, mobile/browser keyboard/layout acceptance.
- HTTP contract tests specifically asserting new filter SQL and PATCH semantics.
- PATCH now returns the same camelCase projection as GET/POST; HTTP regression coverage asserts the shared response shape.
- Legacy PUT resets no new fields, but timestamp consistency requires DB trigger.
- New creation still inherits legacy 3–100 title validation; editor exposes 255.
  Align the create/edit contract before accepting the UI.
- Creation ordering is explicit persisted position with id tie-break, not an
  atomic server-side append allocator. No drag/drop implemented.
- Category management uses existing API, no new category manager in board yet.

Acceptance estimate: 60% (model/API implementation and board skeleton delivered;
DB integration, complete new form/regression coverage, contract polish and browser
acceptance outstanding). This is a checkpoint, not completion or release readiness.

Proposed eventual commit: TASKS-03: implement Kanban task domain and responsive board
Proposed PR: TASKS-03 — Kanban domain, additive migration and board UI
PR must describe DB/browser blockers and include their evidence before acceptance.
