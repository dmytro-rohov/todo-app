// Tasks' notifications (push.js) and Mytko Assistant's tools (assistant.js) without a database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");

const { warsawNow, remindToday, todayMessage, CATEGORIES } = require("../push");
const { createTasksAssistant } = require("../assistant");

test("today: Warsaw time; the message in Polish with the first three titles", () => {
  assert.deepEqual(warsawNow(new Date("2026-11-12T06:59:00Z")), { day: "2026-11-12", hour: 7 });
  assert.deepEqual(CATEGORIES, [{ id: "today", default: true }]);
  assert.deepEqual(todayMessage(["Olej", "Ania", "Faktura", "Pranie"], "2026-11-12"),
    { category: "today", title: "Na dziś: 4 zadania", body: "Olej · Ania · Faktura · i jeszcze 1", url: "/", tag: "today-2026-11-12" });
  assert.equal(todayMessage(["Olej"], "d").title, "Na dziś: 1 zadanie");
  assert.equal(todayMessage(Array(7).fill("x"), "d").title, "Na dziś: 7 zadań");
});

test("the morning: from 8:00 Warsaw time, once a day per account (the owner is NULL), nothing when nothing is open", async () => {
  const claimed = new Set();
  const sent = [];
  const pool = { async query(sql, params) {
    if (sql.startsWith("SELECT DISTINCT user_id")) return { rows: [{ userId: null }, { userId: 7 }] };
    if (sql.includes("FROM tasks t")) return { rows: params[0] === null ? [{ title: "Olej" }, { title: "Ania" }] : [] };
    if (sql.startsWith("INSERT INTO push_log")) { if (claimed.has(params[1])) return { rowCount: 0 }; claimed.add(params[1]); return { rowCount: 1 }; }
    throw new Error(sql);
  } };
  const push = { available: true, send: async (userId, message) => { sent.push([userId, message.title]); return { sent: 1 }; } };
  assert.equal(await remindToday(pool, push, new Date("2026-11-12T06:30:00Z")), 0, "7:30 in Warsaw");
  assert.equal(await remindToday(pool, push, new Date("2026-11-12T07:05:00Z")), 1);
  assert.deepEqual(sent, [[null, "Na dziś: 2 zadania"]]);
  assert.ok(claimed.has("today:owner:2026-11-12"));
  assert.equal(await remindToday(pool, push, new Date("2026-11-12T12:00:00Z")), 0, "never twice a day");
  assert.equal(await remindToday(pool, { ...push, available: false }, new Date("2026-11-13T07:05:00Z")), 0);
});

const TOKEN = "a-long-random-assistant-token-0123456789";
async function assistant(pool, now = () => new Date("2026-11-12T10:00:00Z")) {
  const app = express();
  app.use("/api/assistant", express.json(), createTasksAssistant({ pool, config: { assistant: { tokenHash: crypto.createHash("sha256").update(TOKEN).digest("hex") } }, now }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const call = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/assistant${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async res => ({ status: res.status, body: await res.json() }));
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

test("assistant: a private task of the owner, today by default; Cofnij deletes it while it is as made; today's list", async () => {
  const queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: 41, date: params[1] }] };
    if (sql.startsWith("DELETE FROM tasks")) return { rowCount: queries.filter(q => q.sql.startsWith("DELETE")).length === 1 ? 1 : 0 };
    if (sql.includes("FROM tasks t")) return { rows: [{ title: "Olej", priority: "P1" }, { title: "Ania", priority: "P2" }] };
    throw new Error(sql);
  } };
  const ctx = await assistant(pool);
  try {
    assert.deepEqual((await ctx.call("/tools")).body.tools.map(tool => tool.name), ["tasks.add_task", "tasks.today"]);
    const added = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Kupić olej", dueDate: "2026-11-14", priority: "P1" } });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.summary, "Zadanie: Kupić olej · 2026-11-12 · termin 2026-11-14 · P1");
    const insert = queries.find(q => q.sql.includes("INSERT INTO tasks"));
    assert.deepEqual(insert.params, ["Kupić olej", "2026-11-12", "", "P1", "2026-11-14"]);
    assert.match(insert.sql, /'todo', \$4::text, \$5::date, next\.id, NULL/);
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "ab" } })).status, 400);
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", priority: "P9" } })).status, 400);
    assert.deepEqual(await ctx.call("/undo", { undo: added.body.undo }), { status: 200, body: { summary: "Cofnięto zadanie: Kupić olej" } });
    assert.match(queries.find(q => q.sql.startsWith("DELETE")).sql, /user_id IS NULL AND space_id IS NULL AND project_id IS NULL AND NOT completed/);
    assert.equal((await ctx.call("/undo", { undo: added.body.undo })).status, 409, "changed or gone: no second time");
    assert.equal((await ctx.call("/run", { tool: "tasks.today", input: {} })).body.summary, "Na dziś (2): ❗ Olej; Ania");
  } finally { await ctx.close(); }
});
