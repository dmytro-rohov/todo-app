const express = require("express");

const { validateCategory, parseId } = require("../validation");

function createCategoriesRouter(pool) {
  const router = express.Router();

  // get
  router.get("/", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT *
        FROM categories
        ORDER BY id ASC
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

    const error = validateCategory(req.body);

    if (error) {
      return res.status(400).json({
        message: error
      });
    }

    try {
      const { name, color } = req.body;

      const result = await pool.query(
        `
        INSERT INTO categories (name, color)
        VALUES ($1, $2)
        RETURNING *
        `,
        [name, color]
      );

      res.status(201).json(result.rows[0]);

    } catch(error) {
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
        message: "Invalid category id"
      });
    }

    try {
      await pool.query(
        `
        DELETE FROM categories
        WHERE id = $1
        `,
        [id]
      );

      res.json({
        message: "Category deleted"
      });

    } catch(error) {
      console.error(error);

      res.status(500).json({
        message: "Server error"
      });
    }
  });

  return router;
}

module.exports = { createCategoriesRouter };
