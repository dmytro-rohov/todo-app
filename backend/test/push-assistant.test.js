// Tasks' notifications (push.js) and Mytko Assistant's tools (assistant.js) without a database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
// loopback requests stay off any proxy from the environment (Mytko's validation sandbox), as in the other tests
require("./support");

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

test("assistant: a task as the app's form makes it (written today, the day said as its deadline, the history), in the owner's private space or a named space or project; Cofnij while it is as made; today's list", async () => {
  const queries = [];
  const history = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || sql.startsWith("SELECT 1 FROM spaces WHERE id")) return { rows: [] };
    if (sql.startsWith("SELECT id, key FROM spaces")) return { rows: [{ id: 1, key: "work" }, { id: 2, key: "private" }] };
    if (sql.startsWith("SELECT s.id, s.name FROM spaces s")) return { rows: [{ id: 1, name: "Praca" }, { id: 2, name: "Prywatne" }, { id: 3, name: "Dom" }] };
    if (sql.startsWith("SELECT p.id, p.name")) return { rows: [{ id: 9, name: "Remont", spaceId: 3, spaceName: "Dom" }] };
    if (sql.startsWith("SELECT s.name FROM spaces s")) return { rows: [{ name: "Praca" }, { name: "Prywatne" }, { name: "Dom" }] };
    if (sql.startsWith("SELECT p.name, s.name AS space")) return { rows: [{ name: "Remont", space: "Dom" }] };
    if (sql.startsWith("SELECT a.name FROM assignees a")) return { rows: [{ name: "Ania" }] };
    // the app's create (routes/tasks.js): the destination checked as for its own form
    if (sql.startsWith("SELECT space_id FROM projects") || sql.startsWith("SELECT p.space_id FROM projects p")) return { rows: [{ space_id: 3 }], rowCount: 1 };
    if (sql.startsWith("SELECT 1 FROM spaces s WHERE s.id")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("AS seen FROM spaces s")) return { rows: [{ seen: true }], rowCount: 1 };
    if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: 40 + queries.filter(q => q.sql.includes("INSERT INTO tasks")).length }] };
    if (sql.includes("AS \"labelIds\"") && sql.includes("FROM tasks WHERE id = $1")) {
      const p = queries.filter(q => q.sql.includes("INSERT INTO tasks")).at(-1).params;
      return { rows: [{ id: params[0], title: p[0], date: p[2], description: p[4], status: p[5], priority: p[6], dueDate: p[7], spaceId: p[9], projectId: p[10] }] };
    }
    if (sql.startsWith("INSERT INTO task_history")) { history.push(params); return { rows: [] }; }
    if (sql.startsWith("DELETE FROM tasks")) return { rowCount: queries.filter(q => q.sql.startsWith("DELETE")).length === 1 ? 1 : 0 };
    if (sql.includes("FROM tasks t")) return { rows: [{ title: "Olej", priority: "P1" }, { title: "Ania", priority: "P2" }] };
    throw new Error(sql);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const inserts = () => queries.filter(q => q.sql.includes("INSERT INTO tasks"));
  // the app's INSERT: title, completed, date, category, description, status, priority, due date, position, space, project,
  // assignee, review, planned, client, meeting, the account (NULL: the owner), e-mail
  const placed = () => [inserts().at(-1).params[2], inserts().at(-1).params[7], inserts().at(-1).params[9], inserts().at(-1).params[10]];
  const ctx = await assistant(pool);
  try {
    const tools = (await ctx.call("/tools")).body;
    assert.deepEqual(tools.tools.map(tool => tool.name), ["tasks.add_task", "tasks.today", "tasks.list", "tasks.set_status", "tasks.update_task",
      "tasks.restore_task", "tasks.add_note", "tasks.add_subtask", "tasks.set_subtask"]);
    for (const tool of tools.tools) assert.deepEqual(Object.keys(tool), ["name", "description", "schema"], "what Home's planner reads");
    assert.deepEqual(Object.keys(tools.tools[0].schema.properties), ["title", "date", "dueDate", "priority", "description", "space", "project"], "the planner keeps sending the day said");
    assert.deepEqual(tools.context, { today: "2026-11-12", spaces: ["Praca", "Prywatne", "Dom"], projects: [{ name: "Remont", space: "Dom" }], assignees: ["Ania"] });
    const added = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Kupić olej", date: "2026-11-18", priority: "P1" } });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.summary, "Zadanie: Kupić olej · 2026-11-18 · P1");
    assert.deepEqual(inserts()[0].params, ["Kupić olej", false, "2026-11-12", null, "", "todo", "P1", "2026-11-18", null, 2, null, null, false, false, null, null, null, null],
      "written today with the day said as its deadline (the calendar's day), as the form sends it; the owner's private space");
    assert.deepEqual(history.at(-1), [40 + 1, ["created"], [null], ["Kupić olej"], "owner"], "the app's own \"created\" entry");
    assert.deepEqual(added.body.data, { id: 41, date: "2026-11-12", dueDate: "2026-11-18", space: null, project: null });
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "ab" } })).status, 400);
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", priority: "P9" } })).status, 400);
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", dueDate: "2026-02-30" } })).status, 400, "a real day, like the form (not a 500 from Postgres)");
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", date: "2026-02-30" } })).status, 400);
    assert.deepEqual(await ctx.call("/undo", { undo: added.body.undo }), { status: 200, body: { summary: "Cofnięto zadanie: Kupić olej" } });
    const removed = queries.find(q => q.sql.startsWith("DELETE"));
    assert.match(removed.sql, /user_id IS NULL AND space_id IS NOT DISTINCT FROM \$3::integer AND project_id IS NOT DISTINCT FROM \$4::integer/);
    assert.deepEqual(removed.params, [41, "Kupić olej", 2, null]);
    assert.equal((await ctx.call("/undo", { undo: added.body.undo })).status, 409, "changed or gone: no second time");

    const noDay = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Kupić chleb" } });
    assert.deepEqual([noDay.body.summary, placed()], ["Zadanie: Kupić chleb", ["2026-11-12", null, 2, null]], "no day said: no deadline, as the form left empty");
    const deadline = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Faktura", date: "2026-11-13", dueDate: "2026-11-14" } });
    assert.deepEqual([deadline.body.summary, placed()], ["Zadanie: Faktura · 2026-11-14", ["2026-11-12", "2026-11-14", 2, null]], "a named deadline wins");
    const work = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Wysłać fakturę", space: "praca" } });
    assert.deepEqual([work.body.summary, placed().slice(2)], ["Zadanie: Wysłać fakturę · Praca", [1, null]]);
    const privateSaid = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Spotkanie z rodziną", date: "2026-11-18", space: "prywatna" } });
    assert.deepEqual([privateSaid.body.summary, placed()], ["Zadanie: Spotkanie z rodziną · 2026-11-18", ["2026-11-12", "2026-11-18", 2, null]]);
    const project = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Kupić farbę", project: "remont" } });
    assert.deepEqual([project.body.summary, placed().slice(2)], ["Zadanie: Kupić farbę · Dom › Remont", [3, 9]]);
    const unknown = await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", space: "Kosmos" } });
    assert.deepEqual([unknown.status, unknown.body.message], [400, "Unknown space \"Kosmos\". Known: Praca, Prywatne, Dom"]);
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", project: "Remont", space: "Praca" } })).status, 400, "a project brings its own space");
    assert.equal((await ctx.call("/run", { tool: "tasks.add_task", input: { title: "Coś", space: "a" } })).status, 400, "one letter picks nothing by chance");
    assert.equal((await ctx.call("/run", { tool: "tasks.today", input: {} })).body.summary, "Na dziś (2): ❗ Olej; Ania");
  } finally { await ctx.close(); }
});
