const express = require("express");

const createTasksRouter = require("./routes/tasks");
const createCategoriesRouter = require("./routes/categories");
const createSpacesRouter = require("./routes/spaces");
const { createAvatarsRouter } = require("./routes/avatars");
const createProjectsRouter = require("./routes/projects");
const createAssigneesRouter = require("./routes/assignees");
const createGoalsRouter = require("./routes/goals");
const createSettingsRouter = require("./routes/settings");
const { createSettings } = require("./settings");
const { createWorkflowAi } = require("./workflow-ai");
const createArchiveRouter = require("./routes/archive");
const createClientsRouter = require("./routes/clients");
const createBookingRouter = require("./routes/booking");
const createUsersRouter = require("./routes/users");
const createAgentRouter = require("./routes/agent");
const createMailRouter = require("./routes/mail");
const { createImapSource, scheduleMailSync } = require("./mail-sync");
const { processGeminiMail } = require("./briefs");
const createBriefsRouter = require("./routes/briefs");
const { createUserStore } = require("./users");
const { OWNER, ownerOnly } = require("./access");
const createTaskDetailsRouter = require("./routes/task-details");
const { createAuthRouter } = require("./routes/auth");
const { createCalendarRouter, createGoogleCallback } = require("./routes/calendar");
const { createGoogle } = require("./google");
const kit = require("./kit");
const {
  ownerAuth,
  ownerCredentials,
  csrfProtection,
  rateLimit,
  securityHeaders
} = require("./security");

// The owner of this instance has no users row: "Zaloguj kontem Mytko" (the kit's routes/sso.js) signs in as the owner
// (user id null) with the Workflow login, and records no last login.
const SSO_OWNER = Object.freeze({ admin: async () => OWNER, recordLogin: async () => {} });

