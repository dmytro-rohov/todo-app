const express = require("express");
const { parseId } = require("../validation");

const MAX_SUBTASKS_PER_TASK = 100;
const COLUMNS = `id, task_id AS "taskId", title, done, position, created_at AS "createdAt", completed_at AS "completedAt"`;

function validateSubtask(body, { partial }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const allowed = ["title", "done", "position"];
  const keys = Object.keys(body);
  if (!keys.length && partial) return { error: "Unknown or empty subtask fields" };
  if (keys.some(key => !allowed.includes(key))) return { error: "Unknown or empty subtask fields" };
  if (!partial && typeof body.title !== "string") return { error: "Title is required" };
  if ("title" in body && (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200)) return { error: "Invalid title" };
  if ("done" in body && typeof body.done !== "boolean") return { error: "Done must be true or false" };
  if ("position" in body && (!Number.isSafeInteger(body.position) || body.position < 0)) return { error: "Invalid position" };
  return { value: { ...body, ...("title" in body ? { title: body.title.trim() } : {}) } };
}

// Mounted twice: /api/tasks/:taskId/subtasks (collection) and /api/subtasks/:id (item).
function createSubtasksRouters(pool) {
  const collection = express.Router({ mergeParams: true });
  const item = express.Router();

  collection.get("/", async (req, res) => {
    const taskId = parseId(req.params.taskId);
    if (taskId === null) return res.status(400).json({ message: "Invalid task id" });
    const task = await pool.query("SELECT 1 FROM public.tasks WHERE id=$1", [taskId]);
    if (!task.rowCount) return res.status(404).json({ message: "Task not found" });
    const result = await pool.query(`SELECT ${COLUMNS} FROM public.task_subtasks WHERE task_id=$1 ORDER BY position, id`, [taskId]);
    res.json(result.rows);
  });

  collection.post("/", async (req, res) => {
    const taskId = parseId(req.params.taskId);
    if (taskId === null) return res.status(400).json({ message: "Invalid task id" });
    const { error, value } = validateSubtask(req.body, { partial: false });
    if (error) return res.status(400).json({ message: error });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise concurrent adds to one task so the cap and the positions stay exact.
      const task = await client.query("SELECT id FROM public.tasks WHERE id=$1 FOR UPDATE", [taskId]);
      if (!task.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Task not found" }); }
      const count = await client.query("SELECT count(*)::int AS n, COALESCE(max(position) + 1, 0)::int AS next FROM public.task_subtasks WHERE task_id=$1", [taskId]);
      if (count.rows[0].n >= MAX_SUBTASKS_PER_TASK) { await client.query("ROLLBACK"); return res.status(409).json({ message: "Too many subtasks" }); }
      const done = value.done === true;
      const created = await client.query(
        `INSERT INTO public.task_subtasks (task_id, title, done, position, completed_at) VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN now() END) RETURNING ${COLUMNS}`,
        [taskId, value.title, done, value.position ?? count.rows[0].next]
      );
      await client.query("COMMIT");
      res.status(201).json(created.rows[0]);
    } catch (error2) {
      await client.query("ROLLBACK").catch(() => {});
      throw error2;
    } finally {
      client.release();
    }
  });

  item.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid subtask id" });
    const { error, value } = validateSubtask(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const columns = { title: "title", position: "position" };
    const params = [];
    const assignments = Object.entries(value).filter(([key]) => key in columns).map(([key, val]) => { params.push(val); return `${columns[key]} = $${params.length}`; });
    if ("done" in value) {
      params.push(value.done);
      assignments.push(`done = $${params.length}`, `completed_at = CASE WHEN $${params.length} THEN COALESCE(completed_at, now()) END`);
    }
    params.push(id);
    const result = await pool.query(`UPDATE public.task_subtasks SET ${assignments.join(", ")} WHERE id=$${params.length} RETURNING ${COLUMNS}`, params);
    if (!result.rowCount) return res.status(404).json({ message: "Subtask not found" });
    res.json(result.rows[0]);
  });

  item.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid subtask id" });
    const result = await pool.query("DELETE FROM public.task_subtasks WHERE id=$1", [id]);
    if (!result.rowCount) return res.status(404).json({ message: "Subtask not found" });
    res.json({ message: "Subtask deleted" });
  });

  return { collection, item };
}

module.exports = { createSubtasksRouters, validateSubtask, MAX_SUBTASKS_PER_TASK };
