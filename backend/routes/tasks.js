const express = require("express");

const { validateTask, isValidDate, parseId } = require("../validation");

function createTasksRouter(pool) {
  const router = express.Router();

  // get
  router.get("/", async (req, res) => {
    try {
      const result = await pool.query(`
      SELECT
        id,
        title,
        completed,
        TO_CHAR(date, 'YYYY-MM-DD') AS date,
        category_id AS "categoryId"
      FROM tasks
      ORDER BY date DESC
        `);
      res.json(result.rows);
    } catch(error) {
      console.error(error);
      res.status(500).json({
        message: "Server error"
      });
    }
  });

  // post
  router.post("/", async (req, res) => {
    const error = validateTask(req.body);

    if (error) {
      return res.status(400).json({
        message: error
      });
    }
    try {
      const {
        title,
        completed = false,
        date,
        categoryId = null
      } = req.body;

      await pool.query(
        `INSERT INTO tasks
        (title, completed, date, category_id)
        VALUES ($1, $2, $3, $4)`,
        [
          title,
          completed,
          date,
          categoryId
        ]
      );
      res.status(201).json({
        message: "Task added"
      });
    } catch(error) {
      if (error.code === "23503") return res.status(400).json({ message: "Unknown category id" });
      console.error(error);
      res.status(500).json({
        message: "Server error post method"
      });
    }
  });

  // delete by date

  router.delete("/date/:date", async (req, res) => {
    const date = req.params.date;

    if (!isValidDate(date)) {
      return res.status(400).json({
        message: "Date must be in YYYY-MM-DD format"
      });
    }

    try {
      await pool.query(
        `
        DELETE FROM tasks
        WHERE date = $1
        `,
        [date]
      );

      res.json({
        message: "All tasks deleted"
      });

    } catch(error) {

      if (error.code === "23503") return res.status(400).json({ message: "Unknown category id" });
      console.error(error);

      res.status(500).json({
        message: "Server error"
      });
    }
  });

  // delete

  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);

    if (id === null) {
      return res.status(400).json({
        message: "Invalid task id"
      });
    }

    try {
      await pool.query(
        `
        DELETE FROM tasks
        WHERE id = $1
        `,
        [id]
      );

      res.json({
        message: "Task deleted"
      });

    } catch(error) {

      if (error.code === "23503") return res.status(400).json({ message: "Unknown category id" });
      console.error(error);

      res.status(500).json({
        message: "Server error"
      });
    }
  });

  // put

  router.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);

    if (id === null) {
      return res.status(400).json({
        message: "Invalid task id"
      });
    }

    // Status-only updates preserve historical titles without revalidating them.
    if (req.body && Object.keys(req.body).length === 1 && typeof req.body.completed === "boolean") {
      try {
        const result = await pool.query("UPDATE tasks SET completed = $1 WHERE id = $2 RETURNING *", [req.body.completed, id]);
        if (!result.rows.length) return res.status(404).json({ message: "Task not found" });
        return res.json(result.rows[0]);
      } catch (error) {
        return res.status(500).json({ message: "Server error" });
      }
    }

    const error = validateTask(req.body);

    if (error) {
      return res.status(400).json({
        message: error
      });
    }

    try {
      const {
        title,
        completed = false,
        date,
        categoryId = null
      } = req.body;

      const result = await pool.query(
        `
        UPDATE tasks
        SET
          title = $1,
          completed = $2,
          date = $3,
          category_id = $4
        WHERE id = $5
        RETURNING *
        `,
        [
          title,
          completed,
          date,
          categoryId,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Task not found"
        });
      }

      res.json(result.rows[0]);

    } catch(error) {

      if (error.code === "23503") return res.status(400).json({ message: "Unknown category id" });
      console.error(error);

      res.status(500).json({
        message: "Server error"
      });
    }
  });

  return router;
}

module.exports = { createTasksRouter };
