const { test, describe, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createFakePool, startApp, sendJson } = require("./helpers");

const TASK_ROW = { id: 1, title: "Kup mleko", completed: false, date: "2026-10-30", categoryId: 2 };
const VALID_TASK = { title: "Kup mleko", completed: false, date: "2026-10-30", categoryId: 2 };

describe("HTTP contract (fake database)", () => {
  let pool;
  let server;
  let respond;

  before(async () => {
    pool = createFakePool((text, params) => respond(text, params));
    server = await startApp({ pool });
  });

  after(() => server.close());

  beforeEach(() => {
    pool.queries.length = 0;
    respond = () => ({ rows: [] });
  });

  describe("GET /tasks", () => {
    test("returns the task list with camelCase categoryId", async () => {
      respond = () => ({ rows: [TASK_ROW] });
      const res = await fetch(`${server.url}/tasks`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /application\/json/);
      assert.deepEqual(await res.json(), [TASK_ROW]);
      assert.match(pool.queries[0].text, /category_id AS "categoryId"/);
    });

    test("returns JSON 500 when the database fails", async () => {
      respond = () => { throw new Error("connection refused"); };
      mock.method(console, "error", () => {});
      const res = await fetch(`${server.url}/tasks`);
      mock.restoreAll();
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { message: "Server error" });
    });
  });

  describe("POST /tasks", () => {
    test("creates a task with a single INSERT and returns 201", async () => {
      const res = await sendJson(`${server.url}/tasks`, "POST", VALID_TASK);
      assert.equal(res.status, 201);
      assert.deepEqual(await res.json(), { message: "Task added" });
      assert.equal(pool.queries.length, 1);
      assert.match(pool.queries[0].text, /^INSERT INTO tasks/);
      assert.deepEqual(pool.queries[0].params, ["Kup mleko", false, "2026-10-30", 2]);
    });

    test("defaults completed and categoryId when omitted", async () => {
      const res = await sendJson(`${server.url}/tasks`, "POST", { title: "Bez kategorii", date: "2026-10-30" });
      assert.equal(res.status, 201);
      assert.deepEqual(pool.queries[0].params, ["Bez kategorii", false, "2026-10-30", null]);
    });

    const invalid = [
      ["missing title", { date: "2026-10-30" }, "Title is required"],
      ["non-string title", { title: 12345, date: "2026-10-30" }, "Title must be a string"],
      ["object title", { title: { a: 1 }, date: "2026-10-30" }, "Title must be a string"],
      ["blank title", { title: "   ", date: "2026-10-30" }, "Title too short"],
      ["short title", { title: "ab", date: "2026-10-30" }, "Title too short"],
      ["long title", { title: "x".repeat(101), date: "2026-10-30" }, "Title too long"],
      ["missing date", { title: "Zadanie" }, "Date is required"],
      ["bad date format", { title: "Zadanie", date: "30.10.2026" }, "Date must be in YYYY-MM-DD format"],
      ["impossible date", { title: "Zadanie", date: "2026-02-31" }, "Date must be in YYYY-MM-DD format"],
      ["non-boolean completed", { title: "Zadanie", date: "2026-10-30", completed: "yes" }, "Completed must be a boolean"],
      ["bad categoryId", { title: "Zadanie", date: "2026-10-30", categoryId: "1; DROP TABLE" }, "Invalid category id"]
    ];

    for (const [name, body, message] of invalid) {
      test(`rejects ${name} with 400 and does not touch the database`, async () => {
        const res = await sendJson(`${server.url}/tasks`, "POST", body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { message });
        assert.equal(pool.queries.length, 0);
      });
    }

    test("rejects a body that is not an object", async () => {
      const res = await sendJson(`${server.url}/tasks`, "POST", "[]");
      assert.equal(res.status, 400);
      assert.equal(pool.queries.length, 0);
    });

    test("rejects malformed JSON with a JSON 400 response", async () => {
      const res = await sendJson(`${server.url}/tasks`, "POST", "{\"title\": ");
      assert.equal(res.status, 400);
      assert.match(res.headers.get("content-type"), /application\/json/);
      assert.deepEqual(await res.json(), { message: "Invalid JSON body" });
    });

    test("rejects a request without a JSON body", async () => {
      const res = await fetch(`${server.url}/tasks`, { method: "POST" });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { message: "Invalid request body" });
    });
  });

  describe("PUT /tasks/:id", () => {
    test("updates and returns the row", async () => {
      respond = () => ({ rows: [{ id: 5, title: "Kup mleko", completed: true, date: "2026-10-30", category_id: 2 }] });
      const res = await sendJson(`${server.url}/tasks/5`, "PUT", { ...VALID_TASK, id: 5, completed: true });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).id, 5);
      assert.deepEqual(pool.queries[0].params, ["Kup mleko", true, "2026-10-30", 2, 5]);
    });

    test("returns 404 for a missing task", async () => {
      const res = await sendJson(`${server.url}/tasks/999`, "PUT", VALID_TASK);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { message: "Task not found" });
    });

    test("returns 400 for a non-numeric id", async () => {
      const res = await sendJson(`${server.url}/tasks/abc`, "PUT", VALID_TASK);
      assert.equal(res.status, 400);
      assert.equal(pool.queries.length, 0);
    });

    test("validates the body", async () => {
      const res = await sendJson(`${server.url}/tasks/5`, "PUT", { title: "", date: "2026-10-30" });
      assert.equal(res.status, 400);
      assert.equal(pool.queries.length, 0);
    });
  });

  describe("DELETE /tasks", () => {
    test("deletes one task by id", async () => {
      const res = await fetch(`${server.url}/tasks/5`, { method: "DELETE" });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { message: "Task deleted" });
      assert.deepEqual(pool.queries[0].params, [5]);
    });

    for (const id of ["abc", "NaN", "0", "-1", "1.5", "99999999999"]) {
      test(`rejects invalid id "${id}" with 400`, async () => {
        const res = await fetch(`${server.url}/tasks/${id}`, { method: "DELETE" });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { message: "Invalid task id" });
        assert.equal(pool.queries.length, 0);
      });
    }

    test("deletes all tasks for a date", async () => {
      const res = await fetch(`${server.url}/tasks/date/2026-10-30`, { method: "DELETE" });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { message: "All tasks deleted" });
      assert.deepEqual(pool.queries[0].params, ["2026-10-30"]);
    });

    test("rejects an invalid date with 400", async () => {
      const res = await fetch(`${server.url}/tasks/date/undefined`, { method: "DELETE" });
      assert.equal(res.status, 400);
      assert.equal(pool.queries.length, 0);
    });
  });

  describe("/categories", () => {
    test("GET returns categories", async () => {
      respond = () => ({ rows: [{ id: 1, name: "Praca", color: "#4e45e4" }] });
      const res = await fetch(`${server.url}/categories`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), [{ id: 1, name: "Praca", color: "#4e45e4" }]);
    });

    test("POST creates a category and returns the row", async () => {
      respond = (text, params) => ({ rows: [{ id: 3, name: params[0], color: params[1] }] });
      const res = await sendJson(`${server.url}/categories`, "POST", { name: "Dom", color: "#22c55e" });
      assert.equal(res.status, 201);
      assert.deepEqual(await res.json(), { id: 3, name: "Dom", color: "#22c55e" });
    });

    const invalid = [
      ["missing name", { color: "#22c55e" }, "Category name is required"],
      ["non-string name", { name: 5, color: "#22c55e" }, "Category name must be a string"],
      ["short name", { name: "a", color: "#22c55e" }, "Category name too short"],
      ["long name", { name: "x".repeat(51), color: "#22c55e" }, "Category name too long"],
      ["missing color", { name: "Dom" }, "Color is required"],
      ["CSS injection color", { name: "Dom", color: "red;}" }, "Color must be a hex value like #4e45e4"]
    ];

    for (const [name, body, message] of invalid) {
      test(`POST rejects ${name} with 400`, async () => {
        const res = await sendJson(`${server.url}/categories`, "POST", body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { message });
        assert.equal(pool.queries.length, 0);
      });
    }

    test("POST returns JSON 500 when the database fails", async () => {
      respond = () => { throw new Error("db down"); };
      mock.method(console, "error", () => {});
      const res = await sendJson(`${server.url}/categories`, "POST", { name: "Dom", color: "#22c55e" });
      mock.restoreAll();
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { message: "Server error" });
    });

    test("DELETE removes a category", async () => {
      const res = await fetch(`${server.url}/categories/3`, { method: "DELETE" });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { message: "Category deleted" });
    });

    test("DELETE rejects an invalid id", async () => {
      const res = await fetch(`${server.url}/categories/NaN`, { method: "DELETE" });
      assert.equal(res.status, 400);
      assert.equal(pool.queries.length, 0);
    });
  });

  describe("infrastructure", () => {
    test("unknown routes return JSON 404", async () => {
      const res = await fetch(`${server.url}/nope`);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { message: "Not found" });
    });

    test("GET /health reports database availability", async () => {
      let res = await fetch(`${server.url}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: "ok" });

      respond = () => { throw new Error("down"); };
      mock.method(console, "error", () => {});
      res = await fetch(`${server.url}/health`);
      mock.restoreAll();
      assert.equal(res.status, 503);
    });

    test("CORS is disabled by default", async () => {
      const res = await fetch(`${server.url}/tasks`, { headers: { Origin: "http://evil.example" } });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    });

    test("x-powered-by is not exposed", async () => {
      const res = await fetch(`${server.url}/tasks`);
      assert.equal(res.headers.get("x-powered-by"), null);
    });
  });
});

describe("CORS opt-in", () => {
  test("allows only the configured origin", async () => {
    const server = await startApp({ pool: createFakePool(), corsOrigin: "http://127.0.0.1:5500" });
    try {
      const res = await fetch(`${server.url}/tasks`, { headers: { Origin: "http://127.0.0.1:5500" } });
      assert.equal(res.headers.get("access-control-allow-origin"), "http://127.0.0.1:5500");
    } finally {
      await server.close();
    }
  });
});

describe("frontend assets", () => {
  const frontendDir = path.join(__dirname, "..", "..", "frontend");
  let server;

  before(async () => {
    server = await startApp({ pool: createFakePool() });
  });

  after(() => server.close());

  test("GET / serves index.html", async () => {
    const res = await fetch(`${server.url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /<script type="module" src="\.\/js\/main\.js">/);
  });

  test("ES modules are served with a JavaScript MIME type", async () => {
    for (const file of ["main.js", "api/http.js", "utils/helpers.js", "actions/tasks.js"]) {
      const res = await fetch(`${server.url}/js/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get("content-type"), /javascript/, file);
    }
  });

  test("missing assets return 404", async () => {
    const res = await fetch(`${server.url}/js/missing.js`);
    assert.equal(res.status, 404);
  });

  test("project files outside the public folders are not exposed", async () => {
    for (const url of ["/package.json", "/test/assets.test.js", "/styles/style.scss", "/js/../package.json", "/js/%2e%2e/package.json"]) {
      const res = await fetch(`${server.url}${url}`);
      // serve-static answers encoded traversal with 403, everything else is 404
      assert.ok([403, 404].includes(res.status), `${url} -> ${res.status}`);
      assert.doesNotMatch(await res.text(), /"name"\s*:\s*"todo-/, url);
    }
  });

  test("compiled stylesheet is served as CSS", async (t) => {
    if (!fs.existsSync(path.join(frontendDir, "dist", "style.css"))) {
      t.skip("frontend/dist/style.css not built (run npm run build in frontend/)");
      return;
    }
    const res = await fetch(`${server.url}/dist/style.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/css/);
  });
});

 test("status-only update preserves historical title", async () => {
  const pool = createFakePool(() => ({ rows: [{ id: 1, title: "x", completed: true }] }));
  const server = await startApp({ pool });
  try {
    const res = await sendJson(`${server.url}/tasks/1`, "PUT", { completed: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, "x");
    assert.equal(pool.queries.length, 1);
    assert.deepEqual(pool.queries[0].params, [true, 1]);
  } finally { await server.close(); }
 });
 test("unknown category is a controlled client error", async () => {
  const pool = createFakePool(() => { throw Object.assign(new Error("foreign key"), { code: "23503" }); });
  const server = await startApp({ pool });
  try {
    const res = await sendJson(`${server.url}/tasks`, "POST", { title: "Test", date: "2026-10-30", categoryId: 999 });
    assert.equal(res.status, 400);
  } finally { await server.close(); }
 });
