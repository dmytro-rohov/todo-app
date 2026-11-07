const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { loadConfig } = require("../config");
const { hashPassword, parsePasswordHash, verifyPassword } = require("../security");
const { parseId, isValidDate, validateTask, validateCategory } = require("../validation");
const { listMigrations } = require("../migrations");

const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app@db/tasks",
  AUTH_USERNAME: "owner",
  AUTH_PASSWORD_HASH: "scrypt:1024:8:1:c2FsdA==:aGFzaA==",
  PUBLIC_ORIGIN: "https://task.mytko.dev"
};

describe("local startup contract", () => {
  test("start and dev load backend/.env", () => {
    const scripts = require("../package.json").scripts;
    assert.match(scripts.start, /--env-file-if-exists=\.env/);
    assert.match(scripts.dev, /--env-file-if-exists=\.env/);
  });
});

describe("configuration", () => {
  test("valid production config loads", () => {
    const config = loadConfig(PROD);
    assert.equal(config.isProduction, true);
    assert.equal(config.port, 3000);
    assert.equal(config.trustProxy, false);
  });

  test("production refuses to start without credentials", () => {
    assert.throws(() => loadConfig({ ...PROD, AUTH_PASSWORD_HASH: "" }), /AUTH_USERNAME and AUTH_PASSWORD_HASH/);
    assert.throws(() => loadConfig({ ...PROD, AUTH_USERNAME: "" }), /AUTH_USERNAME and AUTH_PASSWORD_HASH/);
  });

  test("auth can only be disabled outside production", () => {
    assert.throws(() => loadConfig({ ...PROD, AUTH_DISABLED: "true" }), /not allowed/);
    const dev = loadConfig({ DATABASE_URL: "postgres://x/tasks_test", AUTH_DISABLED: "true" });
    assert.equal(dev.auth.disabled, true);
  });

  test("DATABASE_URL and PUBLIC_ORIGIN are required in production", () => {
    assert.throws(() => loadConfig({ ...PROD, DATABASE_URL: "" }), /DATABASE_URL/);
    assert.throws(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: "" }), /PUBLIC_ORIGIN/);
    assert.throws(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: "https://task.mytko.dev/" }), /without path/);
  });

  test("TRUST_PROXY parsing", () => {
    assert.deepEqual(loadConfig({ ...PROD, TRUST_PROXY: "loopback, 172.18.0.1/32" }).trustProxy, ["loopback", "172.18.0.1/32"]);
    assert.equal(loadConfig({ ...PROD, NODE_ENV: "development", TRUST_PROXY: "1" }).trustProxy, 1);
    for (const value of ["true", "1", "uniquelocal", "10.0.0.0/8", "::ffff:10.0.0.0/8", "::/1", "0.0.0.0/0"]) {
      assert.throws(() => loadConfig({ ...PROD, TRUST_PROXY: value }), /Production TRUST_PROXY/);
    }
    assert.deepEqual(loadConfig({ ...PROD, TRUST_PROXY: "::ffff:172.18.0.1/128" }).trustProxy, ["::ffff:172.18.0.1/128"]);
  });

  test("rejects non-numeric limits", () => {
    assert.throws(() => loadConfig({ ...PROD, PORT: "abc" }), /integer/);
  });
});

describe("password hashing", () => {
  test("round trip", async () => {
    const encoded = await hashPassword("a long enough password", { N: 1024, r: 8, p: 1, keyLength: 32 });
    assert.match(encoded, /^scrypt:1024:8:1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    const parsed = parsePasswordHash(encoded);
    assert.equal(await verifyPassword("a long enough password", parsed), true);
    assert.equal(await verifyPassword("a long enough passwore", parsed), false);
  });

  test("salts differ between hashes", async () => {
    const options = { N: 1024, r: 8, p: 1, keyLength: 32 };
    assert.notEqual(await hashPassword("same", options), await hashPassword("same", options));
  });

  test("rejects malformed hashes", () => {
    assert.throws(() => parsePasswordHash("plaintext"), /scrypt:N:r:p:salt:hash/);
  });
});

describe("validation", () => {
  test("parseId", () => {
    assert.equal(parseId("1"), 1);
    assert.equal(parseId("2147483647"), 2147483647);
    for (const bad of ["0", "-1", "1.5", "abc", "", "2147483648", "1e3"]) {
      assert.equal(parseId(bad), null, bad);
    }
  });

  test("isValidDate", () => {
    assert.equal(isValidDate("2026-10-30"), true);
    assert.equal(isValidDate("2024-02-29"), true);
    for (const bad of ["2026-02-30", "2026-13-01", "30-10-2026", "2026-10-30T00:00", 20261030, null]) {
      assert.equal(isValidDate(bad), false, String(bad));
    }
  });

  test("validateTask", () => {
    assert.deepEqual(validateTask({ title: " Abc ", date: "2026-10-30" }).value,
      { title: "Abc", completed: false, date: "2026-10-30", categoryId: null });
    assert.equal(validateTask({ title: "Abc", date: "2026-10-30", categoryId: "7" }).value.categoryId, 7);
    assert.equal(validateTask({ title: "ab", date: "2026-10-30" }).error, "Title too short");
    assert.equal(validateTask({ title: "a".repeat(101), date: "2026-10-30" }).error, "Title too long");
    assert.equal(validateTask({ title: "Abc" }).error, "Date is required");
    assert.equal(validateTask({ title: "Abc", date: "2026-10-30", categoryId: 0 }).error, "Invalid category");
    assert.equal(validateTask(null).error, "Invalid request body");
  });

  test("validateCategory", () => {
    assert.deepEqual(validateCategory({ name: " Dom ", color: "#A855F7" }).value, { name: "Dom", color: "#a855f7" });
    assert.ok(validateCategory({ name: "Dom", color: "#fff" }).error);
    assert.ok(validateCategory({ name: "Dom", color: "javascript:alert(1)" }).error);
    assert.ok(validateCategory({ name: "D", color: "#ffffff" }).error);
  });
});

describe("migrations on disk", () => {
  test("are ordered and checksummed", () => {
    const migrations = listMigrations(path.join(__dirname, "..", "drizzle"));
    assert.deepEqual(migrations.map(m => m.version), ["0000_initial", "0001_tasks_1_0", "0002_auth_sessions", "0003_long_term_plans", "0004_google_calendars", "0005_clients", "0006_accounts", "0007_mail", "0008_briefs", "0009_workflow"]);
    for (const m of migrations) assert.match(m.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(migrations.map(m => m.when).slice().sort((a, b) => a - b), migrations.map(m => m.when));
  });
});

describe("frontend escaping helpers", () => {
  const helpersUrl = pathToFileURL(path.join(__dirname, "..", "..", "frontend", "js", "utils", "helpers.js")).href;

  test("escapeHtml neutralizes markup", async () => {
    const { escapeHtml } = await import(helpersUrl);
    assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`),
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
    assert.equal(escapeHtml(undefined), "");
  });

  test("safeColor only passes #rrggbb", async () => {
    const { safeColor } = await import(helpersUrl);
    assert.equal(safeColor("#4e45e4"), "#4e45e4");
    assert.equal(safeColor("red;background:url(x)"), "#cccccc");
    assert.equal(safeColor(undefined), "#cccccc");
  });
});

describe("configuration rejects malformed password hashes", () => {
  test("plain text password in AUTH_PASSWORD_HASH", () => {
    assert.throws(() => loadConfig({ ...PROD, AUTH_PASSWORD_HASH: "hunter2" }), /scrypt:N:r:p:salt:hash/);
  });
});
