const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadConfig, ConfigError } = require("../config");

const VALID_URL = "postgres://user:secret@localhost:5432/todo_app";

test("loadConfig fails with a readable error when DATABASE_URL is missing", () => {
  assert.throws(() => loadConfig({}), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /DATABASE_URL/);
    assert.match(error.message, /\.env\.example/);
    return true;
  });
});

test("loadConfig rejects an invalid DATABASE_URL without echoing it", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "not a url secret123" }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.doesNotMatch(error.message, /secret123/);
    return true;
  });
});

test("loadConfig rejects an invalid PORT", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: VALID_URL, PORT: "abc" }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: VALID_URL, PORT: "70000" }), ConfigError);
});

test("loadConfig applies safe defaults", () => {
  assert.deepEqual(loadConfig({ DATABASE_URL: VALID_URL }), {
    databaseUrl: VALID_URL,
    host: "127.0.0.1",
    port: 3000,
    corsOrigin: null
  });
});

test("loadConfig reads optional values", () => {
  const config = loadConfig({
    DATABASE_URL: VALID_URL,
    HOST: "0.0.0.0",
    PORT: "8080",
    CORS_ORIGIN: "http://127.0.0.1:5500"
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.corsOrigin, "http://127.0.0.1:5500");
});

test("server.js exits with code 1 and a clear message without configuration", () => {
  // An empty value is not overridden by backend/.env and counts as missing.
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { PATH: process.env.PATH, DATABASE_URL: "" },
    encoding: "utf8",
    timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Configuration error: Missing required environment variable\(s\): DATABASE_URL/);
});

test("application code contains no hardcoded database password", () => {
  const fs = require("node:fs");
  for (const file of ["db.js", "config.js", "server.js", "app.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /password\s*:/i, `${file} contains a password literal`);
    assert.doesNotMatch(source, /admin123/, `${file} contains the old credential`);
  }
});
