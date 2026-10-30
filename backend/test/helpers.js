const { createApp } = require("../app");

// In-memory stand-in for pg.Pool: records queries and answers through a
// handler, so HTTP contract tests run without a database.
function createFakePool(handler = () => ({ rows: [] })) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text: text.replace(/\s+/g, " ").trim(), params });
      return handler(text, params);
    }
  };
}

async function startApp(options) {
  const app = createApp(options);
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve(instance);
    });
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

async function sendJson(url, method, body) {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

module.exports = { createFakePool, startApp, sendJson };
