const express = require("express");
const { withTransaction } = require("../db");
const { isValidDate, parseId } = require("../validation");
const { userId, own } = require("../access");

// "Cele / Marzenia": goals and dreams for a month or a year, per account. Done items stay in the list (done_at), so a
// month or a year can be looked back on.
const GOAL_COLUMNS = `id, year, month, kind, title, description, to_char(deadline, 'YYYY-MM-DD') AS deadline,
  done_at AS "doneAt", position, created_at AS "createdAt", updated_at AS "updatedAt"`;
const STEP = 1024;
const MAX_ITEMS = 200;

// A period: ?year=2026&month=12 (a month) or ?year=2026 (the whole year).
function parsePeriod(source) {
  const year = Number(source.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return null;
  if (source.month === undefined || source.month === null || source.month === "") return { year, month: null };
  const month = Number(source.month);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? { year, month } : null;
}

function validateGoal(data, { partial = false } = {}) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { error: "Invalid request body" };
  const value = {};
  if ("title" in data || !partial) {
    if (typeof data.title !== "string" || !data.title.trim()) return { error: "Title is required" };
    if (data.title.trim().length > 160) return { error: "Title too long" };
    value.title = data.title.trim();
  }
  if ("description" in data) {
    if (typeof data.description !== "string" || data.description.length > 2000) return { error: "Invalid description" };
    value.description = data.description.trim();
  }
  if ("deadline" in data) {
    if (data.deadline !== null && !isValidDate(data.deadline)) return { error: "Deadline must be YYYY-MM-DD" };
    value.deadline = data.deadline;
  }
  if ("kind" in data) {
    if (!["goal", "dream"].includes(data.kind)) return { error: "Kind must be goal or dream" };
    value.kind = data.kind;
  }
  if ("done" in data) {
    if (typeof data.done !== "boolean") return { error: "Invalid done" };
    value.done = data.done;
  }
  if (partial && !Object.keys(value).length) return { error: "Nothing to change" };
  return { value };
}

module.exports = function createGoalsRouter(pool) {
  const router = express.Router();
  const periodMatch = (alias, yearAt, monthAt) => `${alias}.year = ${yearAt} AND ${alias}.month IS NOT DISTINCT FROM ${monthAt}::integer`;

  router.get("/", async (req, res) => {
    const period = parsePeriod(req.query);
    if (!period) return res.status(400).json({ message: "Invalid period" });
    const result = await pool.query(
      `SELECT ${GOAL_COLUMNS} FROM goals g WHERE ${own("g", "$1::integer")} AND ${periodMatch("g", "$2", "$3")} ORDER BY position ASC, id ASC`,
      [userId(req.user), period.year, period.month]);
    res.json(result.rows);
  });

  // Periods that have a list, newest first, with how much of each was done (for looking back).
  router.get("/periods", async (req, res) => {
    const result = await pool.query(
      `SELECT year, month, count(*)::int AS total, count(done_at)::int AS done,
         count(*) FILTER (WHERE kind = 'dream')::int AS dreams, count(done_at) FILTER (WHERE kind = 'dream')::int AS "dreamsDone"
       FROM goals g WHERE ${own("g", "$1::integer")} GROUP BY year, month ORDER BY year DESC, month DESC NULLS FIRST`, [userId(req.user)]);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const period = parsePeriod(req.body || {});
    if (!period) return res.status(400).json({ message: "Invalid period" });
    const { error, value } = validateGoal(req.body);
    if (error) return res.status(400).json({ message: error });
    const goal = await withTransaction(pool, async client => {
      const user = userId(req.user);
      // one list at a time per account, so two adds never take the same place
      await client.query("SELECT pg_advisory_xact_lock(7243, COALESCE($1::integer, 0))", [user]);
      const { rows: [last] } = await client.query(
        `SELECT count(*)::int AS n, COALESCE(max(position), -${STEP}) AS position FROM goals g WHERE ${own("g", "$1::integer")} AND ${periodMatch("g", "$2", "$3")}`,
        [user, period.year, period.month]);
      if (last.n >= MAX_ITEMS) return null;
      const { rows } = await client.query(
        `INSERT INTO goals (year, month, kind, title, description, deadline, position, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${GOAL_COLUMNS}`,
        [period.year, period.month, value.kind || "goal", value.title, value.description || "", value.deadline ?? null, Number(last.position) + STEP, user]);
      return rows[0];
    });
    if (!goal) return res.status(409).json({ message: `A list holds at most ${MAX_ITEMS} items` });
    res.status(201).json(goal);
  });

  // New order of a list: every id of the period, top to bottom.
  router.put("/order", async (req, res) => {
    const period = parsePeriod(req.body || {});
    const raw = req.body?.ids;
    const ids = Array.isArray(raw) ? raw.map(id => parseId(id)) : [];
    if (!period || !ids.length || ids.length > MAX_ITEMS || ids.includes(null) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ message: "Invalid order" });
    }
    const rows = await withTransaction(pool, async client => {
      const user = userId(req.user);
      const { rows: current } = await client.query(
        `SELECT id FROM goals g WHERE ${own("g", "$1::integer")} AND ${periodMatch("g", "$2", "$3")} FOR UPDATE`, [user, period.year, period.month]);
      const known = new Set(current.map(row => row.id));
      if (current.length !== ids.length || ids.some(id => !known.has(id))) return null;
      await client.query(
        `UPDATE goals SET position = o.ord * $2, updated_at = now() FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord)
         WHERE goals.id = o.id AND ${own("goals", "$3::integer")}`, [ids, STEP, user]);
      return (await client.query(
        `SELECT ${GOAL_COLUMNS} FROM goals g WHERE ${own("g", "$1::integer")} AND ${periodMatch("g", "$2", "$3")} ORDER BY position ASC, id ASC`,
        [user, period.year, period.month])).rows;
    });
    if (!rows) return res.status(409).json({ message: "The list changed; refresh and retry" });
    res.json(rows);
  });

  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid goal id" });
    const { error, value } = validateGoal(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const params = [userId(req.user), id];
    const sets = ["updated_at = now()"];
    for (const key of ["title", "description", "deadline", "kind"]) {
      if (key in value) { params.push(value[key]); sets.push(`${key} = $${params.length}`); }
    }
    if ("done" in value) sets.push(value.done ? "done_at = COALESCE(done_at, now())" : "done_at = NULL");
    const result = await pool.query(
      `UPDATE goals g SET ${sets.join(", ")} WHERE g.id = $2 AND ${own("g", "$1::integer")} RETURNING ${GOAL_COLUMNS}`, params);
    if (!result.rowCount) return res.status(404).json({ message: "Goal not found" });
    res.json(result.rows[0]);
  });

  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid goal id" });
    const result = await pool.query(`DELETE FROM goals g WHERE g.id = $1 AND ${own("g", "$2::integer")}`, [id, userId(req.user)]);
    if (!result.rowCount) return res.status(404).json({ message: "Goal not found" });
    res.json({ message: "Goal deleted" });
  });

  return router;
};

module.exports.parsePeriod = parsePeriod;
module.exports.validateGoal = validateGoal;
