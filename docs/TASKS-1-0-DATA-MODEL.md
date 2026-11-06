# Mytko Tasks 1.0 — data model (stage 1)

Stage 1 of the 1.0 roadmap: the data model and API for spaces, projects, labels, assignees, the four board
statuses, notes, subtasks, time tracking and task history, built on Drizzle. The functionality of the former local branch `feature/tasks-1-0` (kept as
`archive/tasks-1-0`) is ported here without its triggers and raw SQL migrations. The UI is unchanged in this
stage; the new fields are additive, so the current frontend keeps working.

## Model

```
spaces (Praca, Prywatne, own)          categories (= labels)
  └── projects (one client / folder)       │
        └── tasks ── task_labels ──────────┘  (category_id = primary label, task_labels = the others)
              ├── task_notes      dated log, separate from the single editable description
              ├── task_subtasks   checklist
              ├── task_time_entries  work intervals (timer), at most one running per task
              ├── assignee_id     → assignees (records, not login accounts)
              └── task_history    written by the application in the same transaction as the change
```

| Rule | Where |
|---|---|
| The built-in spaces `work` (Praca) and `private` (Prywatne) are created by the application on first use, because a migration may not insert rows. | `backend/spaces.js` |
| A task with no space, or whose space was deleted, is **private**. Only `agentVisible` spaces may ever be shown to integrations or agents; the private space can never be made visible. | `routes/tasks.js`, `routes/spaces.js` |
| A project fixes its task's space. Moving a task to another space drops a project that is not in it; moving a project moves its tasks. Archived projects cannot receive new tasks. | `routes/tasks.js`, `routes/projects.js` |
| Deleting a project keeps its tasks (without the project). Deleting a custom space hands its tasks to the private space and is refused while it still has projects. Built-in spaces cannot be deleted. | `routes/projects.js`, `routes/spaces.js` |
| `labelIds` lists the primary label first; up to 10 distinct labels. Deleting a label removes it from every task. | `routes/tasks.js` |
| Board statuses are `todo`, `in_progress`, `needs_review`, `done`. The status CHECK of `0000` allows only three values and cannot be widened inside Mytko's grammar, so `needs_review` is stored as `in_progress` + `review_requested_at`. All reads, filters and writes go through `task-status.js`; the API only ever shows the four statuses. | `backend/task-status.js` |
| Starting a timer stops any other running timer and moves a `todo` task to `in_progress`. Leaving `in_progress` (PATCH, PUT or a board move) stops it. Done and review tasks cannot be timed. Tasks carry `trackedSeconds` and `timerStartedAt`. | `routes/task-details.js`, `routes/tasks.js` |
| History records creation and changes of title, description, status, priority, date, due date, labels, space, project, assignee and archiving, with actor `owner`. Position changes are not history. A rejected write leaves no history. | `backend/task-history.js` |

## API (all under `/api`, same auth, CSRF and JSON rules as before)

| Method and path | Purpose |
|---|---|
| `GET /tasks?status=&priority=&categoryId=&projectId=&spaceId=&assigneeId=` | Tasks now also carry `spaceId`, `projectId`, `assigneeId`, `labelIds`, `subtaskCount`, `subtaskDoneCount`, `noteCount`, `trackedSeconds`, `timerStartedAt`, `reviewRequestedAt`. `categoryId` matches any label of the task. |
| `POST /tasks`, `PATCH /tasks/:id` | Additionally accept `spaceId`, `projectId`, `labelIds`, `assigneeId` and the status `needs_review`. |
| `POST /tasks/:id/timer/start`, `POST /tasks/:id/timer/stop` | Timer; both return the task. |
| `GET, POST /assignees` · `PATCH, DELETE /assignees/:id` | `name`, `color`. Deleting unassigns the tasks. |
| `GET /tasks/:id/history` | Newest first, at most 200 entries. |
| `GET, POST /tasks/:id/notes` · `PATCH, DELETE /tasks/:id/notes/:noteId` | Notes, `body` 1–5000 characters. |
| `GET, POST /tasks/:id/subtasks` · `PATCH, DELETE /tasks/:id/subtasks/:subtaskId` | Subtasks: `title` 1–200, `done`, `position`; at most 100 per task. |
| `GET, POST /spaces` · `PATCH, DELETE /spaces/:id` | `name`, `color` (`#rrggbb`), `agentVisible`, `position`. |
| `GET /projects?spaceId=&archived=true` · `POST /projects` · `PATCH, DELETE /projects/:id` | `name`, `color`, `spaceId`, `position`, `archived` (PATCH). |

## Migration `0001_tasks_1_0`

Additive only: eight new tables, four nullable columns on `tasks` (`space_id`, `project_id`, `assignee_id`,
`review_requested_at`), foreign keys and
indexes. It is admitted by Mytko's Drizzle grammar (`discover_drizzle` over the full journal, checked
2026-11-05) and guarded in this repository by `backend/test/migration-grammar.test.js`. Existing tasks are not
rewritten; they read as private.

### Release order (operator)

The full 1.0 checklist (with `0002_auth_sessions` from stage 2) is [RELEASE-1.0.md](RELEASE-1.0.md).

1. **Migrate before deploying.** A Mytko release replaces only the `app` container and never migrates, while
   `/readyz` requires every shipped migration. Deploying this image before `0001` (and, from stage 2 on, `0002`)
   is applied makes the new container fail its readiness check.
2. **Grants for the new tables.** `npm run migrate` / the `migrate` container now grants the app role DML on
   *all* tables in `public` (previously only `tasks` and `categories`). If the migration is applied by a path
   that does not run `grantAppRole`, the app role must get the same grants, or the API answers 500 on every
   new endpoint and on task reads.
3. Backup before the migration, as for every release that contains one (PRODUCTION.md §5).

## Not in this stage

* Start date and estimate from `feature/tasks-1-0` (can be added additively later).
* Any UI (stages 4–7).