// Builds the Express app. `migrationVersions` are the migrations shipped with
// this release; readiness fails until the database has all of them.
function createApp({ config, pool, migrationVersions = [], ...options }) {
  const app = express();
  const state = { shuttingDown: false };
  const stoppables = [];

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(securityHeaders({ isProduction: config.isProduction }));
  // a proxy TRUST_PROXY does not name makes every client one address: said once, in the log (the kit's http.js)
  app.use(kit.proxyWarning(app, config));

  // Liveness: the process is up. No dependencies, no details.
  app.get("/healthz", kit.liveness);

  // The per-address limit counts the dynamic paths only (/api, /auth: the kit's limitDynamicRoutes) and, as before, the
  // readiness check below (it asks the database); liveness above is exempt. The app shell, its modules and icons never
  // use it up, so reloading the app never runs into it (test/limit.test.js).
  const limiter = rateLimit(config.rateLimit);
  stoppables.push(limiter);
  kit.limitDynamicRoutes(app, limiter, [...kit.LIMITED_PATHS, "/readyz"]);

  // Readiness: database reachable and schema migrated. Never returns error
  // details, connection info or versions.
  app.get("/readyz", kit.readiness({ pool, migrationVersions, isShuttingDown: () => state.shuttingDown }));

  // Sessions in the database (the kit's sessions.js): the owner's have user id null and are capped together at 32, a
  // member's at 8; the table has no sso_login column (a "mytko" session is tied to its Workflow login).
  const sessions = kit.createSessionStore(pool, { ttlMs: config.auth.sessionTtlMs, maxSessions: userId => (userId ? 8 : 32),
    ownerWithoutRow: true, ssoLogin: false });
  const cookie = kit.cookieSettings(config.publicOrigin);
  const credentials = config.auth.disabled ? null : ownerCredentials({
    username: config.auth.username,
    passwordHash: config.auth.passwordHash,
    failWindowMs: config.rateLimit.authFailWindowMs,
    failMax: config.rateLimit.authFailMax
  });
  if (credentials) stoppables.push(credentials);

  const api = express.Router();
  api.use(kit.noStore);
  const csrf = csrfProtection({ publicOrigin: config.publicOrigin });
  const json = express.json({ limit: "10kb", inflate: false });
  // The login screen's API is reachable without a session; everything after it is not, and anonymous requests are
  // refused before any other processing.
  const sso = config.auth.disabled ? null : config.auth.sso;
  const ssoLogin = sso ? sso.login : "";
  const calendarConfig = config.calendar && config.calendar.key ? config.calendar : null;
  const google = calendarConfig ? createGoogle({ ...calendarConfig, fetchImpl: options.fetchImpl, ...(options.googleUrls || {}) }) : null;
  const calendarRouter = createCalendarRouter(pool, { google, key: calendarConfig?.key, cookie });
  const workflowUp = sso ? kit.createWorkflowHealth(sso, options.fetchImpl) : null;
  const users = createUserStore(pool, { dummyLike: credentials ? credentials.passwordHash : null });
  const authRouter = createAuthRouter({ credentials, sessions, cookie, authDisabled: config.auth.disabled, mytkoLogin: Boolean(sso), ssoLogin, workflowUp,
    users, pool });
  api.use("/auth", csrf, json, authRouter);
  if (credentials) api.use(ownerAuth({ credentials, sessions, cookieName: cookie.name, ssoLogin, users }));
  // With AUTH_DISABLED (local development only) every request is the owner's.
  api.use((req, res, next) => { req.user ??= OWNER; next(); });
  api.use(csrf);
  // pictures come as base64 JSON, larger than anything else: their own body limit, before the general one
  api.use("/avatars", express.json({ limit: "200kb", inflate: false }), createAvatarsRouter(pool));
  api.use(json);
  // The owner's switches (AI on/off, task routing, the Workflow connection) and Claude's routing of tasks to Workflow.
  const settings = createSettings(pool, config.ai);
  const routing = config.ai && config.workflow ? createWorkflowAi(pool, settings, { fetchImpl: options.fetchImpl,
    firstRunMs: options.routingFirstRunMs ?? 30000, everyMs: options.routingEveryMs ?? 60000 }) : null;
  if (routing) stoppables.push(routing);
  api.use("/tasks", createTasksRouter(pool, { settings }));
  api.use("/tasks", createTaskDetailsRouter(pool));
  api.use("/categories", createCategoriesRouter(pool));
  api.use("/spaces", createSpacesRouter(pool));
  api.use("/projects", createProjectsRouter(pool));
  api.use("/assignees", createAssigneesRouter(pool));
  api.use("/goals", createGoalsRouter(pool));
  api.use("/archive", createArchiveRouter(pool, config.retention));
  // The owner's business tools; member accounts have the task app only.
  api.use("/calendar", ownerOnly, calendarRouter);
  api.use("/clients", ownerOnly, createClientsRouter(pool));
  // Poczta: the mailbox source can be replaced in tests (options.mailSource); the sync runs every few minutes.
  const mailSource = config.mail ? (options.mailSource || createImapSource(config.mail)) : null;
  const mailSync = config.mail ? scheduleMailSync(pool, mailSource, config.mail, { firstRunMs: options.mailFirstRunMs ?? 15000,
    afterSync: () => processGeminiMail(pool, () => settings.ai(), { fetchImpl: options.fetchImpl }) }) : null;
  if (mailSync) stoppables.push(mailSync);
  api.use("/mail", ownerOnly, createMailRouter(pool, { mail: config.mail, source: mailSource, sync: mailSync, ai: () => settings.ai(), google,
    key: calendarConfig?.key, fetchImpl: options.fetchImpl }));
  api.use("/briefs", ownerOnly, createBriefsRouter(pool, { ai: () => settings.ai(), fetchImpl: options.fetchImpl }));
  api.use("/settings", ownerOnly, createSettingsRouter(pool, { settings, ai: config.ai, workflow: config.workflow, router: routing }));
  api.use("/users", ownerOnly, createUsersRouter(pool, { sessions, reserved: [config.auth.username, ssoLogin, "dev", "owner"].filter(Boolean) }));
  api.use(kit.notFound);
  // Mytko Workflow polls its ToDo with a Bearer token, never a session (routes/agent.js).
  if (config.workflow) {
    app.use("/api/agent", express.json({ limit: "20kb", inflate: false }), createAgentRouter(pool, { ...config.workflow, publicOrigin: config.publicOrigin, settings }));
  }
  // The booking form on mytko.dev: public, before the session-guarded API (routes/booking.js).
  if (google && config.booking) {
    const booking = createBookingRouter(pool, { google, key: calendarConfig.key, settings: config.booking });
    stoppables.push(...booking.stoppables);
    app.use("/api/public/booking", booking);
  }
  app.use("/api", api);

  if (google) {
    const { ownerSession } = require("./security");
    const { readCookie } = kit;
    const isOwner = async req => config.auth.disabled ||
      ownerSession(await sessions.verify(readCookie(req, cookie.name)), { username: config.auth.username, ssoLogin });
    app.use("/auth/google", createGoogleCallback(pool, { google, key: calendarConfig.key, cookie, pendingCookie: calendarRouter.pendingCookie, isOwner }));
  }

  if (sso) {
    // failed code exchanges are limited per visitor (the owner's login guard) and in total, below Workflow's own limit
    const ssoRouter = kit.createSsoRouter({ sso, publicOrigin: config.publicOrigin, cookie, users: SSO_OWNER, guard: credentials,
      startSession: (req, res, account, method, ssoLogin) => authRouter.startSession(req, res, { login: ssoLogin, method }),
      fetchImpl: options.fetchImpl, workflowUp });
    stoppables.push(ssoRouter);
    app.use("/auth/mytko", ssoRouter);
  }

  // The app shell and assets hold no data and render the login screen, so they are public. They are revalidated on
  // every load (ETag): unchanged files answer 304, and a release is picked up at once.
  app.use(kit.staticFiles(config.staticDir));

  app.use(kit.notFound);

  // Central error handler: never leaks stack traces or database messages (the kit's http.js).
  app.use(kit.errorHandler);

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

module.exports = { createApp };
