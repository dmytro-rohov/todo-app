// Mytko Workflow ToDo against a disposable PostgreSQL: the owner sends tasks (only from spaces visible to agents),
// Workflow reads its queue with a Bearer token and reports statuses, mirrored on the board; withdrawing and cancelling.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON } = require("./support");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);
const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;
const TOKEN = crypto.randomBytes(32).toString("base64url");

describe("Mytko Workflow ToDo", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let ctx;

  before(async () => {
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
    await owner.query(`DROP TABLE IF EXISTS public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts,
      public.auth_sessions, public.task_history, public.task_time_entries, public.task_subtasks, public.task_notes, public.task_labels, public.tasks,
      public.projects, public.spaces, public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: "tasks_app", log: () => {} });
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS,
      env: { WORKFLOW_TOKEN_SHA256: crypto.createHash("sha256").update(TOKEN).digest("hex") } });
  });

  after(async () => {
    await ctx.close();
    await appPool.end();
    await owner.end();
  });

  const call = async (url, method = "GET", body) => {
    const res = await ctx.request(url, method === "GET" ? {} : { method, headers: SAME_ORIGIN_JSON, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const agent = async (url, method = "GET", body, token = TOKEN) => {
    const res = await ctx.request(url, { auth: null, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  test("only tasks from spaces visible to agents go; Workflow sees them with their context", async () => {
    const spaces = (await call("/api/spaces")).body;
    const work = spaces.find(s => s.key === "work");
    const priv = spaces.find(s => s.key === "private");
    const client = (await call("/api/clients", "POST", { name: "Kwiaciarnia Róża" })).body;
    const label = (await call("/api/categories", "POST", { name: "Frontend", color: "#22c55e" })).body;
    const task = (await call("/api/tasks", "POST", { title: "Postawić demo sklepu", date: "2026-11-07", spaceId: work.id, clientId: client.id,
      labelIds: [label.id], description: "Makieta z briefu", priority: "P1", workflow: true })).body;
    assert.equal(Boolean(task.workflowRequestedAt), true);
    assert.equal(task.workflowStatus, "requested");
    await call(`/api/tasks/${task.id}/subtasks`, "POST", { title: "Strona główna" });
    const privateTask = (await call("/api/tasks", "POST", { title: "Prywatne zadanie", date: "2026-11-07", spaceId: priv.id })).body;
    assert.equal((await call(`/api/tasks/${privateTask.id}`, "PATCH", { workflow: true })).status, 400);
    assert.equal((await call("/api/tasks", "POST", { title: "Też prywatne", date: "2026-11-07", spaceId: priv.id, workflow: true })).status, 400);

    assert.equal((await agent("/api/agent/workflow/tasks", "GET", undefined, null)).status, 401);
    assert.equal((await agent("/api/agent/workflow/tasks", "GET", undefined, "x".repeat(40))).status, 401);
    const queue = (await agent("/api/agent/workflow/tasks")).body.tasks;
    assert.deepEqual(queue.map(t => [t.id, t.title, t.space, t.client, t.priority, t.requested, t.ref, t.labels, t.subtasks]),
      [[task.id, "Postawić demo sklepu", "Praca", "Kwiaciarnia Róża", "P1", true, null, ["Frontend"], [{ title: "Strona główna", done: false }]]]);
    assert.equal(queue[0].link, `https://task.mytko.dev/#task-${task.id}`);
    // a session cannot use the agent API and the token cannot use the app
    assert.equal((await call("/api/agent/workflow/tasks")).status, 401);
    assert.equal((await agent("/api/tasks")).status, 401);
  });

  test("Workflow taking a task keeps its column and running timer", async () => {
    const work = (await call("/api/spaces")).body.find(s => s.key === "work");
    const busy = (await call("/api/tasks", "POST", { title: "Już w realizacji", date: "2026-11-07", spaceId: work.id })).body;
    await call(`/api/tasks/${busy.id}/timer/start`, "POST", {});
    await call(`/api/tasks/${busy.id}`, "PATCH", { workflow: true });
    assert.equal((await agent(`/api/agent/workflow/tasks/${busy.id}`, "POST", { status: "todo", ref: "todo-busy" })).status, 200);
    const after = (await call("/api/tasks")).body.find(t => t.id === busy.id);
    assert.deepEqual([after.status, Boolean(after.timerStartedAt), after.workflowRef], ["in_progress", true, "todo-busy"]);
    await agent(`/api/agent/workflow/tasks/${busy.id}`, "POST", { status: "cancelled" });
  });

  test("Workflow's statuses are mirrored on the board and recorded in the history", async () => {
    const [queued] = (await agent("/api/agent/workflow/tasks")).body.tasks;
    const took = await agent(`/api/agent/workflow/tasks/${queued.id}`, "POST", { status: "todo", ref: "todo-1a2b", url: "https://workflow.mytko.dev/todos/todo-1a2b" });
    assert.deepEqual([took.status, took.body.ref, took.body.workflowStatus, took.body.status], [200, "todo-1a2b", "todo", "todo"]);
    for (const [status, board] of [["in_progress", "in_progress"], ["needs_attention", "needs_review"], ["done", "done"]]) {
      assert.equal((await agent(`/api/agent/workflow/tasks/${queued.id}`, "POST", { status })).body.status, board);
      const task = (await call("/api/tasks")).body.find(t => t.id === queued.id);
      assert.deepEqual([task.status, task.workflowStatus, task.workflowUrl], [board, status, "https://workflow.mytko.dev/todos/todo-1a2b"]);
    }
    const history = (await call(`/api/tasks/${queued.id}/history`)).body;
    assert.ok(history.some(h => h.field === "status" && h.newValue === "done" && h.actor === "workflow"));
    for (const body of [{ status: "maybe" }, { status: "todo", ref: "bad ref!" }, { status: "todo", url: "javascript:alert(1)" }, { status: "todo", extra: 1 }]) {
      assert.equal((await agent(`/api/agent/workflow/tasks/${queued.id}`, "POST", body)).status, 400, JSON.stringify(body));
    }
  });

  test("withdrawing tells Workflow; cancelling ends the link; unsent tasks stay out of reach", async () => {
    const [linked] = (await agent("/api/agent/workflow/tasks")).body.tasks;
    assert.equal((await call(`/api/tasks/${linked.id}`, "PATCH", { workflow: false })).body.workflowStatus, "withdrawn");
    const seen = (await agent("/api/agent/workflow/tasks")).body.tasks[0];
    assert.deepEqual([seen.requested, seen.workflowStatus, seen.ref], [false, "withdrawn", "todo-1a2b"]);
    assert.equal((await agent(`/api/agent/workflow/tasks/${linked.id}`, "POST", { status: "cancelled" })).status, 200);
    assert.deepEqual((await agent("/api/agent/workflow/tasks")).body.tasks, []);
    const other = (await call("/api/tasks", "POST", { title: "Nie wysłane", date: "2026-11-07", spaceId: (await call("/api/spaces")).body.find(s => s.key === "work").id })).body;
    assert.equal((await agent(`/api/agent/workflow/tasks/${other.id}`, "POST", { status: "done" })).status, 404);
    // a withdrawn task that was never taken simply leaves the queue
    assert.equal((await call(`/api/tasks/${other.id}`, "PATCH", { workflow: true })).body.workflowStatus, "requested");
    assert.equal((await call(`/api/tasks/${other.id}`, "PATCH", { workflow: false })).body.workflowStatus, null);
    assert.deepEqual((await agent("/api/agent/workflow/tasks")).body.tasks, []);
  });
});
