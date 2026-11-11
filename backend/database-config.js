// The database settings: the kit's database-config.js bound to Tasks (TASKS_ENV, "mytko-tasks-<environment>"). Kept at
// this path for deploy/check-env.cjs, which checks the production env files with Node alone (no node_modules).
module.exports = { loadDatabaseConfig: require("./kit").loadDatabaseConfig };
