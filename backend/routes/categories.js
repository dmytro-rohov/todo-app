const express = require("express");

const { parseId, validateCategory } = require("../validation");
const { userId, own, visibleLabel } = require("../access");

// Labels: each account has its own; labels on tasks in shared spaces are shown to everyone ("mine" false there).
const COLUMNS = `c.id, c.name, c.color, (c.user_id IS NOT DISTINCT FROM $1::integer) AS "mine"`;

module.exports = function createCategoriesRouter(pool) {
  const router = express.Router();

  router.put("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid category id" });
    const { error, value } = validateCategory(req.body);
    if (error) return res.status(400).json({ message: error });
    const result = await pool.query(`UPDATE categories c SET name = $2, color = $3 WHERE c.id = $4 AND ${own("c", "$1::integer")} RETURNING ${COLUMNS}`,
      [userId(req.user), value.name, value.color, id]);
    if (!result.rowCount) return res.status(404).json({ message: "Category not found" });
    res.json(result.rows[0]);
  });

  router.get("/", async (req, res) => {
    const result = await pool.query(`SELECT ${COLUMNS} FROM categories c WHERE ${visibleLabel("c", "$1::integer")} ORDER BY c.id ASC`, [userId(req.user)]);
    res.json(result.rows);
  });

  router.post("/", async (req, res) => {
    const { error, value } = validateCategory(req.body);
    if (error) return res.status(400).json({ message: error });
    const result = await pool.query(`INSERT INTO categories AS c (name, color, user_id) VALUES ($2, $3, $1) RETURNING ${COLUMNS}`,
      [userId(req.user), value.name, value.color]);
    res.status(201).json(result.rows[0]);
  });

  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid category id" });
    const result = await pool.query(`DELETE FROM categories c WHERE c.id = $1 AND ${own("c", "$2::integer")}`, [id, userId(req.user)]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Category not found" });
    res.json({ message: "Category deleted" });
  });

  return router;
};
