// Runs against a real PostgreSQL only when TEST_DATABASE_URL points to a
// disposable database whose name contains "test". Every run works inside its
// own temporary schema, which is dropped afterwards; existing data and the
// public schema are never touched.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createPool } = require("../db");
const { startApp, sendJson } = require("./helpers");

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function skipReason() {
  if (!TEST_DATABASE_URL) {
    return "TEST_DATABASE_URL not set";
  }
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1));
  } catch {
    return "TEST_DATABASE_URL is not a valid URL";
  }
  if (!/test/i.test(databaseName)) {
    return `refusing to run: database "${databaseName}" does not look like a test database`;
  }
  if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
    return "refusing to run: TEST_DATABASE_URL equals DATABASE_URL";
  }
  return null;
}

const reason = skipReason();

describe("integration (isolated PostgreSQL schema)", { skip: reason || false }, () => {
  const schema = `test_${crypto.randomBytes(6).toString("hex")}`;
  let adminPool;
  let pool;
  let server;

  before(async () => {
    adminPool = createPool(TEST_DATABASE_URL, { max: 1 });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    // Mirrors the table structure from database.sql.
    await adminPool.query(`
      CREATE TABLE ${schema}.categories (
        id serial PRIMARY KEY,
        name varchar(50) NOT NULL,
        color varchar(7) NOT NULL
      );
      CREATE TABLE ${schema}.tasks (
        id serial PRIMARY KEY,
        title varchar(255) NOT NULL,
        completed boolean DEFAULT false,
        date date NOT NULL,
        category_id integer REFERENCES ${schema}.categories(id) ON DELETE SET NULL
      );
    `);

    pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
    server = await startApp({ pool });
  });

  after(async () => {
    if (server) await server.close();
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });

  test("full task and category lifecycle", async () => {
    let res = await sendJson(`${server.url}/categories`, "POST", { name: "Praca", color: "#4e45e4" });
    assert.equal(res.status, 201);
    const category = await res.json();

    res = await sendJson(`${server.url}/tasks`, "POST", {
      title: "Napisać raport", completed: false, date: "2026-10-30", categoryId: category.id
    });
    assert.equal(res.status, 201);

    res = await fetch(`${server.url}/tasks`);
    const tasks = await res.json();
    assert.equal(tasks.length, 1, "a single POST must create exactly one task");
    assert.deepEqual(tasks[0], {
      id: tasks[0].id, title: "Napisać raport", completed: false, date: "2026-10-30", categoryId: category.id
    });

    res = await sendJson(`${server.url}/tasks/${tasks[0].id}`, "PUT", { ...tasks[0], completed: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).completed, true);

    res = await fetch(`${server.url}/categories/${category.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    res = await fetch(`${server.url}/tasks`);
    assert.equal((await res.json())[0].categoryId, null, "deleting a category keeps its tasks");

    res = await fetch(`${server.url}/tasks/date/2026-10-30`, { method: "DELETE" });
    assert.equal(res.status, 200);
    res = await fetch(`${server.url}/tasks`);
    assert.deepEqual(await res.json(), []);
  });

  test("text is stored verbatim (escaping happens at render time)", async () => {
    const title = "<img src=x onerror=alert(1)>";
    await sendJson(`${server.url}/tasks`, "POST", { title, date: "2026-10-31" });
    const res = await fetch(`${server.url}/tasks`);
    assert.equal((await res.json()).find(t => t.date === "2026-10-31").title, title);
  });

  test("unknown category id is reported as a client error", async () => {
    const res = await sendJson(`${server.url}/tasks`, "POST", { title: "Zadanie", date: "2026-10-30", categoryId: 999999 });
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).message, "string");
  });
});
