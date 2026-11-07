const express = require("express");

const createTasksRouter = require("./routes/tasks");
const createCategoriesRouter = require("./routes/categories");
const createSpacesRouter = require("./routes/spaces");
const createProjectsRouter = require("./routes/projects");
const createAssigneesRouter = require("./routes/assignees");
const createArchiveRouter = require("./routes/archive");
const createClientsRouter = require("./routes/clients");
const createBookingRouter = require("./routes/booking");
const createUsersRouter = require("./routes/users");
const createMailRouter = require("./routes/mail");
const { createImapSource, scheduleMailSync } = require("./mail-sync");
const { processGeminiMail } = require("./briefs");
const createBriefsRouter = require("./routes/briefs");
const { createUserStore } = require("./users");
const { OWNER, ownerOnly } = require("./access");
const createTaskDetailsRouter = require("./routes/task-details");
const { createAuthRouter } = require("./routes/auth");
const { createSsoRouter, createWorkflowHealth } = require("./routes/sso");
const { createCalendarRouter, createGoogleCallback } = require("./routes/calendar");
const { createGoogle } = require("./google");
const { createSessionStore, cookieSettings } = require("./sessions");
const { checkSchema } = require("./migrations");
const {
  ownerAuth,
  ownerCredentials,
  csrfProtection,
  rateLimit,
  securityHeaders
} = require("./security");

const READINESS_TIMEOUT_MS = 2000;

// Builds the Express app. `migrationVersions` are the migrations shipped with
// this release; readiness fails until the database has all of them.
function createApp({ config, pool, migrationVersions = [], ...options }) {
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
      console.error("readiness check failed");
      res.status(503).json({ status: "unavailable" });
    }
  });

  const sessions = createSessionStore(pool, { ttlMs: config.auth.sessionTtlMs });
  const cookie = cookieSettings(config.publicOrigin);
  const credentials = config.auth.disabled ? null : ownerCredentials({
    username: config.auth.username,
    passwordHash: config.auth.passwordHash,
    failWindowMs: config.rateLimit.authFailWindowMs,
    failMax: config.rateLimit.authFailMax
  });
  if (credentials) stoppables.push(credentials);

  const api = express.Router();
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const csrf = csrfProtection({ publicOrigin: config.publicOrigin });
  const json = express.json({ limit: "10kb", inflate: false });
  // The login screen's API is reachable without a session; everything after it is not, and anonymous requests are
  // refused before any other processing.
  const sso = config.auth.disabled ? null : config.auth.sso;
  const ssoLogin = sso ? sso.login : "";
  const calendarConfig = config.calendar && config.calendar.key ? config.calendar : null;
  const google = calendarConfig ? createGoogle({ ...calendarConfig, fetchImpl: options.fetchImpl, ...(options.googleUrls || {}) }) : null;
  const calendarRouter = createCalendarRouter(pool, { google, key: calendarConfig?.key, cookie });
  const workflowUp = sso ? createWorkflowHealth(sso, options.fetchImpl) : null;
  const users = createUserStore(pool);
  const authRouter = createAuthRouter({ credentials, sessions, cookie, authDisabled: config.auth.disabled, mytkoLogin: Boolean(sso), ssoLogin, workflowUp,
    users, pool });
  api.use("/auth", csrf, json, authRouter);
  if (credentials) api.use(ownerAuth({ credentials, sessions, cookieName: cookie.name, ssoLogin, users }));
  // With AUTH_DISABLED (local development only) every request is the owner's.
  api.use((req, res, next) => { req.user ??= OWNER; next(); });
  api.use(csrf);
  api.use(json);
  api.use("/tasks", createTasksRouter(pool));
  api.use("/tasks", createTaskDetailsRouter(pool));
  api.use("/categories", createCategoriesRouter(pool));
  api.use("/spaces", createSpacesRouter(pool));
  api.use("/projects", createProjectsRouter(pool));
  api.use("/assignees", createAssigneesRouter(pool));
  api.use("/archive", createArchiveRouter(pool, config.retention));
  // The owner's business tools; member accounts have the task app only.
  api.use("/calendar", ownerOnly, calendarRouter);
  api.use("/clients", ownerOnly, createClientsRouter(pool));
  // Poczta: the mailbox source can be replaced in tests (options.mailSource); the sync runs every few minutes.
  const mailSource = config.mail ? (options.mailSource || createImapSource(config.mail)) : null;
  const mailSync = config.mail ? scheduleMailSync(pool, mailSource, config.mail, { firstRunMs: options.mailFirstRunMs ?? 15000,
    afterSync: () => processGeminiMail(pool, config.ai, { fetchImpl: options.fetchImpl }) }) : null;
  if (mailSync) stoppables.push(mailSync);
  api.use("/mail", ownerOnly, createMailRouter(pool, { mail: config.mail, source: mailSource, sync: mailSync, ai: config.ai, google,
    key: calendarConfig?.key, fetchImpl: options.fetchImpl }));
  api.use("/briefs", ownerOnly, createBriefsRouter(pool, { ai: config.ai, fetchImpl: options.fetchImpl }));
  api.use("/users", ownerOnly, createUsersRouter(pool, { sessions, reserved: [config.auth.username, ssoLogin, "dev", "owner"].filter(Boolean) }));
  api.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });
  // The booking form on mytko.dev: public, before the session-guarded API (routes/booking.js).
  if (google && config.booking) {
    const booking = createBookingRouter(pool, { google, key: calendarConfig.key, settings: config.booking });
    stoppables.push(...booking.stoppables);
    app.use("/api/public/booking", booking);
  }
  app.use("/api", api);

  if (google) {
    const { ownerSession } = require("./security");
    const { readCookie } = require("./sessions");
    const isOwner = async req => config.auth.disabled ||
      ownerSession(await sessions.verify(readCookie(req, cookie.name)), { username: config.auth.username, ssoLogin });
    app.use("/auth/google", createGoogleCallback(pool, { google, key: calendarConfig.key, cookie, pendingCookie: calendarRouter.pendingCookie, isOwner }));
  }

  if (sso) {
    app.use("/auth/mytko", createSsoRouter({ sso, publicOrigin: config.publicOrigin, cookie, startSession: authRouter.startSession, fetchImpl: options.fetchImpl, workflowUp }));
  }

  // The app shell and assets hold no data and render the login screen, so they are public.
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
    if (error.type === "encoding.unsupported") {
      return res.status(415).json({ message: "Compressed request bodies are not supported" });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ message: "Request body too large" });
    }
    console.error("Request failed", req.method);
    res.status(500).json({ message: "Server error" });
  });

  return {
    app,
    calendar: google ? { google, key: calendarConfig.key } : null,
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
