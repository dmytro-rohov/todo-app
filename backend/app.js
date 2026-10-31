const path = require("node:path");
const fs = require("node:fs/promises");
const express = require("express");
const cors = require("cors");

const { createTasksRouter } = require("./routes/tasks");
const { createCategoriesRouter } = require("./routes/categories");

const DEFAULT_FRONTEND_DIR = path.join(__dirname, "..", "frontend");

function createApp({ pool, corsOrigin = null, frontendDir = DEFAULT_FRONTEND_DIR }) {
  if (!pool) {
    throw new Error("createApp requires a database pool");
  }

  const app = express();

  app.disable("x-powered-by");

  // The frontend is served from the same origin, so CORS is only needed when
  // the UI is opened from another origin (e.g. a separate dev server).
  if (corsOrigin) {
    app.use(cors({ origin: corsOrigin }));
  }

  app.use(express.json());

  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch(error) {
      console.error(error);
      res.status(503).json({ status: "error", message: "Database unavailable" });
    }
  });

  app.use("/tasks", createTasksRouter(pool));
  app.use("/categories", createCategoriesRouter(pool));

  // Only the files the browser needs are public: never the whole frontend
  // directory (package.json, tests, node_modules).
  app.get("/", async (req, res, next) => {
    try {
      const index = await fs.readFile(path.join(frontendDir, "index.html"));
      res.type("html").send(index);
    } catch (error) {
      next(error);
    }
  });
  app.use("/js", express.static(path.join(frontendDir, "js"), { fallthrough: false }));
  app.use("/dist", express.static(path.join(frontendDir, "dist"), { fallthrough: false }));

  app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;

    if (status >= 500) {
      console.error(error);
    }

    let message = "Server error";
    if (error.type === "entity.parse.failed") {
      message = "Invalid JSON body";
    } else if (status === 404) {
      message = "Not found";
    } else if (status < 500) {
      message = "Bad request";
    }

    res.status(status).json({ message });
  });

  return app;
}

module.exports = { createApp };
