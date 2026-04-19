const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

let tasks = [
  {id: 1, title: "Backend test", completed: false}
];
app.get("/tasks", (req,res) => {
  res.json(tasks);
});

app.listen(3000, () => {
  console.log("Server works at 3000 port");
});