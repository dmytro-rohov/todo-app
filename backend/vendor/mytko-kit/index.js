// Mytko Kit, backend: every shared module, and bindKit(app), which ties the ones that need to know the app (cookie
// names, the environment prefix, the SSO client id, the database connection name) to it once. An app keeps one file,
// backend/kit.js:
//
//   const { bindKit } = require("./vendor/mytko-kit");
//   module.exports = bindKit({ id: "finance", name: "Mytko Finance", envPrefix: "FINANCE",
//     origin: "https://finance.mytko.dev", backendDir: __dirname });
//
// and requires everything shared from it (require("./kit") / require("../kit")). Express and pg are the app's own
// dependencies: this directory lives in the app's backend/, so they resolve from backend/node_modules.
const security = require("./security");
const sessions = require("./sessions");
const db = require("./db");
const databaseConfig = require("./database-config");
const config = require("./config");
const users = require("./users");
const migrations = require("./migrations");
const migrationGrammar = require("./migration-grammar");
const http = require("./http");
const server = require("./server");
const scripts = require("./scripts");
const auth = require("./routes/auth");
const sso = require("./routes/sso");
const me = require("./routes/me");
const accounts = require("./routes/users");

const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const ENV_PREFIX = /^[A-Z][A-Z0-9_]*$/;

// app: { id: "fitness", name: "Mytko Fitness", envPrefix: "FITNESS", origin: "https://fitness.mytko.dev", backendDir }
// Optional, for an app with its own settings (Tasks): scrypt — the parameters of new password hashes made through the
// bound hashPassword / hashPasswordCli (default: the kit's); migrationLockId — its migration lock (bound runMigrations,
// migrateCli).
function bindKit(app) {
  if (!app || typeof app.id !== "string" || !APP_ID.test(app.id) || typeof app.envPrefix !== "string" || !ENV_PREFIX.test(app.envPrefix) || !app.name || !app.backendDir) {
    throw new Error("bindKit needs { id, name, envPrefix, backendDir } (origin optional)");
  }
  const info = Object.freeze({ id: app.id, name: app.name, envPrefix: app.envPrefix, origin: app.origin || `https://${app.id}.mytko.dev`,
    backendDir: app.backendDir });
  const scrypt = app.scrypt ? Object.freeze({ ...app.scrypt }) : undefined;
  const lockId = app.migrationLockId;
  return {
    app: info,
    ...security,
    ...sessions,
    ...db,
    ...users,
    ...migrations,
    ...migrationGrammar,
    ...http,
    ...auth,
    ...sso,
    ...me,
    ...accounts,
    ...server,
    ...config, // loadSso, toInt, parseTrustProxy (an app with its own configuration, e.g. Tasks); loadConfig bound below
    // bound to the app
    cookieSettings: publicOrigin => sessions.cookieSettings(publicOrigin, info.id),
    createPool: (options = {}) => db.createPool({ applicationName: `mytko-${info.id}`, ...options }),
    loadDatabaseConfig: (env = process.env, options = {}) => databaseConfig.loadDatabaseConfig(env, { ...options, app: info }),
    loadConfig: (env = process.env, options = {}) => config.loadConfig(env, { backendDir: info.backendDir, ...options, app: info }),
    createSsoRouter: options => sso.createSsoRouter({ ...options, appId: info.id }),
    hashPassword: (password, params = scrypt) => security.hashPassword(password, params),
    hashPasswordCli: (options = {}) => scripts.hashPasswordCli({ params: scrypt, ...options }),
    runMigrations: (pool, options = {}) => migrations.runMigrations(pool, { lockId, ...options }),
    revokeSessionsCli: (options = {}) => scripts.revokeSessionsCli({ ...options, app: info }),
    migrateCli: (options = {}) => scripts.migrateCli({ dir: require("node:path").join(info.backendDir, "drizzle"), lockId, ...options, app: info }),
    healthcheckCli: scripts.healthcheckCli
  };
}

module.exports = { bindKit, security, sessions, db, databaseConfig, config, users, migrations, migrationGrammar, http, server, scripts, routes: { auth, sso, me, users: accounts } };
