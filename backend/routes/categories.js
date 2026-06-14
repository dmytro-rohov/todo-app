const express = require("express");
const router = express.Router();

const pool = require("../db");

function validateCategory(data) {

  if (!data.name) {
    return "Category name is required";
  }

  if (data.name.trim().length < 2) {
    return "Category name too short";
  }

  if (data.name.length > 50) {
    return "Category name too long";
  }

  if (!data.color) {
    return "Color is required";
  }

  return null;
}

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
});

// delete
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);

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
});


module.exports = router;