const express = require("express");
const cors = require("cors");

const app = express();
const pool = require("./db");

app.use(cors());
app.use(express.json());

const tasksRoutes = require("./routes/tasks");
const categoriesRoutes = require("./routes/categories");

app.use("/tasks", tasksRoutes);
app.use("/categories", categoriesRoutes);

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.log("DB ERROR");
    console.log(err);
  } else {
    console.log("DB CONNECTED");
    console.log(res.rows);
  }
});


app.listen(3000, () => {
  console.log("Server running");
});