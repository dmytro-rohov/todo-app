# Mytko Workflow ToDo (C6)

Coding tasks go from Tasks to the **ToDo** tab of Mytko Workflow, and Workflow's progress comes back to the board.
Tasks never calls Workflow: Workflow runs on Fujitsu and asks Tasks while it is on, so Tasks (OVH) stays available on
its own and sent tasks simply wait until Fujitsu is up.

## In Tasks

- **Wyślij do Workflow** in a task's panel (owner only; only spaces visible to agents, e.g. Praca; never Prywatne or a
  member's space). Claude's proposals marked "kod" (Poczta, meeting briefs) are sent at once.
- The card shows where it stands: Czeka na Workflow → W Workflow → Workflow: w realizacji / wymaga uwagi / zrobione.
  Workflow's status is mirrored on the board (todo → ToDo, in_progress → W realizacji, needs_attention → Needs
  review, done → Zakończone), recorded in the history as `workflow`.
- **Wycofaj** withdraws it; Workflow sees `requested: false` and closes its item (`cancelled`).

## The API Workflow calls

Bearer token; Tasks keeps only its SHA-256 (`WORKFLOW_TOKEN_SHA256`, 64 hex). Without it the API is off (404).

| Call | |
| --- | --- |
| `GET /api/agent/workflow/tasks` | sent (or withdrawn after being taken) tasks with title, description, status, priority, due date, space, project, client, meeting, e-mail, labels, subtasks, `link` back to Tasks |
| `POST /api/agent/workflow/tasks/:id` | `{ status: todo / in_progress / needs_attention / done / cancelled, ref?, url? }` |

Token: `openssl rand -base64 32` → keep it in Workflow's settings; in Tasks set
`WORKFLOW_TOKEN_SHA256=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)`.

Data: `tasks.workflow_*` (migration `0009_workflow`). Tests: `workflow.integration.test.js`, `e2e/ui-workflow.mjs`.
