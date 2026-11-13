// Mytko Workflow ToDo against a disposable PostgreSQL: the owner sends tasks (only from spaces visible to agents),
// Workflow reads its queue with a Bearer token and reports statuses, mirrored on the board; withdrawing and cancelling.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { createPool } = require("../kit");
const { runMigrations, listMigrations } = require("../kit");
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
    await owner.query(`DROP TABLE IF EXISTS public.push_log, public.push_subscriptions, public.avatars, public.space_invites, public.space_members, public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts,
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

  // ---- Porządek → AI i Workflow: the connection switch and Claude's routing --------------------------------------
  describe("settings and the AI routing", () => {
    let ai;
    let failClaude = false;
    let failFrom = Infinity; // the n-th request onwards fails
    let hold = null; // a promise the fake API waits for before answering
    const asked = [];
    // a fake Anthropic API: coding work when the title talks about code
    const fakeClaude = async (url, init) => {
      if (!String(url).endsWith("/v1/messages")) return fetch(url, init);
      const body = JSON.parse(init.body);
      asked.push(body.messages[0].content);
      if (hold) await hold;
      if (failClaude || asked.length >= failFrom) return new Response(JSON.stringify({ error: { message: "Your credit balance is too low" } }), { status: 400 });
      const coding = /stron|formularz|kod|wdroż/i.test(body.messages[0].content) && !/domofon/i.test(body.messages[0].content);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "route_task",
        input: { coding, confidence: coding ? 0.9 : 0.95, reason: coding ? "Zmiana w kodzie strony." : "To nie jest praca programistyczna." } }] }), { status: 200 });
    };
    const as = async (url, method = "GET", body) => {
      const res = await ai.request(url, method === "GET" ? {} : { method, headers: SAME_ORIGIN_JSON, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const poll = async () => {
      const res = await ai.request("/api/agent/workflow/tasks", { auth: null, headers: { authorization: `Bearer ${TOKEN}` } });
      return { status: res.status, body: await res.json() };
    };
    // the routing looks only at tasks untouched for 20 s
    const age = () => owner.query("UPDATE tasks SET updated_at = now() - interval '1 minute'");
    let work, priv;

    before(async () => {
      ai = await startApp({ pool: appPool, migrationVersions: VERSIONS,
        env: { WORKFLOW_TOKEN_SHA256: crypto.createHash("sha256").update(TOKEN).digest("hex"), ANTHROPIC_API_KEY: "sk-ant-test-key" },
        appOptions: { fetchImpl: fakeClaude, routingFirstRunMs: 3600000, routingEveryMs: 3600000 } });
      const spaces = (await as("/api/spaces")).body;
      work = spaces.find(s => s.key === "work");
      priv = spaces.find(s => s.key === "private");
    });
    after(() => ai.close());

    test("the state: Workflow's last contact makes the connection active; AI is configured, routing manual by default", async () => {
      assert.equal((await poll()).status, 200);
      const state = (await as("/api/settings")).body;
      assert.equal(state.workflow.configured, true);
      assert.equal(state.workflow.enabled, true);
      assert.equal(state.workflow.active, true);
      assert.ok(Date.now() - Date.parse(state.workflow.lastPollAt) < 60000);
      assert.deepEqual([state.ai.configured, state.ai.enabled, state.ai.workflowMode], [true, true, "manual"]);
      for (const body of [{}, { workflowMode: "always" }, { aiEnabled: "yes" }, { other: true }]) {
        assert.equal((await as("/api/settings", "PATCH", body)).status, 400, JSON.stringify(body));
      }
      // manual: nothing is sent to Claude
      assert.equal((await as("/api/settings/ai/scan", "POST", {})).status, 409);
    });

    test("the connection turned off: Workflow is refused and nothing can be sent", async () => {
      assert.equal((await as("/api/settings", "PATCH", { workflowEnabled: false })).body.workflow.active, false);
      assert.equal((await poll()).status, 503);
      const task = (await as("/api/tasks", "POST", { title: "Poprawić stopkę strony", date: "2026-11-09", spaceId: work.id })).body;
      assert.equal((await as(`/api/tasks/${task.id}`, "PATCH", { workflow: true })).status, 400);
      assert.equal((await as("/api/tasks", "POST", { title: "Też do Workflow", date: "2026-11-09", spaceId: work.id, workflow: true })).status, 400);
      await as("/api/settings", "PATCH", { workflowEnabled: true });
      assert.equal((await poll()).status, 200);
      await as(`/api/tasks/${task.id}`, "DELETE");
    });

    test("AI turned off: no call to Claude", async () => {
      await as("/api/settings", "PATCH", { aiEnabled: false, workflowMode: "auto" });
      assert.equal((await as("/api/settings/ai/scan", "POST", {})).status, 409);
      assert.equal(asked.length, 0);
      await as("/api/settings", "PATCH", { aiEnabled: true, workflowMode: "manual" });
    });

    test("suggest: coding work in Praca is marked, nothing is sent; private and members' tasks are never looked at", async () => {
      const code = (await as("/api/tasks", "POST", { title: "Naprawić formularz kontaktowy na stronie", date: "2026-11-09", spaceId: work.id })).body;
      const call2 = (await as("/api/tasks", "POST", { title: "Zadzwonić do księgowej", date: "2026-11-09", spaceId: work.id })).body;
      const home = (await as("/api/tasks", "POST", { title: "Zmienić kod domofonu na stronie klatki", date: "2026-11-09", spaceId: priv.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "suggest" });
      const run = (await as("/api/settings/ai/scan", "POST", {})).body;
      assert.equal(run.sent, 0);
      const tasks = (await as("/api/tasks")).body;
      const pick = id => tasks.find(t => t.id === id);
      assert.deepEqual([pick(code.id).aiCoding, pick(code.id).aiReason, Boolean(pick(code.id).workflowRequestedAt)], [true, "Zmiana w kodzie strony.", false]);
      assert.equal(pick(call2.id).aiCoding, false);
      assert.equal(pick(home.id).aiCoding, null);
      assert.ok(!asked.some(content => /domofon/.test(content)), "a private task never reaches Claude");
      assert.equal(run.settings.ai.suggested >= 1, true);
      // looked at once: a second pass asks nothing new
      const before = asked.length;
      await as("/api/settings/ai/scan", "POST", {});
      assert.equal(asked.length, before);
      // a new title is looked at again
      await as(`/api/tasks/${call2.id}`, "PATCH", { title: "Zadzwonić do księgowej w sprawie faktury" });
      assert.equal((await as("/api/tasks")).body.find(t => t.id === call2.id).aiCoding, null);
      for (const t of [code, call2, home]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    test("auto: coding work is sent by AI (marked and in the history); a withdrawn task is not sent again", async () => {
      const code = (await as("/api/tasks", "POST", { title: "Wdrożyć nową stronę główną", date: "2026-11-09", spaceId: work.id })).body;
      const meeting = (await as("/api/tasks", "POST", { title: "Spotkanie z klientem", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      const run = (await as("/api/settings/ai/scan", "POST", {})).body;
      assert.equal(run.sent, 1);
      const sent = (await as("/api/tasks")).body.find(t => t.id === code.id);
      assert.deepEqual([Boolean(sent.workflowRequestedAt), sent.workflowRequestedBy, sent.workflowStatus], [true, "ai", "requested"]);
      assert.equal((await as("/api/tasks")).body.find(t => t.id === meeting.id).workflowRequestedAt, null);
      const history = (await as(`/api/tasks/${code.id}/history`)).body.find(h => h.field === "workflow");
      assert.equal(history.actor, "ai");
      const queued = (await poll()).body.tasks.find(t => t.id === code.id);
      assert.deepEqual([queued.requestedBy, queued.aiReason], ["ai", "Zmiana w kodzie strony."]);
      // the owner withdraws it: it stays withdrawn
      await as(`/api/tasks/${code.id}`, "PATCH", { workflow: false });
      await age();
      await as("/api/settings/ai/scan", "POST", {});
      assert.equal((await as("/api/tasks")).body.find(t => t.id === code.id).workflowRequestedAt, null);
      for (const t of [code, meeting]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    // a fake API answer held until release(); resolves once the request reached it
    const holding = () => {
      let release;
      hold = new Promise(resolve => { release = () => { hold = null; resolve(); }; });
      const count = asked.length;
      const reached = (async () => { while (asked.length === count) await new Promise(r => setTimeout(r, 20)); })();
      return { release, reached };
    };

    test("a task once in Workflow (sent by hand, then withdrawn) is never routed, even after an edit", async () => {
      const task = (await as("/api/tasks", "POST", { title: "Poprawić kod formularza", date: "2026-11-09", spaceId: work.id })).body;
      await as(`/api/tasks/${task.id}`, "PATCH", { workflow: true });
      await as(`/api/tasks/${task.id}`, "PATCH", { workflow: false });
      await as(`/api/tasks/${task.id}`, "PATCH", { title: "Poprawić kod formularza kontaktowego" });
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      const before = asked.length;
      await as("/api/settings/ai/scan", "POST", {});
      const after = (await as("/api/tasks")).body.find(t => t.id === task.id);
      assert.deepEqual([after.workflowRequestedAt, after.aiCoding], [null, null]);
      assert.ok(!asked.slice(before).some(content => /formularza kontaktowego/.test(content)), "it never reaches the AI");
      await as(`/api/tasks/${task.id}`, "DELETE");
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
    });

    test("switches changed while the AI answers: routing to manual drops the answer; the connection off sends nothing", async () => {
      const one = (await as("/api/tasks", "POST", { title: "Wdrożyć poprawkę stopki strony", date: "2026-11-09", spaceId: work.id })).body;
      const two = (await as("/api/tasks", "POST", { title: "Wdrożyć poprawkę nagłówka strony", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      let gate = holding();
      const before = asked.length;
      const scan = as("/api/settings/ai/scan", "POST", {});
      await gate.reached;
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
      gate.release();
      assert.deepEqual([(await scan).body.checked, (await scan).body.sent], [0, 0]);
      assert.equal(asked.length, before + 1, "no further request after routing went manual");
      let tasks = (await as("/api/tasks")).body;
      assert.ok([one, two].every(t => !tasks.find(x => x.id === t.id).workflowRequestedAt && tasks.find(x => x.id === t.id).aiCoding === null));

      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      gate = holding();
      const scan2 = as("/api/settings/ai/scan", "POST", {});
      await gate.reached;
      const calls = asked.length;
      await as("/api/settings", "PATCH", { workflowEnabled: false });
      gate.release();
      assert.deepEqual([(await scan2).body.checked, (await scan2).body.sent], [0, 0]);
      assert.equal(asked.length, calls, "no further request with the connection off");
      tasks = (await as("/api/tasks")).body;
      assert.ok([one, two].every(t => !tasks.find(x => x.id === t.id).workflowRequestedAt && tasks.find(x => x.id === t.id).aiCoding === null),
        "nothing sent and nothing marked: the tasks stay for later");
      // with the connection off nothing reaches the AI at all
      assert.equal((await as("/api/settings/ai/scan", "POST", {})).status, 409);
      assert.equal(asked.length, calls);
      // on again: the tasks are looked at and sent
      await as("/api/settings", "PATCH", { workflowEnabled: true });
      assert.equal((await as("/api/settings/ai/scan", "POST", {})).body.sent, 2);
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
      for (const t of [one, two]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    test("a task finished or moved to a private space while the AI answers is not sent", async () => {
      const done = (await as("/api/tasks", "POST", { title: "Wdrożyć nową stronę kontaktu", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      let gate = holding();
      let scan = as("/api/settings/ai/scan", "POST", {});
      await gate.reached;
      await as(`/api/tasks/${done.id}`, "PATCH", { status: "done" });
      gate.release();
      assert.equal((await scan).body.sent, 0);
      assert.equal((await as("/api/tasks")).body.find(t => t.id === done.id).workflowRequestedAt, null);

      const moved = (await as("/api/tasks", "POST", { title: "Wdrożyć stronę o nas", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      gate = holding();
      scan = as("/api/settings/ai/scan", "POST", {});
      await gate.reached;
      await as(`/api/tasks/${moved.id}`, "PATCH", { spaceId: priv.id });
      gate.release();
      assert.equal((await scan).body.sent, 0);
      const after = (await as("/api/tasks")).body.find(t => t.id === moved.id);
      assert.deepEqual([after.workflowRequestedAt, after.aiCoding], [null, null]);
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
      for (const t of [done, moved]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    test("a task moved to a private space while an earlier answer is pending never reaches the AI", async () => {
      const first = (await as("/api/tasks", "POST", { title: "Poprawić kod galerii", date: "2026-11-09", spaceId: work.id })).body;
      const second = (await as("/api/tasks", "POST", { title: "Sekretny kod sejfu na stronie", date: "2026-11-09", spaceId: work.id })).body;
      await owner.query("UPDATE tasks SET updated_at = now() - interval '2 minutes' WHERE id = $1", [first.id]); // asked first
      await owner.query("UPDATE tasks SET updated_at = now() - interval '1 minute' WHERE id = $1", [second.id]);
      await owner.query("UPDATE tasks SET updated_at = now() WHERE id NOT IN ($1, $2)", [first.id, second.id]);
      await as("/api/settings", "PATCH", { workflowMode: "suggest" });
      const gate = holding();
      const scan = as("/api/settings/ai/scan", "POST", {});
      await gate.reached;
      assert.match(asked.at(-1), /galerii|sejfu/);
      const later = /galerii/.test(asked.at(-1)) ? second : first;
      await as(`/api/tasks/${later.id}`, "PATCH", { spaceId: priv.id });
      gate.release();
      await scan;
      const name = later === second ? /sejfu/ : /galerii/;
      assert.equal(asked.filter(content => name.test(content)).length, 0, "the moved task was never sent to the AI");
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
      for (const t of [first, second]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    test("Gemini notes: turning AI off during a batch stops the rest of the batch", async () => {
      const { processGeminiMail } = require("../briefs");
      for (const [uid, title] of [[1, "Strona dla piekarni"], [2, "Sklep dla kwiaciarni"]]) {
        await owner.query(`INSERT INTO mail_messages (uid_validity, uid, from_address, from_name, subject, sent_at, body_text)
          VALUES (1, $1, 'gemini-notes@google.com', 'Gemini', $2, now(), 'Ustalenia: strona z galerią i formularzem.')`, [9000 + uid, `Notes: „${title}”`]);
      }
      const ai = { provider: "anthropic", apiKey: "k", model: "claude-sonnet-5-5", apiBase: "https://api.anthropic.com" };
      let on = true;
      const before = asked.length;
      // the first brief's request turns AI off (as the owner would in Porządek); the second never reaches the AI
      const gemini = async (url, init) => { const answer = await fakeClaude(url, init); on = false; return answer; };
      const briefs = await processGeminiMail(appPool, async () => (on ? ai : null), { fetchImpl: gemini });
      assert.equal(briefs.length, 2);
      assert.equal(asked.length, before + 1, "one request, then AI was off");
      await owner.query("DELETE FROM meeting_briefs; DELETE FROM mail_messages");
    });

    test("sending to Workflow works with a pool of one connection (the switch is read outside the transaction)", async () => {
      const single = createPool({ connectionString: APP_URL, max: 1 });
      const one = await startApp({ pool: single, migrationVersions: VERSIONS,
        env: { WORKFLOW_TOKEN_SHA256: crypto.createHash("sha256").update(TOKEN).digest("hex") } });
      try {
        const res = await one.request("/api/tasks", { method: "POST", headers: SAME_ORIGIN_JSON,
          body: JSON.stringify({ title: "Wysłać przez jedno połączenie", date: "2026-11-09", spaceId: work.id, workflow: true }), signal: AbortSignal.timeout(8000) });
        assert.equal(res.status, 201);
        const task = await res.json();
        const patch = await one.request(`/api/tasks/${task.id}`, { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ workflow: false }),
          signal: AbortSignal.timeout(8000) });
        assert.equal(patch.status, 200);
        const again = await one.request(`/api/tasks/${task.id}`, { method: "PATCH", headers: SAME_ORIGIN_JSON, body: JSON.stringify({ workflow: true }),
          signal: AbortSignal.timeout(8000) });
        assert.equal(again.status, 200);
        await as(`/api/tasks/${task.id}`, "DELETE");
      } finally {
        await one.close();
        await single.end();
      }
    });

    test("an AI error after an answer in the same pass is still shown", async () => {
      const a = (await as("/api/tasks", "POST", { title: "Poprawić kod menu", date: "2026-11-09", spaceId: work.id })).body;
      const b = (await as("/api/tasks", "POST", { title: "Poprawić kod stopki", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "suggest" });
      failFrom = asked.length + 2; // the first request answers, the second fails
      const run = (await as("/api/settings/ai/scan", "POST", {})).body;
      failFrom = Infinity;
      assert.equal(run.checked, 1);
      assert.equal(run.settings.ai.lastError, "Brak środków na koncie API AI.");
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
      for (const t of [a, b]) await as(`/api/tasks/${t.id}`, "DELETE");
    });

    test("Claude failing (no credit): the reason is shown and routing pauses until the settings change", async () => {
      const code = (await as("/api/tasks", "POST", { title: "Poprawić kod koszyka", date: "2026-11-09", spaceId: work.id })).body;
      await age();
      await as("/api/settings", "PATCH", { workflowMode: "auto" });
      failClaude = true;
      const run = (await as("/api/settings/ai/scan", "POST", {})).body;
      assert.equal(run.checked, 0);
      assert.equal(run.settings.ai.lastError, "Brak środków na koncie API AI.");
      assert.ok(run.settings.ai.pausedUntil);
      assert.equal((await as("/api/tasks")).body.find(t => t.id === code.id).aiCoding, null); // tried again later
      failClaude = false;
      const resumed = (await as("/api/settings", "PATCH", { workflowMode: "auto" })).body;
      assert.deepEqual([resumed.ai.lastError, resumed.ai.pausedUntil], [null, null]);
      assert.equal((await as("/api/settings/ai/scan", "POST", {})).body.sent, 1);
      await as("/api/settings", "PATCH", { workflowMode: "manual" });
    });
  });
});
