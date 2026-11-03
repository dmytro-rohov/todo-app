# TASKS-V2-UI-01 — audit and implementation contract

Audit date: 2026-11-03. Session `96f75bff-c01a-414c-8b48-25e432f15f9b`.
Inspected HEAD: `387fe856e5bd49bb5f77ff46ee4b3724edbdaf8c` on
`mytko/implementacja-96f75bff`. Status: **NO-GO for V2 review; audit only**.

The task requires a separate V2 branch. The Session currently grants only the
existing implementation branch; agents cannot create or switch branches. Mytko
must assign the V2 branch in this same Session before application changes. No V2
application code or migration was added to the Lite branch during this audit.
Existing dirty acceptance documentation and runner backup were preserved.

## Reference inspected

The supplied artifact
`.mytko/artifacts/d7f9af6f79114176a727356df69bd16bb766cbfbf619bd0e183b39c5314ce91e`
is a 1672×941 PNG and was visually inspected. It is the primary UI reference.

- Sidebar approximately 236 px wide with a fine right border; content begins
  around x=273, leaving about 37 px horizontal content padding.
- Near-black green background, translucent green panels, white headings,
  subdued secondary text, lime primary actions and yellow review state.
- Breadcrumb and search occupy the first row; page title and four counters the
  second; view tabs and lime New task action the third.
- Compact filter surface spans roughly y=248–315. Four column panels begin at
  y=342, approximately 330 px wide with 14–16 px gutters.
- Cards have rounded borders, project/category chips, avatar/assignee and date
  footer, plus a compact status action. Column tints reinforce state.
- Sidebar profile and active project selector sit at the bottom. Names, emails,
  project ORHEA, counts and task titles shown in the reference are example
  content, not data to seed into the application.

The screenshot's column counts and global total do not reconcile (6+12+6+6 vs
24). Implementation must calculate counts from real tasks with explicit filter
scope rather than reproduce these inconsistent numbers.

Only a desktop reference was supplied. Tablet/mobile layout must adapt the same
hierarchy; exact mobile visual parity cannot be established from this reference.
The screenshot does not identify the font file. A matching licensed local font
or a documented system fallback must be selected without external font requests.

## Existing functionality to reuse

| Area | Existing implementation | V2 action |
|---|---|---|
| Entry point | index.html → main.js → initBoard | Keep native ES modules and this entry path |
| Task form | board.js, submitTaskForm | Retain no-op saves, partial PATCH and historical-title compatibility |
| Task CRUD | routes/tasks.js, validation.js, task-domain.js | Extend existing router/validators; no parallel task model |
| Labels/categories | categories table, category-actions.js, routes/categories.js | Reuse categories as label records, retain categoryId API compatibility |
| Filtering | search/status/priority/category in board; GET status/priority/category | Extend with project/assignee/labels and define count scope |
| Ordering | ordering.js in frontend and backend | Retain keyboard/Pointer Events, dense order and snapshot conflict detection |
| API errors | api/http.js, ApiError, deadlines | Use for every active V2 request |
| Escaping | escapeHtml, safeColor | Keep for user data and style values |
| Auth | basicAuth, scrypt hash validation, rate limiting | Preserve auth boundary; no copied credentials or SSO |
| Migrations | checksum ledger, advisory lock, transactional files | Add new migration; never edit applied 001–003 |

No project, assignee, user-account, multi-label relation or needs_review status
exists in the current schema. Assignee records must not implicitly create login
accounts or promise multi-user authorization.

## CSS findings

`frontend/styles/style.scss` mixes legacy list/modal components with active
Kanban styles. The existing reset is already correctly wrapped in a cascade
layer; preserve that property.

- Lines 8–65 define a light palette and broad heading/body rules.
- Line 320 applies backgrounds to all headers/footers; new sidebar and page
  headers would inherit these unless replaced or scoped.
- `.tasks-container` appears twice (around 453 and 543) with overlapping padding.
- `.checkbox-wrapper` appears twice (around 137 and 145); these blocks currently
  complement one another, but complicate tracing styles of old components.
- Unlayered modal/utility rules begin around 606. Normal unlayered rules outrank
  layered rules regardless of the later layer's placement.
- The active board block at 838–850 uses light colors and three equal columns,
  then switches directly to one column at 900 px. It has no tablet two-column
  state, sidebar or view navigation.
- `--main-font` names Inter with a serif fallback, but the inspected frontend has
  no local font asset. There is no demonstrated exact font match.

Use a scoped board/shell stylesheet with explicit design tokens and one declared
layer order. Split SCSS with native Sass @use where helpful; no bundler or CSS
framework is needed. Do not merely append another override block to the legacy
stylesheet. Keep old modules needed by compatibility tests until their callers
are deliberately retired.

## Proposed data/API extension on the V2 branch

This is a design, not an applied migration.

