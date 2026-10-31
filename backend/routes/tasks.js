const express = require("express");

const { parseId, isValidDate, validateTask } = require("../validation");

const TASK_COLUMNS = `
  id,
  title,
  completed,
  TO_CHAR(date, 'YYYY-MM-DD') AS date,
  category_id AS "categoryId"
`;

// PostgreSQL foreign_key_violation: category_id points to a missing category.
const FOREIGN_KEY_VIOLATION = "23503";

module.exports = function createTasksRouter(pool) {
  const router = express.Router();

  // get
  router.get("/", async (req, res) => {
    const result = await pool.query(`
      SELECT ${TASK_COLUMNS}
      FROM tasks
      ORDER BY date DESC, id ASC
    `);
    res.json(result.rows);
  });

  // post
  router.post("/", async (req, res) => {
    const { error, value } = validateTask(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    try {
      const result = await pool.query(
        `INSERT INTO tasks
        (title, completed, date, category_id)
        VALUES ($1, $2, $3, $4)
        RETURNING ${TASK_COLUMNS}`,
        [value.title, value.completed, value.date, value.categoryId]
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
        return res.status(400).json({ message: "Category does not exist" });
      }
      throw dbError;
    }
  });

  return router;
};
