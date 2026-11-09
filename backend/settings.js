// The owner's switches, kept in app_settings and read through a short cache (they are asked on every Workflow poll
// and every AI call):
// - ai.enabled: "true" / "false". Off: Tasks sends nothing to Claude (mail proposals, briefs, task routing).
// - ai.workflow: "manual" | "suggest" | "auto". How tasks reach the Mytko Workflow ToDo besides the button.
// - workflow.enabled: "true" / "false". Off: Workflow's polls are refused and nothing can be sent.
// - workflow.last_poll_at: ISO time of Workflow's last poll (written at most once a minute).
const CACHE_MS = 5000;
const DEFAULTS = { "ai.enabled": "true", "ai.workflow": "manual", "workflow.enabled": "true", "workflow.last_poll_at": "" };
const MODES = ["manual", "suggest", "auto"];

function createSettings(pool, ai) {
  let cache = null;
  let cachedAt = 0;

  async function all() {
    if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
    const { rows } = await pool.query("SELECT key, value FROM app_settings");
    cache = { ...DEFAULTS, ...Object.fromEntries(rows.map(row => [row.key, row.value])) };
    cachedAt = Date.now();
    return cache;
  }

  async function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`unknown setting ${key}`);
    await pool.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, String(value)]);
    cache = null;
  }

  return {
    all,
    set,
    // Claude's settings when AI may be used now, else null
    async ai() {
      if (!ai) return null;
      return (await all())["ai.enabled"] === "false" ? null : ai;
    },
    async workflowEnabled() { return (await all())["workflow.enabled"] !== "false"; },
    async workflowMode() {
      const mode = (await all())["ai.workflow"];
      return MODES.includes(mode) ? mode : "manual";
    },
    async notePoll() {
      const last = Date.parse((await all())["workflow.last_poll_at"]) || 0;
      if (Date.now() - last > 60000) await set("workflow.last_poll_at", new Date().toISOString());
    }
  };
}

module.exports = { createSettings, MODES };
