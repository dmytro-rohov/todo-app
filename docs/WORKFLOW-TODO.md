# Mytko Workflow ToDo (C6)

Coding tasks go from Tasks to the **ToDo** tab of Mytko Workflow, and Workflow's progress comes back to the board.
Tasks never calls Workflow: Workflow runs on Fujitsu and asks Tasks while it is on, so Tasks (OVH) stays available on
its own and sent tasks simply wait until Fujitsu is up.

## In Tasks

- The **Workflow button** on a card (a small indigo circle next to the card's action) or **Wyślij do Workflow** in a
  task's panel (owner only; only spaces visible to agents, e.g. Praca; never Prywatne or a
  member's space). AI proposals marked "kod" (Poczta, meeting briefs) are sent at once.
- The card shows where it stands: Czeka na Workflow → W Workflow → Workflow: w realizacji / wymaga uwagi / zrobione.
  Workflow's status is mirrored on the board (todo → ToDo, in_progress → W realizacji, needs_attention → Needs
  review, done → Zakończone), recorded in the history as `workflow`.
- **Wycofaj** withdraws it; Workflow sees `requested: false` and closes its item (`cancelled`).

## Porządek → AI i Workflow (owner only)

- **Mytko Workflow**: whether the connection is active now (Workflow asked within the last 6 minutes; it asks every
  2 minutes while Fujitsu is on) and when it last asked. **Połączenie włączone** off: every Workflow call gets 503,
  the send buttons disappear and nothing can be sent (tasks already there stay, statuses wait).
- **AI** (any provider, `AI.md`): one switch for everything AI does in Tasks (mail proposals, briefs, task routing).
  Off (e.g. no credit left): no call reaches the AI, everything is done by hand.
- **Zadania do Mytko Workflow**:
  - *Ręcznie*: only the button on the card (Praca) and in the task's panel.
  - *AI podpowiada*: the AI looks at each new open task in a space visible to agents once (again after its title or
    description changes); coding work lights up the card's button with the AI's reason. You send it.
  - *AI wysyła sama*: the same, and coding work the AI is sure about (confidence ≥ 0.7) is sent at once, marked
    "AI → Workflow" and `ai` in the history. A task that was ever in Workflow (sent by a click or by AI, then
    withdrawn) is never looked at again. Tasks already marked under *AI podpowiada* stay marked when you switch to
    *AI wysyła sama*; send them with the button.
  - Runs every minute, a few tasks at a time; "Przeanalizuj teraz" runs it at once. After an API error (no credit,
    bad key) it shows the reason and waits 15 minutes (a settings change resumes it). The switches are read again
    before each AI request, and each task is read again right before it is sent to the AI. Turning AI or the
    connection off, choosing *Ręcznie*, or moving a task to a private space takes effect at once, also mid-run. With the
    connection off nothing goes to the AI.
  - Never a private space or a member's task: they never reach the AI or Workflow.

Data: `app_settings` (`ai.enabled`, `ai.workflow`, `workflow.enabled`, `workflow.last_poll_at`) and
`tasks.workflow_requested_by`, `ai_checked_at`, `ai_coding`, `ai_reason` (migration `0011_workflow_ai`).
Tests: `workflow.integration.test.js` ("settings and the AI routing"), `e2e/ui-workflow-ai.mjs` (`AI=1`).

## The API Workflow calls

Bearer token; Tasks keeps only its SHA-256 (`WORKFLOW_TOKEN_SHA256`, 64 hex). Without it the API is off (404).

| Call | |
| --- | --- |
| `GET /api/agent/workflow/tasks` | sent (or withdrawn after being taken) tasks with title, description, status, priority, due date, space, project, client, meeting, e-mail, labels, subtasks, `requestedBy` (`owner` / `ai`), `aiReason`, `link` back to Tasks |
| `POST /api/agent/workflow/tasks/:id` | `{ status: todo / in_progress / needs_attention / done / cancelled, ref?, url? }` |

Token: `openssl rand -base64 32` → keep it in Workflow's settings; in Tasks set
`WORKFLOW_TOKEN_SHA256=$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)`.

Data: `tasks.workflow_*` (migration `0009_workflow`). Tests: `workflow.integration.test.js`, `e2e/ui-workflow.mjs`.
