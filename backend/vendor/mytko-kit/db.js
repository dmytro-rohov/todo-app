// PostgreSQL: the pool (pg, the app's own dependency, loaded when the pool is made) and transactions.

function createPool({ connectionString, max = 10, statementTimeoutMs = 10000, applicationName = "mytko" }) {
  const { Pool } = require("pg");
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
    console.error("PostgreSQL idle client error:", "connection error");
  });

  return pool;
}

// Runs fn(client) inside one transaction on a dedicated client; rolls back on any error.
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
