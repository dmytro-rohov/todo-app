const express = require("express");

const { parseId, validateCategory } = require("../validation");

module.exports = function createCategoriesRouter(pool) {
  const router = express.Router();

  // get
  router.get("/", async (req, res) => {
    const result = await pool.query(`
      SELECT id, name, color
      FROM categories
      ORDER BY id ASC
    `);

    res.json(result.rows);
  });

  // post
  router.post("/", async (req, res) => {
    const { error, value } = validateCategory(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const result = await pool.query(
      `
      INSERT INTO categories (name, color)
      VALUES ($1, $2)
      RETURNING id, name, color
      `,
      [value.name, value.color]
    );

    res.status(201).json(result.rows[0]);
  });

  // delete
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ message: "Invalid category id" });
    }

    const result = await pool.query(
      `
      DELETE FROM categories
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.json({ message: "Category deleted" });
  });

  return router;
};
