# TASKS-V2-UI-01 — implementation and acceptance

Status: **code implemented, NO-GO for completed V2 acceptance**. Actual browser
verification is blocked; no visual match or real migration PASS is claimed.
The earlier audit is preserved in TASKS-V2-UI-01-AUDIT.md. This document supersedes
its statement that no V2 implementation exists, without changing its audit facts.

## Start gate and branch

Base: `387fe856e5bd49bb5f77ff46ee4b3724edbdaf8c`.
Session: `96f75bff-c01a-414c-8b48-25e432f15f9b`.
The assigned branch remains `mytko/implementacja-96f75bff`; Mytko did not assign
`mytko/tasks-v2-ui-01`. The locally recorded origin/main is
`a561813e439d3a9cf65eedc758b8ce6121cb72d6`. No fetch/reset/switch/rebase/merge was
performed. The continue instruction was implemented in the existing worktree;
Mytko must resolve the desired branch/base before PR integration. Prior dirty
acceptance notes and the runner backup are preserved outside the V2 commit.

## Implemented behavior

- Dark/green/black surfaces, lime actions, yellow review state, scoped SCSS layers,
  inline SVG icons, 236 px sidebar and real authenticated profile name.
- Desktop four-column board, tablet two-column board, mobile stacked board and
  collapsible inert navigation. List view and keyboard-operable view tabs.
- Search across titles, descriptions, projects, labels and people; project,
  priority, status, label and assignee filters; completed-task switch. Counters
  derive from real records and share metadata/search scope, independent of the
  selected status and completed visibility. No seeded product content.
- Real project, assignee and category/label CRUD through authenticated, CSRF-
  protected factory routers. Assignees are assignment records, not login accounts.
  Deleting a directory entry preserves its tasks and clears its assignments.
- Task cards show persisted project, all labels, assignee initials, deadline,
  priority and state. Existing edit/delete/no-op save and historical title rules
  remain. New-task and per-column quick-add actions open the same form.
- Multi-label form edits are saved atomically with task changes. Categories remain
  the single label dictionary. categoryId is the primary legacy label; task_labels
  stores additional labels. Old categoryId writers replace only the primary label
  and retain unrelated additional labels; deletion uses FK cascades/SET NULL.
- Needs review is supported in SQL constraints, API/domain validation, filters,
  forms, keyboard ordering and pointer moves. Only done implies completed=true.
- Ordering retains the full authoritative snapshot under filters, detects stale
  writes and now scrolls the viewport at the edge during pointer/touch dragging.
  Cancel/lost capture stops the scrolling loop.
- HTTP Basic, scrypt, rate limits, CSRF, generic error JSON and the protected static
  shell remain in place. No account/password store, SSO, new framework or bundler.

## Migration and compatibility

`backend/migrations/004_tasks_v2.sql` adds projects, assignees, nullable foreign
keys, task_labels and indexes, and extends the status constraint. Applied files
001–003 are unchanged. Adding nullable fields does not rewrite historical titles,
IDs, dates or completion timestamps. App-role grants explicitly include new tables.
No migration was run against an existing database in this Session.

The real-PostgreSQL regression suite now covers a historical 255-character title,
legacy categories, migration chain/idempotence, app-role writes, multi-label
rollback on invalid references, review/completion semantics, metadata filtering,
legacy PUT and deletion/unassignment. Existing concurrency tests are retained.
It requires BOTH dedicated local test URLs and the app DB role. Never run this
suite on production; it drops test tables. A downgrade to a three-status Lite UI
cannot display Needs review records correctly; do not roll back blindly after V2
writes. No down migration or destructive automatic cleanup was introduced.

## Differences from the reference and deferred functionality

The reference PNG was inspected, but **no running-page comparison was possible**.
The following are known design/scope differences from code, not measured screenshot
results:

- Reference calendar, reports, personal-task view, notifications and timer controls
  are omitted. Their data models/identity mapping are a separate stage. No dummy
  tabs, bell badges or timer values are displayed.
- The actual authenticated username replaces the example person's name/email.
  Project and task names/counts come from the database; reference content is not
  copied as fake data. The reference's inconsistent total is not reproduced.
- Cards expose a small priority/edit row absent from the reference and use the
  status glyph as the accessible drag/keyboard handle. Project/label/person CRUD
  uses a reusable management dialog; forms were not specified by the screenshot.
- Typography uses a local system-font stack with Inter if available. No licensed
  matching font was supplied, so exact type metrics are unverified. SVG icons are
  local approximations. Colors/proportions are based on the supplied image.
- The screenshot provides desktop only. Tablet/mobile adaptation is implemented,
  but overflow, actual touch interaction and visual alignment need Chromium QA.
