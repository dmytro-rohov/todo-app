import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ApiError, request } from "../js/api/http.js";
import { getTasks, addTask, updateTask, deleteTask, deleteTaskByDate } from "../js/api/tasks.js";
import { getCategories, addCategory, deleteCategory } from "../js/api/categories.js";
import { createTask } from "../js/actions/tasks.js";

const originalFetch = globalThis.fetch;
let calls;

function mockFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body, headers: init.headers });
    return handler(url, init);
  };
}

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("request returns parsed JSON on success", async () => {
  mockFetch(() => jsonResponse(200, [{ id: 1 }]));
  assert.deepEqual(await request("/tasks"), [{ id: 1 }]);
});

test("request throws ApiError with the server message on 4xx", async () => {
  mockFetch(() => jsonResponse(400, { message: "Title too short" }));
  await assert.rejects(request("/tasks", { method: "POST", body: {} }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, "Title too short");
    return true;
  });
});

test("request throws a generic ApiError on non-JSON 5xx", async () => {
  mockFetch(() => new Response("<html>Internal Server Error</html>", { status: 500 }));
  await assert.rejects(request("/tasks"), (error) => {
    assert.equal(error.status, 500);
    assert.match(error.message, /500/);
    return true;
  });
});

test("request throws ApiError when the server is unreachable", async () => {
  mockFetch(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(request("/tasks"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    return true;
  });
});

test("request tolerates empty success bodies", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  assert.equal(await request("/tasks/1", { method: "DELETE" }), null);
});

test("task API uses the backend contract", async () => {
  mockFetch(() => jsonResponse(200, {}));
  const task = { id: 7, title: "Test", completed: true, date: "2026-10-30", categoryId: 1 };

  await getTasks();
  await addTask(task);
  await updateTask(task);
  await deleteTask(7);
  await deleteTaskByDate("2026-10-30");

  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), [
    "GET /tasks",
    "POST /tasks",
    "PUT /tasks/7",
    "DELETE /tasks/7",
    "DELETE /tasks/date/2026-10-30"
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), task);
  assert.equal(calls[1].headers["Content-Type"], "application/json");
});

test("category API uses the backend contract", async () => {
  mockFetch(() => jsonResponse(200, {}));

  await getCategories();
  await addCategory({ name: "Dom", color: "#22c55e" });
  await deleteCategory(3);

  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), [
    "GET /categories",
    "POST /categories",
    "DELETE /categories/3"
  ]);
});

test("mutating calls surface HTTP errors instead of failing silently", async () => {
  mockFetch(() => jsonResponse(500, { message: "Server error" }));
  await assert.rejects(updateTask({ id: 1 }), ApiError);
  await assert.rejects(deleteTask(1), ApiError);
  await assert.rejects(deleteTaskByDate("2026-10-30"), ApiError);
  await assert.rejects(addCategory({ name: "x", color: "#fff" }), ApiError);
  await assert.rejects(deleteCategory(1), ApiError);
});

// Regression: the modal submit handler used to call addTask twice,
// creating every task in duplicate.
test("createTask sends exactly one POST and returns the refreshed list", async () => {
  const stored = [];
  mockFetch((url, init) => {
    if (init.method === "POST") {
      stored.push(JSON.parse(init.body));
      return jsonResponse(201, { message: "Task added" });
    }
    return jsonResponse(200, stored.map((t, i) => ({ id: i + 1, ...t })));
  });

  const tasks = await createTask({ title: "Kup mleko", completed: false, date: "2026-10-30", categoryId: 1 });

  assert.equal(calls.filter(c => c.method === "POST").length, 1);
  assert.equal(tasks.length, 1);
});

test("createTask does not retry the POST after a validation error", async () => {
  mockFetch(() => jsonResponse(400, { message: "Title too short" }));
  await assert.rejects(createTask({ title: "x", date: "2026-10-30" }), /Title too short/);
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
});

test("modal submit handler creates the task through a single createTask call", async () => {
  const source = await readFile(new URL("../js/events/listeners.js", import.meta.url), "utf8");
  assert.equal(source.match(/\baddTask\s*\(/g), null, "listeners.js must not call addTask directly");
  assert.equal(source.match(/\bcreateTask\s*\(/g)?.length, 1);
});
