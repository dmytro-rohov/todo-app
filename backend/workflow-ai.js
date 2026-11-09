// AI routing of tasks to the Mytko Workflow ToDo (settings "ai.workflow"):
// - "suggest": each new open task in a space visible to agents is looked at once (again after its title or
//   description changes); coding work is marked (ai_coding, ai_reason) and the card offers the send button.
// - "auto": the same, and coding work Claude is sure about is sent at once (workflow_requested_by = "ai").
// Never a private space or a member's task; never with AI or the Workflow connection off; a task the owner withdrew is
// not sent again. A few tasks per run; after an API error (no credit, bad key) it waits before trying again.
const { structured, AiError } = require("./ai");
const { setWorkflow } = require("./routes/tasks");
const { withTransaction } = require("./db");

const EVERY_MS = 60000;
const PER_RUN = 5;
const BACKOFF_MS = 15 * 60000;
const SURE = 0.7;

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

  async function pass({ limit = PER_RUN, force = false } = {}) {
    const ai = await settings.ai();
    const mode = await settings.workflowMode();
    if (!ai || mode === "manual") return { checked: 0, sent: 0, skipped: !ai ? "ai-off" : "manual" };
    if (!force && Date.now() < status.pausedUntil) return { checked: 0, sent: 0, skipped: "paused" };
    const enabled = await settings.workflowEnabled();
    // the owner's open, unsent tasks in spaces visible to agents, not looked at since their last edit
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, p.name AS project, c.name AS client FROM tasks t
       JOIN spaces s ON s.id = t.space_id AND s.agent_visible
       LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.user_id IS NULL AND t.archived_at IS NULL AND NOT t.completed AND t.planned_at IS NULL
         AND t.ai_checked_at IS NULL AND t.workflow_requested_at IS NULL AND t.workflow_ref IS NULL
         AND t.updated_at < now() - interval '20 seconds'
       ORDER BY t.updated_at DESC LIMIT $1`, [limit]);
    let checked = 0, sent = 0;
    for (const task of rows) {
      let verdict;
      try {
        verdict = await classify(ai, task, { fetchImpl });
      } catch (error) {
        status.lastError = error instanceof AiError ? error.message : "AI nie odpowiada.";
        status.pausedUntil = Date.now() + BACKOFF_MS;
        if (!(error instanceof AiError)) console.error("task routing failed");
        break;
      }
      checked++;
      const send = mode === "auto" && enabled && verdict.coding && verdict.confidence >= SURE;
      await withTransaction(pool, async db => {
        // still untouched since it was read (the owner may have edited or sent it meanwhile)
        const fresh = await db.query(
          `UPDATE tasks SET ai_checked_at = now(), ai_coding = $2, ai_reason = $3 WHERE id = $1 AND ai_checked_at IS NULL
             AND workflow_requested_at IS NULL AND title = $4 AND description IS NOT DISTINCT FROM $5 RETURNING id`,
          [task.id, verdict.coding, verdict.reason || null, task.title, task.description]);
        if (!fresh.rowCount || !send) return;
        await setWorkflow(db, task.id, true, "ai", { by: "ai", enabled });
        sent++;
      });
    }
    if (checked) status.lastError = null;
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
