const express = require("express");
const { validateTaskPatch } = require("../task-domain");

const { parseId, isValidDate, validateTask } = require("../validation");

const TASK_COLUMNS = `
  id,
  title,
  completed,
  TO_CHAR(date, 'YYYY-MM-DD') AS date,
  category_id AS "categoryId", description, status, priority, position,
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
    for (const [key, column, choices] of [["status", "status", ["todo", "in_progress", "done"]], ["priority", "priority", ["P0", "P1", "P2", "P3"]], ["categoryId", "category_id", null]]) {
      if (req.query[key] === undefined) continue;
      if (choices ? !choices.includes(req.query[key]) : parseId(req.query[key]) === null) return res.status(400).json({ message: "Invalid filter" });
      params.push(req.query[key]); conditions.push(`${column} = $${params.length}`);
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

    const extras = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["description","status","priority","dueDate","position"].includes(key)));
    const extraValidation = Object.keys(extras).length ? validateTaskPatch(extras) : { value: {} };
    if (extraValidation.error) return res.status(400).json({ message: extraValidation.error });
    const domain = extraValidation.value;
    try {
      // Domain rules formerly enforced by a database trigger: status wins over completed, completed mirrors
      // status, completed_at follows it, and a task without an explicit position gets its own id.
      const status = value.completed ? "done" : (domain.status || "todo");
      const result = await pool.query(
        `WITH next AS (SELECT nextval(pg_get_serial_sequence('tasks', 'id')) AS id)
        INSERT INTO tasks
        (id, title, completed, date, category_id, description, status, priority, due_date, position, completed_at)
        SELECT next.id, $1::varchar, $2::boolean, $3::date, $4::integer, $5::text, $6::text, $7::text, $8::date,
          COALESCE($9::bigint, next.id), CASE WHEN $2::boolean THEN now() ELSE NULL END
        FROM next
        RETURNING ${TASK_COLUMNS}`,
        [value.title, status === "done", value.date, value.categoryId, domain.description || "", status, domain.priority || "P2", domain.dueDate ?? null, domain.position ?? null]
      );
      res.status(201).json(result.rows[0]);
    } catch (dbError) {
      if (dbError.code === FOREIGN_KEY_VIOLATION) {
        return res.status(400).json({ message: "Category does not exist" });
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
    const columns = { title: "title", description: "description", status: "status", priority: "priority", categoryId: "category_id", dueDate: "due_date", position: "position" };
    const params = [];
    const assignments = Object.entries(value).map(([key, val]) => {
      params.push(val); return `${columns[key]} = $${params.length}`;
    });
    if (value.status !== undefined) {
      params.push(value.status === "done");
      assignments.push(`completed = $${params.length}`);
      assignments.push(value.status === "done" ? "completed_at = COALESCE(completed_at, now())" : "completed_at = NULL");
    }
    params.push(id);
    try {
      const result = await pool.query(`UPDATE tasks SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING ${TASK_COLUMNS}`, params);
      if (!result.rowCount) return res.status(404).json({ message: "Task not found" });
      return res.json(result.rows[0]);
    } catch (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ message: "Category does not exist" });
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
          date = $3,
          category_id = $4,
          status = s.next_status,
          completed = (s.next_status = 'done'),
          completed_at = CASE WHEN s.next_status = 'done' THEN COALESCE(tasks.completed_at, now()) ELSE NULL END,
          updated_at = now()
        FROM (
          SELECT CASE WHEN $2::boolean IS DISTINCT FROM completed
                      THEN CASE WHEN $2::boolean THEN 'done' ELSE 'todo' END
                      ELSE status END AS next_status
          FROM tasks WHERE id = $5
        ) s
        WHERE tasks.id = $5
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
        return res.status(400).json({ message: "Category does not exist" });
      }
      throw dbError;
    }
  });

  return router;
};
