// Per-task collections: notes (dated log), subtasks (checklist) and the read-only change history.
const express = require("express");
const { parseId, validateText } = require("../validation");
const { withTransaction } = require("../db");
const { taskChanges, recordTaskChanges } = require("../task-history");
const { statusAssignmentsSql } = require("../task-status");
const { loadTask } = require("./tasks");

const NOTE_COLUMNS = `id, task_id AS "taskId", body, created_at AS "createdAt", updated_at AS "updatedAt"`;
const SUBTASK_COLUMNS = `id, task_id AS "taskId", title, done, position, created_at AS "createdAt", completed_at AS "completedAt"`;
const MAX_NOTE = 5000;
const MAX_SUBTASK_TITLE = 200;
const MAX_SUBTASKS = 100;
const HISTORY_LIMIT = 200;
const TIMER_LOCK_ID = 7243917462;

function isBody(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

module.exports = function createTaskDetailsRouter(pool) {
  const router = express.Router();

  // Resolves :id and makes sure the task exists; 400/404 otherwise.
  router.param("id", (req, res, next, raw) => {
    const id = parseId(raw);
    if (id === null) return res.status(400).json({ message: "Invalid task id" });
    pool.query("SELECT 1 FROM tasks WHERE id = $1", [id]).then(result => {
      if (!result.rowCount) return res.status(404).json({ message: "Task not found" });
      req.taskId = id;
      next();
    }, next);
  });

  const childId = (req, res) => {
    const id = parseId(req.params.childId);
    if (id === null) res.status(400).json({ message: "Invalid id" });
    return id;
  };

  router.get("/:id/history", async (req, res) => {
    const result = await pool.query(
      `SELECT id, field, old_value AS "oldValue", new_value AS "newValue", actor, changed_at AS "changedAt"
       FROM task_history WHERE task_id = $1 ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`, [req.taskId]);
    res.json(result.rows);
  });

  // Timer. Starting one stops any other running timer (one task is worked on at a time) and moves a "to do"
  // task to "in progress". Both return the task.
  router.post("/:id/timer/start", async (req, res) => {
    const task = await withTransaction(pool, async client => {
      // Starts are serialised: otherwise two concurrent starts on different tasks each miss the other's
      // uncommitted timer and both keep running.
      await client.query("SELECT pg_advisory_xact_lock($1)", [TIMER_LOCK_ID]);
      const before = await loadTask(client, req.taskId, { lock: true });
      if (before.status === "done" || before.status === "needs_review") return { conflict: true };
      await client.query("UPDATE task_time_entries SET ended_at = now() WHERE ended_at IS NULL AND task_id <> $1", [req.taskId]);
      await client.query(
        "INSERT INTO task_time_entries (task_id) VALUES ($1) ON CONFLICT (task_id) WHERE ended_at IS NULL DO NOTHING", [req.taskId]);
      if (before.status === "todo" || before.status === "planned") {
        await client.query(`UPDATE tasks SET ${statusAssignmentsSql("$1").join(", ")}, updated_at = now() WHERE id = $2`, ["in_progress", req.taskId]);
      }
      const after = await loadTask(client, req.taskId);
      await recordTaskChanges(client, req.taskId, taskChanges(before, after));
      return after;
    });
    if (task.conflict) return res.status(409).json({ message: "Only open tasks can be timed" });
    res.json(task);
  });

  router.post("/:id/timer/stop", async (req, res) => {
    await pool.query("UPDATE task_time_entries SET ended_at = now() WHERE task_id = $1 AND ended_at IS NULL", [req.taskId]);
    res.json(await loadTask(pool, req.taskId));
  });

  // notes
  router.get("/:id/notes", async (req, res) => {
    const result = await pool.query(`SELECT ${NOTE_COLUMNS} FROM task_notes WHERE task_id = $1 ORDER BY id DESC`, [req.taskId]);
    res.json(result.rows);
  });

  router.post("/:id/notes", async (req, res) => {
    if (!isBody(req.body) || !validateText(req.body.body, { max: MAX_NOTE })) return res.status(400).json({ message: "Invalid note" });
    const result = await pool.query(
      `INSERT INTO task_notes (task_id, body) VALUES ($1, $2) RETURNING ${NOTE_COLUMNS}`, [req.taskId, req.body.body.trim()]);
    res.status(201).json(result.rows[0]);
  });

  router.patch("/:id/notes/:childId", async (req, res) => {
    const id = childId(req, res);
    if (id === null) return;
    if (!isBody(req.body) || !validateText(req.body.body, { max: MAX_NOTE })) return res.status(400).json({ message: "Invalid note" });
    const result = await pool.query(
      `UPDATE task_notes SET body = $1, updated_at = now() WHERE id = $2 AND task_id = $3 RETURNING ${NOTE_COLUMNS}`,
      [req.body.body.trim(), id, req.taskId]);
    if (!result.rowCount) return res.status(404).json({ message: "Note not found" });
    res.json(result.rows[0]);
  });

  router.delete("/:id/notes/:childId", async (req, res) => {
    const id = childId(req, res);
    if (id === null) return;
    const result = await pool.query("DELETE FROM task_notes WHERE id = $1 AND task_id = $2", [id, req.taskId]);
    if (!result.rowCount) return res.status(404).json({ message: "Note not found" });
    res.json({ message: "Note deleted" });
  });

  // subtasks
  router.get("/:id/subtasks", async (req, res) => {
    const result = await pool.query(
      `SELECT ${SUBTASK_COLUMNS} FROM task_subtasks WHERE task_id = $1 ORDER BY position ASC, id ASC`, [req.taskId]);
    res.json(result.rows);
  });

  router.post("/:id/subtasks", async (req, res) => {
    if (!isBody(req.body) || !validateText(req.body.title, { max: MAX_SUBTASK_TITLE })) return res.status(400).json({ message: "Invalid subtask" });
    const result = await pool.query(
      `INSERT INTO task_subtasks (task_id, title, position)
       SELECT $1::integer, $2::varchar, COALESCE(MAX(position) + 1, 0) FROM task_subtasks WHERE task_id = $1
       HAVING COUNT(*) < ${MAX_SUBTASKS}
       RETURNING ${SUBTASK_COLUMNS}`, [req.taskId, req.body.title.trim()]);
    if (!result.rowCount) return res.status(409).json({ message: "Too many subtasks" });
    res.status(201).json(result.rows[0]);
  });

  router.patch("/:id/subtasks/:childId", async (req, res) => {
    const id = childId(req, res);
    if (id === null) return;
    const body = req.body;
    const keys = isBody(body) ? Object.keys(body) : [];
    if (!keys.length || keys.some(key => !["title", "done", "position"].includes(key)) ||
      ("title" in body && !validateText(body.title, { max: MAX_SUBTASK_TITLE })) ||
      ("done" in body && typeof body.done !== "boolean") ||
      ("position" in body && (!Number.isSafeInteger(body.position) || body.position < 0 || body.position > 2147483647))) {
      return res.status(400).json({ message: "Invalid subtask" });
    }
    const params = [];
    const assignments = [];
    if ("title" in body) { params.push(body.title.trim()); assignments.push(`title = $${params.length}`); }
    if ("position" in body) { params.push(body.position); assignments.push(`position = $${params.length}`); }
    if ("done" in body) {
      params.push(body.done);
      assignments.push(`done = $${params.length}`,
        body.done ? "completed_at = COALESCE(completed_at, now())" : "completed_at = NULL");
    }
    params.push(id, req.taskId);
    const result = await pool.query(
      `UPDATE task_subtasks SET ${assignments.join(", ")} WHERE id = $${params.length - 1} AND task_id = $${params.length} RETURNING ${SUBTASK_COLUMNS}`,
      params);
    if (!result.rowCount) return res.status(404).json({ message: "Subtask not found" });
    res.json(result.rows[0]);
  });

  router.delete("/:id/subtasks/:childId", async (req, res) => {
    const id = childId(req, res);
    if (id === null) return;
    const result = await pool.query("DELETE FROM task_subtasks WHERE id = $1 AND task_id = $2", [id, req.taskId]);
    if (!result.rowCount) return res.status(404).json({ message: "Subtask not found" });
    res.json({ message: "Subtask deleted" });
  });

  return router;
};
