const express = require("express");
const router = express.Router();

const pool = require("../db");


// helpers
function validateTask(data) {

  if (!data.title) {
    return "Title is required";
  }

  if (data.title.trim().length < 3) {
    return "Title too short";
  }

  if (data.title.length > 100) {
    return "Title too long";
  }

  if (!data.date) {
    return "Date is required";
  }

  return null;
}

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
      completed,
      date,
      categoryId
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
    console.error(error);
    res.status(500).json({
      message: "Server error post method"
    });
  }
});



// delete


// router.delete("/date/:date", (req, res) =>{
//   const date = req.params.date;
//   tasks = tasks.filter(task => task.date !== date)
//   res.json({
//     message: "All tasks deleted"
//   });
// })

router.delete("/:id", async (req, res) => {
  try {

    const id = Number(req.params.id);

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

    console.error(error);

    res.status(500).json({
      message: "Server error"
    });
  }
});


// delete by date

router.delete("/date/:date", async (req, res) => {

  try {

    const date = req.params.date;

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

    console.error(error);

    res.status(500).json({
      message: "Server error"
    });
  }
});

// put

router.put("/:id", async (req, res) => {

  try {

    const id = Number(req.params.id);

    const {
      title,
      completed,
      date,
      categoryId
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

    res.json(result.rows[0]);

  } catch(error) {

    console.error(error);

    res.status(500).json({
      message: "Server error"
    });
  }
});

module.exports = router;