const http = require("node:http");

// Tests only talk to the app on 127.0.0.1. Executors that set
// NODE_USE_ENV_PROXY + HTTP(S)_PROXY without NO_PROXY would otherwise route
// those requests through the proxy (403/405). fetch re-reads NO_PROXY per
// request; node:http's global agent captured the proxy at startup, so replace
// it with a direct one.
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
for (const key of ["NO_PROXY", "no_proxy"]) {
  const current = (process.env[key] || "").split(",").map(s => s.trim()).filter(Boolean);
  process.env[key] = [...new Set([...current, ...LOOPBACK])].join(",");
}
http.globalAgent = new http.Agent({ keepAlive: true });

const { loadConfig } = require("../config");
const { createApp } = require("../app");
const { hashPassword } = require("../security");

const ORIGIN = "https://task.mytko.dev";
const USERNAME = "owner";
const PASSWORD = "correct horse battery staple";
const { listMigrations } = require("../kit");
const MIGRATIONS = listMigrations(require("node:path").join(__dirname, "..", "drizzle")).map(m => m.hash);

// Low scrypt cost keeps tests fast; production hashes use the defaults.
const passwordHashPromise = hashPassword(PASSWORD, { N: 1024, r: 8, p: 1, keyLength: 32 });

function basic(username, password) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

const AUTH = basic(USERNAME, PASSWORD);

// Starts the real Express app on an ephemeral port with the given pool.
async function startApp({ pool, env = {}, migrationVersions = MIGRATIONS, appOptions = {} } = {}) {
  const config = loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://unused@127.0.0.1/unused",
    AUTH_USERNAME: USERNAME,
    AUTH_PASSWORD_HASH: await passwordHashPromise,
    PUBLIC_ORIGIN: ORIGIN,
    ...env
  });
  const instance = createApp({ config, pool, migrationVersions, ...appOptions });
  const server = await new Promise(resolve => {
    const s = instance.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    instance,
    request(path, { auth = AUTH, headers = {}, ...options } = {}) {
      return fetch(url + path, {
        ...options,
        headers: { ...(auth ? { authorization: auth } : {}), ...headers }
      });
    },
    async close() {
      instance.stop();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

// Minimal stand-in for pg.Pool that answers by SQL shape. connect() hands out the same fake as a
// transaction client.
function fakePool(overrides = {}) {
  const pool = {
    async connect() {
      return { query: (sql, params) => pool.query(sql, params), release() {} };
    },
    async query(sql, params = []) {
      for (const [pattern, handler] of Object.entries(overrides)) {
        if (sql.includes(pattern)) return handler(sql, params);
      }
      if (sql.includes("__drizzle_migrations")) {
        return { rows: MIGRATIONS.map(hash => ({ hash })), rowCount: MIGRATIONS.length };
      }
      if (sql.includes("INSERT INTO categories")) {
        return { rows: [{ id: 1, name: params[0], color: params[1] }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO tasks")) {
        return {
          rows: [{ id: 1, title: params[0], completed: params[1], date: params[2], categoryId: params[3] }],
          rowCount: 1
        };
      }
      if (sql.includes("DELETE")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  return pool;
}

const SAME_ORIGIN_JSON = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

module.exports = { startApp, fakePool, basic, AUTH, USERNAME, PASSWORD, ORIGIN, MIGRATIONS, SAME_ORIGIN_JSON, passwordHashPromise };
