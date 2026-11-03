const express = require("express");
const { withTaskLabels } = require("../task-labels");
const { validateTaskPatch, STATUSES, PRIORITIES } = require("../task-domain");

const { parseId, isValidDate, validateTask } = require("../validation");

const TASK_COLUMNS = `
  id,
  title,
  completed,
  TO_CHAR(date, 'YYYY-MM-DD') AS date,
  ARRAY(SELECT category_id FROM public.task_labels WHERE task_id=tasks.id
    UNION SELECT tasks.category_id WHERE tasks.category_id IS NOT NULL ORDER BY 1) AS "labelIds",
  category_id AS "categoryId", project_id AS "projectId", assignee_id AS "assigneeId", description, status, priority, position,
  TO_CHAR(due_date, 'YYYY-MM-DD') AS "dueDate",
  created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt", archived_at AS "archivedAt"
`;

// PostgreSQL foreign_key_violation: category_id points to a missing category.
const FOREIGN_KEY_VIOLATION = "23503";

module.exports = function createTasksRouter(pool) {
  const router = express.Router();

  router.post("/move", async (req, res) => {
    const result = await require("../ordering").moveTask(pool, req.body);
    res.status(result.status).json({ message: result.message });
  });

  // get
  router.get("/", async (req, res) => {
    const conditions = ["archived_at IS NULL"];
    const params = [];
    for (const [key, column, choices] of [["status", "status", STATUSES], ["priority", "priority", PRIORITIES], ["categoryId", "category_id", null], ["projectId", "project_id", null], ["assigneeId", "assignee_id", null]]) {
      if (req.query[key] === undefined) continue;
      if (choices ? !choices.includes(req.query[key]) : parseId(req.query[key]) === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(req.query[key]);
      conditions.push(key === 'categoryId' ? `(category_id = $${params.length} OR EXISTS (SELECT 1 FROM task_labels WHERE task_id=tasks.id AND category_id=$${params.length}))` : `${column} = $${params.length}`);
    }
    const result = await pool.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY position ASC, id ASC`, params);
    res.json(result.rows);
  });

  // post
  router.post("/", async (req, res) => {
    const { error, value } = validateTask(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const extras = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["description","status","priority","dueDate","position","projectId","assigneeId","labelIds","categoryId"].includes(key)));
    const extraValidation = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
    if (extraValidation.error) return res.status(400).json({ message: extraValidation.error });
    const domain = extraValidation.value;
    try {
      const result = await withTaskLabels(pool, domain.labelIds, db => db.query(
        `INSERT INTO tasks
        (title, completed, date, category_id, description, status, priority, due_date, position, project_id, assignee_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING ${TASK_COLUMNS}`,
        [value.title, value.completed, value.date, domain.labelIds !== undefined ? domain.categoryId : value.categoryId, domain.description || "", domain.status || (value.completed ? "done" : "todo"), domain.priority || "P2", domain.dueDate ?? null, domain.position ?? null, domain.projectId ?? null, domain.assigneeId ?? null]
      ));
      res.status(201).json(result.rows[0]);
    } catch (dbError) {
      if (dbError.code === FOREIGN_KEY_VIOLATION) {
        return res.status(400).json({ message: "Referenced category, project or assignee does not exist" });
      }
      throw dbError;
    }
  });

  // delete
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const result = await pool.query(
      `
      DELETE FROM tasks
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    res.json({ message: "Task deleted" });
  });

  // delete by date
  router.delete("/date/:date", async (req, res) => {
    const date = req.params.date;
    if (!isValidDate(date)) {
      return res.status(400).json({ message: "Date must be YYYY-MM-DD" });
    }

    await pool.query(
      `
      DELETE FROM tasks
      WHERE date = $1
      `,
      [date]
    );

    res.json({ message: "All tasks deleted" });
  });

  // Partial updates do not revalidate unchanged historical titles.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid task id" });
    const { error, value } = validateTaskPatch(req.body);
    if (error) return res.status(400).json({ message: error });
    const columns = { title: "title", description: "description", status: "status", priority: "priority", categoryId: "category_id", dueDate: "due_date", position: "position", projectId: "project_id", assigneeId: "assignee_id" };
    const params = [];
    const assignments = Object.entries(value).filter(([key]) => key !== 'labelIds').map(([key, val]) => {
      params.push(val); return `${columns[key]} = $${params.length}`;
    });
    if (value.status !== undefined) {
      params.push(value.status === "done");
      assignments.push(`completed = $${params.length}`);
      assignments.push(value.status === "done" ? "completed_at = COALESCE(completed_at, now())" : "completed_at = NULL");
    }
    params.push(id);
    try {
      const result = await withTaskLabels(pool, value.labelIds, db => db.query(`UPDATE tasks SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING ${TASK_COLUMNS}`, params));
      if (!result.rowCount) return res.status(404).json({ message: "Task not found" });
      return res.json(result.rows[0]);
    } catch (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ message: "Referenced category, project or assignee does not exist" });
      throw error;
    }
  });

  // put
  router.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const { error, value } = validateTask(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    try {
      const result = await pool.query(
        `
        UPDATE tasks
        SET
          title = $1,
          completed = $2,
          date = $3,
          category_id = $4
        WHERE id = $5
        RETURNING ${TASK_COLUMNS}
        `,
        [value.title, value.completed, value.date, value.categoryId, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(result.rows[0]);
    } catch (dbError) {
      if (dbError.code === FOREIGN_KEY_VIOLATION) {
        return res.status(400).json({ message: "Referenced category, project or assignee does not exist" });
      }
      throw dbError;
    }
  });

  return router;
};
