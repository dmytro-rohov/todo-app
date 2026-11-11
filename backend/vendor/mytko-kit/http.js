// The parts of an app's Express setup that are the same in every Mytko app: the proxy warning, liveness and readiness,
// the API's 404 and the central error handler. The app assembles them in its own app.js (see the README for the order).
// Express is the app's own dependency, loaded when a router is made (the kit itself loads with Node alone: an app's
// configuration check runs without node_modules).
const loadExpress = () => require("express");
const { checkSchema } = require("./migrations");

const READINESS_TIMEOUT_MS = 2000;

// A proxy that TRUST_PROXY does not name (for example the Docker bridge gateway in front of the container) makes every
// client one address: one rate limit and one login lockout for everybody. Said once, in the log.
function proxyWarning(app, { isProduction }) {
  let warned = false;
  return (req, res, next) => {
    if (!warned && isProduction && req.headers["x-forwarded-for"] && !app.get("trust proxy fn")(req.socket.remoteAddress, 0)) {
      warned = true;
      console.warn(`X-Forwarded-For arrives from ${req.socket.remoteAddress}, which TRUST_PROXY does not trust: all clients share one rate limit and login lockout. Add that address (/32) to TRUST_PROXY.`);
    }
    next();
  };
}

// Liveness (/healthz: the process is up; no dependencies, no details).
function liveness(req, res) {
  res.set("Cache-Control", "no-store").json({ status: "ok" });
}

// Readiness (/readyz: database reachable and every migration shipped with this release applied; never error details,
// connection info or versions). isShuttingDown(): readiness fails while the server drains.
function readiness({ pool, migrationVersions = [], isShuttingDown = () => false }) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (isShuttingDown()) {
      return res.status(503).json({ status: "unavailable" });
    }
    try {
      const ready = await withTimeout(checkSchema(pool, migrationVersions), READINESS_TIMEOUT_MS);
      if (!ready) return res.status(503).json({ status: "unavailable" });
      res.json({ status: "ok" });
    } catch (error) {
      // the code only (e.g. 42501: the app role may not read the migration history — migrate.js ran without APP_DB_ROLE)
      console.error("readiness check failed", error.code || "");
      res.status(503).json({ status: "unavailable" });
    }
  };
}

// Both, mounted before the rate limit (an app that rate-limits readiness mounts liveness and readiness itself).
function healthRoutes(options) {
  const router = loadExpress().Router();
  router.get("/healthz", liveness);
  router.get("/readyz", readiness(options));
  return router;
}

function notFound(req, res) {
  res.status(404).json({ message: "Not found" });
}

// Central error handler: never leaks stack traces or database messages.
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON" });
  }
  if (error.type === "encoding.unsupported") {
    return res.status(415).json({ message: "Compressed request bodies are not supported" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }
  // Two requests waiting for each other (40P01) or a serialization conflict (40001): PostgreSQL rolled one back whole,
  // so trying again is safe.
  if (error.code === "40P01" || error.code === "40001") {
    console.error("Request rolled back by the database (conflict)", req.method);
    return res.status(503).set("Retry-After", "1").json({ message: "Busy, try again" });
  }
  // a request the framework itself refused (e.g. a malformed percent-encoded path): its own 4xx, not a server error
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ message: "Invalid request" });
  }
  console.error("Request failed", req.method);
  res.status(500).json({ message: "Server error" });
}

// The app shell and assets hold no data and render the login screen, so they are public. They are revalidated on every
// load (ETag): unchanged files answer 304, and a release is picked up at once.
function staticFiles(staticDir) {
  return loadExpress().static(staticDir, { index: "index.html", dotfiles: "ignore",
    setHeaders: res => res.set("Cache-Control", "no-cache") });
}

// Every API answer is private.
function noStore(req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { proxyWarning, liveness, readiness, healthRoutes, notFound, errorHandler, staticFiles, noStore, withTimeout, READINESS_TIMEOUT_MS };
