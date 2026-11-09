const express = require("express");
const { MODES } = require("../settings");

// Porządek → "AI i Workflow" (owner only): the Mytko Workflow connection and the AI (any provider, ai/index.js).
// GET reports the state; PATCH changes { workflowEnabled?, aiEnabled?, workflowMode? }; POST /ai/scan runs Claude's
// task routing now (a few tasks).
const ACTIVE_MS = 6 * 60000; // Workflow asks every 2 minutes while Fujitsu is on

module.exports = function createSettingsRouter(pool, { settings, ai, workflow, router: routing }) {
  const router = express.Router();

  async function state() {
    const all = await settings.all();
    const lastPollAt = all["workflow.last_poll_at"] || null;
    const counts = (await pool.query(
      `SELECT count(*) FILTER (WHERE workflow_requested_at IS NOT NULL AND NOT completed)::int AS open,
         count(*) FILTER (WHERE workflow_requested_at IS NOT NULL AND workflow_requested_by = 'ai')::int AS "byAi",
         count(*) FILTER (WHERE ai_coding AND workflow_requested_at IS NULL AND workflow_ref IS NULL AND NOT completed AND archived_at IS NULL)::int AS suggested
       FROM tasks WHERE user_id IS NULL`)).rows[0];
    return {
      workflow: {
        configured: Boolean(workflow), enabled: all["workflow.enabled"] !== "false", lastPollAt,
        active: Boolean(workflow) && all["workflow.enabled"] !== "false" && Boolean(lastPollAt) && Date.now() - Date.parse(lastPollAt) < ACTIVE_MS,
        open: counts.open
      },
      ai: {
        configured: Boolean(ai), provider: ai ? ai.provider : null, label: ai ? ai.label : null, model: ai ? ai.model : null, enabled: all["ai.enabled"] !== "false", workflowMode: await settings.workflowMode(),
        lastRunAt: routing?.status.lastRunAt || null, lastError: routing?.status.lastError || null,
        pausedUntil: routing?.status.pausedUntil > Date.now() ? new Date(routing.status.pausedUntil).toISOString() : null,
        sentByAi: counts.byAi, suggested: counts.suggested
      }
    };
  }

  router.get("/", async (req, res) => res.json(await state()));

  router.patch("/", async (req, res) => {
    const body = req.body;
    const known = ["workflowEnabled", "aiEnabled", "workflowMode"];
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !known.includes(key))) {
      return res.status(400).json({ message: "Invalid settings" });
    }
    for (const key of ["workflowEnabled", "aiEnabled"]) {
      if (key in body && typeof body[key] !== "boolean") return res.status(400).json({ message: `Invalid ${key}` });
    }
    if ("workflowMode" in body && !MODES.includes(body.workflowMode)) return res.status(400).json({ message: "Invalid workflowMode" });
    if ("workflowEnabled" in body) await settings.set("workflow.enabled", body.workflowEnabled);
    if ("aiEnabled" in body) await settings.set("ai.enabled", body.aiEnabled);
    if ("workflowMode" in body) await settings.set("ai.workflow", body.workflowMode);
    routing?.resume();
    res.json(await state());
  });

  router.post("/ai/scan", async (req, res) => {
    if (!(await settings.ai())) return res.status(409).json({ message: "AI is turned off or not configured" });
    if ((await settings.workflowMode()) === "manual") return res.status(409).json({ message: "Task routing is set to manual" });
    if (!(await settings.workflowEnabled())) return res.status(409).json({ message: "The Mytko Workflow connection is turned off" });
    const result = routing ? await routing.run({ limit: 10, force: true }) : { checked: 0, sent: 0 };
    res.json({ ...result, settings: await state() });
  });

  return router;
};