1. Add needs_review to the task status constraint. Update the shared domain
   choices, API filters, move validation, keyboard column sequence, form and
   completion trigger tests together. Only done sets completed=true.
2. Add projects and assignees reference tables with validated names and optional
   presentation metadata. Add nullable project_id and assignee_id foreign keys
   to tasks with ON DELETE SET NULL; existing tasks remain unassigned.
3. Reuse categories for label names/colors. Add a task_categories relation for
   multiple labels, backfill existing category_id relationships, and define
   transactional synchronization for legacy categoryId writers. Do not create
   a second independent labels dictionary. Test PUT, PATCH and label deletion
   behavior so the legacy and multi-label surfaces cannot disagree.
4. Add parameterized project/assignee/label filters to the existing task API;
   return compatible task fields plus projectId, assigneeId and labelIds.
   Category lookup and assignment validation continue to reject foreign IDs.
5. Register createProjectsRouter(pool) and createAssigneesRouter(pool) using
   the existing error JSON convention and authentication/CSRF middleware.
6. Update migrations.js grantAppRole: it currently explicitly grants DML only
   on tasks/categories. New tables must receive explicit least-privilege grants;
   sequence privileges alone are insufficient. Extend deployment/restore tests.
7. Keep all-board ordering snapshots even under filters, or introduce an explicit
   authoritative revision contract. Never hash only visible tasks against the
   existing all-task backend snapshot. Test hidden cards and cross-project moves.

Migration testing must cover an existing 001–003 database containing historic
255-character titles, categories, done tasks and timestamps; idempotence and
checksum validation; rollback on failure; grants; referential deletion; concurrent
moves and completed/status synchronization. Run only on a dedicated local test
database, with no production or historical-data cleanup.

## Functional UI scope

The first complete V2 slice should include the shell, board/list views, real
project/label/assignee management, assignment filters, search, derived counters,
show-completed switch, per-column quick add, task edit/delete, status actions,
keyboard and pointer movement, form errors, loading and empty states. Sidebar
links must open implemented panels/views; active project selection and filter
state must remain consistent. A profile must use authenticated/configured identity,
not the reference's example person or email.

Calendar, reports, timers and notifications are a separate stage until their
data and interaction contracts exist. Do not render functional-looking tabs,
badges or overflow actions for these absent features. This is an intentional
difference from the screenshot to report during acceptance, as permitted by the
task's rule for additional views. A 'My tasks' filter requires an explicit link
between the authenticated owner and an assignee record; do not infer it from a
name or email.

Suggested responsive behavior: persistent sidebar/four columns on wide desktop;
collapsible sidebar/two columns on tablet; accessible menu, wrapping filters,
stacked columns and full-width dialogs on mobile. Validate touch hit areas,
focus restoration, reduced motion and dragging to offscreen columns in Chromium.

## Login audit and missing source

Tasks currently uses HTTP Basic. In backend/app.js authentication is installed
before API and static files. An anonymous client receives a 401 and native
browser challenge, so an HTML overlay inside the protected frontend cannot
replace the initial challenge by itself. Health/readiness precede auth; CSRF
and payload limits protect the API.

No Workflow login-overlay implementation exists in this repository. Authorized
`session_context_search` for Workflow/login returned no records and
`session_snapshot_policies` returned no approved policies. Workflow is a different
project; the same-project snapshot tools do not authorize its filesystem access.
Supply an approved visual/source export through this Session to audit reusable
styling. No other project directory or secret was accessed.

Until that audit, preserve Basic authentication and describe its visual
limitation. If a custom login page is required, design it with the existing
server security boundary and explicit credential lifecycle; do not add a frontend
password cache, duplicate account database, or cosmetic overlay that exposes the
protected app before authentication.

## Validation and review gates

This audit changes documentation only. `git diff --check`: PASS. Application,
migration and browser tests: SKIPPED for this audit; no V2 implementation exists.
Prior checks for HEAD 387fe85 were frontend 57/57, backend 159/159 and contracts
34/34; these are historical baseline results, not V2 acceptance.

V2 acceptance must build CSS before tests (no missing-CSS skip), run existing
and new API/domain/migration tests, then inspect actual Chromium desktop/mobile
screenshots against this reference. Preserve console errors, CSS/JS failures,
form/filter/move/persistence evidence. Stub tests alone do not satisfy review.
The agent browser tool is available, but no approved V2 app URL/test database or
central release-QA contract has been supplied. Do not use production as the test
target or bypass the port allowlist. No new screenshots or migration execution
are claimed.

Required handoff: Mytko assigns a separate V2 branch to this same Session; supply
the approved Workflow login reference and an isolated app/database preview with
allowed browser port. Then implement and validate the full V2 slice, record its
commit and evidence, and let Mytko create/review the PR. No push, merge or deploy
is authorized here. Production tasks.mytko.dev was not contacted or changed.