- Login remains the native Basic challenge. No Workflow login source/reference
  was returned by the authorized context search, so its visuals were not copied.
  This did not block other UI implementation.

## Validation

Run the required dependency installs, CSS build and frontend/backend tests before
review. CSS must be built so the stylesheet test does not skip. Local HTTP tests
use the actual Express app with fake pools; these are not PostgreSQL evidence.
Final executed counts are recorded below after the final code check.

| Check | Result |
|---|---|
| Backend/frontend npm ci | PASS |
| Frontend CSS build | PASS |
| Frontend tests | PASS, 64/64; zero skipped |
| Backend tests | PASS, 165/165; real PG suite excluded without test URLs |
| Existing package/runtime contracts | PASS, 34/34 |
| Existing stack-check tests | PASS, 8/8 |
| V2 browser-runner syntax / git diff --check | PASS |
| Real migration suite invocation | SKIPPED: test URLs unset (0 real DB tests) |
| Browser tool open http://127.0.0.1:3101 | BLOCKED: DESTINATION_BLOCKED |
| V2 explicit browser runner | BLOCKED, exit 3, 0/20; no approved isolated stack |
| Desktop/mobile screenshots and visual comparison | NOT RUN; no screenshots generated |

No server executable (postgres/initdb) or configured TEST_DATABASE_URL /
TEST_MIGRATION_DATABASE_URL was available; only PostgreSQL client tools were found.
MYTKO_PLAYWRIGHT and MYTKO_PLAYWRIGHT_ROOT are unset. The browser restriction was
not bypassed with host sockets, alternate ports, global NODE_PATH or another
browser installation. A request for the approved preview/test-runtime details is
pending with the operator. Historical Lite screenshots/20-of-20 claims do not
validate this UI or its migration.

Local validation logs: `/tmp/v2-backend-ci.log`, `/tmp/v2-frontend-ci.log`,
`/tmp/v2-build.log`, `/tmp/v2-backend.log`, `/tmp/v2-frontend.log`,
`/tmp/v2-contracts.log`, `/tmp/v2-stack-tests.log`, `/tmp/v2-pg.log`.
The blocked browser summary is `/tmp/tasks-v2-browser-MUprs8/summary.json`:
20 named scenarios NOT_RUN, 0 passed. These temporary paths are local evidence,
not published artifacts or a promise of long-term retention.

## Explicit browser QA handoff (not a pipeline stage)

`acceptance/v2/browser.cjs` reuses the central runtime resolver and exact
Playwright/Chromium contract. It never installs Playwright or enables Workflow
policy. The new runner is separate from the historical exact-Lite acceptance
package, whose source SHA checks must not be redirected at V2.

Operator must first inspect the exact V2 source/image revision, resource ownership,
loopback publication, current readiness, isolated test DB, Basic protection,
PUBLIC_ORIGIN and Workflow's allowed preview port on the approved Fujitsu runner.
Use the existing approved stack lifecycle; no Docker creation or cleanup is
performed by this script. Record the ownership/revision evidence with the run.
`V2_STACK_VERIFIED=yes` is a package-side operator attestation, not a manager
policy override or an automated ownership proof.

Once the manager contract and permitted runtime are confirmed, the protected
operator environment must supply E2E_BASE (approved loopback origin),
TASKS_DISPOSABLE_APPROVED=yes, V2_STACK_VERIFIED=yes, the per-run AUTH_PASSWORD
through the secret mechanism, and the Workflow-approved central runtime settings.
Do not paste secrets into command lines, logs or Git. Then run:

```sh
node acceptance/v2/browser.cjs
```

This runs ten named checks at 1672×941 and 390×844: load/CSS, directory creation,
assigned task creation, no-op save, combined filters/list, keyboard review and
reload/edit persistence, pointer/touch move to done and hide/show completed,
overflow/layout, removal of its own QA data, and clean console/network evidence.
Mobile uses Chromium touch input and tests viewport edge scrolling. The runner
writes scenario screenshots, traces, actual runtime metadata, private console
JSON and a 20-scenario summary; a failed/not-run scenario prevents PASS. Evidence
is private (700 directory/600 files). On failure, only the runner's own QA records
may remain; the script never cleans unrelated data or stack resources.

## Release decision

Code is available for review, but **NO-GO for a claim of completed visual/database
acceptance or production release**. Remaining gates: assigned V2 branch/base,
real migration tests, allowed preview/central Chromium execution, desktop/mobile
screenshots and measured comparison, then independent review. PR creation and
trusted Validate/Push/Review/Merge/Deploy remain owned by Mytko. Production
https://tasks.mytko.dev was neither accessed nor modified.
