# TASKS-04 checkpoint — PARTIAL

Base HEAD eeb103532ae6d72a57d1bab7391104cb56423de3, branch
mytko/implementacja-96f75bff. TASKS-03 working changes preserved. Its own
checkpoint remains PARTIAL, despite task prompt describing implementation complete.
Status/position contracts are present, so ordering implementation could proceed.

POST /api/tasks/move body:
{id, status, beforeId: null|id, expected: SHA-256 token of the canonical active-task snapshot}.
The backend also accepts the former full snapshot array for compatibility with older clients.
Null target appends (also works in empty columns). IDs/statuses/snapshot uniqueness
validated. Server compares full active-board snapshot under SHARE ROW EXCLUSIVE
transaction lock, conflicting with ordinary writers too. Stale snapshot -> 409,
invalid target -> 400, all writes rollback on errors. Dense zero-based positions
are recalculated for source/destination; priority never enters ordering. No task
is deleted. Existing migration 003 trigger handles completion timestamps. No
additional migration; no database was contacted. Locking serializes board writes
and may be costly for large boards; HTTP body limit bounds snapshot size.

Frontend uses Pointer Events on explicit handles (mouse/touch), capture, movement
threshold, highlighted handle preview and drop indicator; no card-opening action
on handles. Arrow up/down moves within column, left/right appends to adjacent
column. Focus restored on successful reload; live saving/error messages, reduced
motion CSS. Pessimistic UI retains old state on API failure, so no optimistic
rollback is needed. Per-ordering busy guard prevents duplicate ordering requests.
Full unfiltered task snapshot is used even when filters hide cards.

Executed: Sass PASS; frontend 29 PASS, backend 100 PASS, diff check PASS.
Four new backend fake-client tests cover empty-column move, same-column ordering,
stale conflict with no updates, duplicate snapshot rejection. Existing TASKS-03
regressions pass. No real DB concurrency test, browser pointer/touch/keyboard test,
or new frontend error/single-write automation has run. Do not interpret DOM/unit
PASS as browser DnD PASS. Full persistence/reload and parallel request acceptance
remain BLOCKED by unavailable approved PostgreSQL. Pointer target policy inserts
before hovered card, appends on column background; no auto-scroll yet.

Open: real PostgreSQL integration/concurrency/rollback tests; frontend interaction
and 400/409/500 tests; real touch/browser accessibility acceptance; auto-scroll and
richer drag preview. TASKS-03 contract polish and acceptance remain outstanding.
No commit/push/merge/deploy performed.

Proposed eventual commit: TASKS-04: persist transactional Kanban ordering
Proposed PR: TASKS-04 — transactional ordering and accessible pointer controls
Status PARTIAL; independent review should include unfinished acceptance criteria.
