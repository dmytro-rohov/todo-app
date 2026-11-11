// AI routing of tasks to the Mytko Workflow ToDo (settings "ai.workflow"):
// - "suggest": each new open task in a space visible to agents is looked at once (again after its title or
//   description changes); coding work is marked (ai_coding, ai_reason) and the card offers the send button.
// - "auto": the same, and coding work Claude is sure about is sent at once (workflow_requested_by = "ai").
// Never a private space or a member's task; never with AI or the Workflow connection off; a task that was ever in
// Workflow (sent by a click or by AI, then withdrawn) is not looked at again. A few tasks per run; after an API error (no credit, bad key) it waits before trying again.
const { structured, AiError } = require("./ai");
const { setWorkflow } = require("./routes/tasks");
const { withTransaction } = require("./kit");

const EVERY_MS = 60000;
const PER_RUN = 5;
const BACKOFF_MS = 15 * 60000;
const SURE = 0.7;

// Tasks the routing may look at: the owner's open tasks in spaces visible to agents that were never in Workflow.
// A task once sent (by a click or by AI) and withdrawn stays out for good, also after an edit: the owner decided.
const ELIGIBLE = `t.user_id IS NULL AND t.archived_at IS NULL AND NOT t.completed AND t.planned_at IS NULL
  AND t.workflow_requested_at IS NULL AND t.workflow_ref IS NULL AND t.workflow_requested_by IS NULL
  AND t.space_id IN (SELECT id FROM spaces WHERE agent_visible)
  AND NOT EXISTS (SELECT 1 FROM task_history h WHERE h.task_id = t.id AND h.field = 'workflow')`;

const TOOL = {
  name: "route_task",
  description: "Decide whether the task is coding work for Mytko Workflow's AI coding agents.",
  schema: { type: "object", required: ["coding", "confidence", "reason"], properties: {
    coding: { type: "boolean", description: "true: the work is done by changing code or configuration in a repository (a website, an app, a script, a deployment)" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", description: "One short sentence in Polish, why" }
  } }
};
const SYSTEM = `Jesteś asystentem w Mytko Tasks, liście zadań studia, które robi strony i aplikacje. Mytko Workflow to orkiestrator,
w którym agenci AI (Claude Code, Codex) zmieniają kod w repozytoriach. Oceń jedno zadanie: czy to praca programistyczna dla
Workflow (kod strony lub aplikacji, poprawka błędu, wdrożenie, konfiguracja, skrypt)? NIE są nią: spotkania, telefony, maile,
faktury, wyceny, zakupy, sprawy domowe, pisanie treści bez zmian w kodzie, decyzje. Gdy nie masz pewności, daj niską pewność.`;

async function classify(ai, task, { fetchImpl } = {}) {
  const content = [`Tytuł: ${task.title}`, task.description ? `Opis: ${task.description.slice(0, 3000)}` : "",
    task.project ? `Projekt: ${task.project}` : "", task.client ? `Klient: ${task.client}` : ""].filter(Boolean).join("\n");
  const input = await structured(ai, { system: SYSTEM, content, tool: TOOL, maxTokens: 300, fetchImpl });
  const confidence = Number(input.confidence);
  return {
    coding: input.coding === true,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    reason: (typeof input.reason === "string" ? input.reason.trim() : "").slice(0, 300)
  };
}

function createWorkflowAi(pool, settings, { fetchImpl, everyMs = EVERY_MS, firstRunMs = 30000 } = {}) {
  const status = { lastRunAt: null, lastError: null, checked: 0, sent: 0, pausedUntil: 0, running: null };

  // the switches as they are now: read again before each AI request and after each answer, so turning AI or the
  // Workflow connection off (or routing to manual) stops a pass that is already running. With the connection off
  // routing has no purpose: nothing goes to the AI, and tasks stay unchecked until it is on again.
  const now = async () => ({ ai: await settings.ai(), mode: await settings.workflowMode(), enabled: await settings.workflowEnabled() });
  const stopped = state => (!state.ai ? "ai-off" : state.mode === "manual" ? "manual" : !state.enabled ? "workflow-off" : null);

  async function pass({ limit = PER_RUN, force = false } = {}) {
    let state = await now();
    if (stopped(state)) return { checked: 0, sent: 0, skipped: stopped(state) };
    if (!force && Date.now() < status.pausedUntil) return { checked: 0, sent: 0, skipped: "paused" };
    const candidates = (await pool.query(
      `SELECT t.id FROM tasks t WHERE ${ELIGIBLE} AND t.ai_checked_at IS NULL AND t.updated_at < now() - interval '20 seconds'
       ORDER BY t.updated_at DESC LIMIT $1`, [limit])).rows;
    let checked = 0, sent = 0, failed = false;
    for (const { id } of candidates) {
      state = await now();
      if (stopped(state)) break;
      // read again right before the request: a task moved to a private space (or finished, sent, …) while an earlier
      // answer was pending never reaches the AI
      const task = (await pool.query(
        `SELECT t.id, t.title, t.description, p.name AS project, c.name AS client FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id
         WHERE t.id = $1 AND ${ELIGIBLE} AND t.ai_checked_at IS NULL`, [id])).rows[0];
      if (!task) continue;
      let verdict;
      try {
        verdict = await classify(state.ai, task, { fetchImpl });
      } catch (error) {
        failed = true;
        status.lastError = error instanceof AiError ? error.message : "AI nie odpowiada.";
        status.pausedUntil = Date.now() + BACKOFF_MS;
        if (!(error instanceof AiError)) console.error("task routing failed");
        break;
      }
      state = await now();
      if (stopped(state)) break; // turned off while the AI was answering: its answer is dropped, the task stays unchecked
      checked++;
      const send = state.mode === "auto" && verdict.coding && verdict.confidence >= SURE;
      await withTransaction(pool, async db => {
        // still eligible and untouched since it was read: not edited, finished, archived, planned, moved to a private
        // space or sent/withdrawn by the owner meanwhile (the row is locked from here to the send)
        const fresh = await db.query(
          `UPDATE tasks t SET ai_checked_at = now(), ai_coding = $2, ai_reason = $3 WHERE t.id = $1 AND t.ai_checked_at IS NULL
             AND ${ELIGIBLE} AND t.title = $4 AND t.description IS NOT DISTINCT FROM $5 RETURNING t.id`,
          [task.id, verdict.coding, verdict.reason || null, task.title, task.description]);
        if (!fresh.rowCount || !send) return;
        await setWorkflow(db, task.id, true, "ai", { by: "ai", enabled: state.enabled });
        sent++;
      });
    }
    if (checked && !failed) status.lastError = null;
    Object.assign(status, { lastRunAt: new Date().toISOString(), checked: status.checked + checked, sent: status.sent + sent });
    return { checked, sent };
  }

  const run = options => {
    if (status.running) return status.running;
    status.running = pass(options).catch(() => { console.error("task routing pass failed"); return { checked: 0, sent: 0 }; })
      .finally(() => { status.running = null; });
    return status.running;
  };
  const first = setTimeout(run, firstRunMs);
  const every = setInterval(run, everyMs);
  first.unref(); every.unref();
  return {
    status,
    run,
    // a settings change ends a pause (e.g. credit was added)
    resume() { status.pausedUntil = 0; status.lastError = null; },
    stop() { clearTimeout(first); clearInterval(every); }
  };
}

module.exports = { createWorkflowAi, classify, SURE };
