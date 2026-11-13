// The archive: finished tasks moved out of the board by the retention job (retention.js), until they are deleted.
const express = require("express");
const { withTransaction } = require("../kit");
const { deletionDate } = require("../retention");
const { taskChanges, recordTaskChanges } = require("../task-history");
const { statusAssignmentsSql } = require("../task-status");
const { parseId } = require("../validation");
const { TASK_COLUMNS, loadTask } = require("./tasks");
const { userId, canSeeTask, visibleTask } = require("../access");
const { PRIVATE_SPACES } = require("../spaces");

module.exports = function createArchiveRouter(pool, settings) {
  const router = express.Router();

  // Newest first, each with the date it will be deleted (null = kept).
  router.get("/", async (req, res) => {
    const privateIds = new Set((await pool.query(`SELECT id FROM spaces WHERE id IN ${PRIVATE_SPACES}`)).rows.map(row => row.id));
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE archived_at IS NOT NULL AND ${visibleTask("tasks", "$1::integer")} ORDER BY archived_at DESC, id DESC LIMIT 1000`,
      [userId(req.user)]);
    const tasks = result.rows.map(task => ({
      ...task,
      deleteAt: deletionDate(task.archivedAt, task.spaceId === null || privateIds.has(task.spaceId), settings)
    }));
    res.json({ settings, tasks });
  });

  // Back to the board as an open task at the end of ToDo.
  router.post("/:id/restore", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid task id" });
    const task = await withTransaction(pool, async client => {
      if (!(await canSeeTask(client, req.user, id))) return null;
      const before = await loadTask(client, id, { lock: true });
      if (!before || !before.archivedAt) return null;
      await client.query(
        `UPDATE tasks SET ${statusAssignmentsSql("$1").join(", ")}, archived_at = NULL, updated_at = now(),
           position = (SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE archived_at IS NULL AND status = 'todo')
         WHERE id = $2`, ["todo", id]);
      const after = await loadTask(client, id);
      await recordTaskChanges(client, id, taskChanges(before, after), req.user.actor);
      return after;
    });
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
  });

  return router;
};
