const { Pool } = require("pg");

function createPool(databaseUrl, options = {}) {
  return new Pool({
    connectionString: databaseUrl,
    ...options
  });
}

module.exports = { createPool };
