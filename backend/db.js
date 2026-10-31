const { Pool } = require("pg");

function createPool({ connectionString, max = 10, statementTimeoutMs = 10000, applicationName = "mytko-tasks" }) {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: statementTimeoutMs,
    application_name: applicationName
  });

  // An idle client losing its connection (e.g. PostgreSQL restart) emits an
  // error on the pool. Without a listener this would crash the process; the
  // pool discards the broken client and reconnects on the next query.
  pool.on("error", (error) => {
    console.error("PostgreSQL idle client error:", error.code || error.message);
  });

  return pool;
}

module.exports = { createPool };
