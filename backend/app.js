const express = require("express");

const createTasksRouter = require("./routes/tasks");
const createCategoriesRouter = require("./routes/categories");
const { checkSchema } = require("./migrations");
const {
  basicAuth,
  csrfProtection,
  rateLimit,
  securityHeaders
} = require("./security");

const READINESS_TIMEOUT_MS = 2000;

// Builds the Express app. `migrationVersions` are the migrations shipped with
// this release; readiness fails until the database has all of them.
function createApp({ config, pool, migrationVersions = [] }) {
  const app = express();
  const state = { shuttingDown: false };
  const stoppables = [];

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(securityHeaders({ isProduction: config.isProduction }));

  // Liveness: the process is up. No dependencies, no details.
  app.get("/healthz", (req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok" });
  });

  const limiter = rateLimit(config.rateLimit);
  stoppables.push(limiter);
  app.use(limiter);

  // Readiness: database reachable and schema migrated. Never returns error
  // details, connection info or versions.
  app.get("/readyz", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (state.shuttingDown) {
      return res.status(503).json({ status: "unavailable" });
    }
    try {
      const ready = await withTimeout(checkSchema(pool, migrationVersions), READINESS_TIMEOUT_MS);
      if (!ready) return res.status(503).json({ status: "unavailable" });
      res.json({ status: "ok" });
    } catch (error) {
      console.error("readiness check failed:", error.code || error.message);
      res.status(503).json({ status: "unavailable" });
    }
  });

  if (!config.auth.disabled) {
    const auth = basicAuth({
      username: config.auth.username,
      passwordHash: config.auth.passwordHash,
      failWindowMs: config.rateLimit.authFailWindowMs,
      failMax: config.rateLimit.authFailMax
    });
    stoppables.push(auth);
    app.use(auth);
  }

  const api = express.Router();
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.use(csrfProtection({ publicOrigin: config.publicOrigin }));
  api.use(express.json({ limit: "10kb" }));
  api.use("/tasks", createTasksRouter(pool));
  api.use("/categories", createCategoriesRouter(pool));
  api.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });
  app.use("/api", api);

  app.use(express.static(config.staticDir, { index: "index.html", dotfiles: "ignore" }));

  app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  // Central error handler: never leaks stack traces or database messages.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Invalid JSON" });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ message: "Request body too large" });
    }
    console.error(`${req.method} ${req.path} failed:`, error.code || "", error.message);
    res.status(500).json({ message: "Server error" });
  });

  return {
    app,
    markShuttingDown() {
      state.shuttingDown = true;
    },
    stop() {
      stoppables.forEach(item => item.stop());
    }
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { createApp };
