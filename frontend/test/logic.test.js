import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, applyMove, boardCanonical, counters, dueLabel, dueState, filterTasks, formatDuration, initials, monthGrid,
  shiftMonth, titleError, trackedNow, yearsAhead, goalLabel, isOpen
} from "../js/app/logic.js";

const TODAY = "2026-11-06";
const names = { project: id => ({ 1: "ORHEA" })[id] || "", assignee: id => ({ 7: "Dima Rohov" })[id] || "", label: id => ({ 3: "Frontend" })[id] || "" };
const ctx = { privateSpaceId: 2, names };
const task = (id, extra = {}) => ({ id, title: `Zadanie ${id}`, description: "", status: "todo", position: id, spaceId: 1, projectId: null,
  assigneeId: null, labelIds: [], dueDate: null, ...extra });

test("deadlines read as Dziś / Jutro / Wczoraj or a short Polish date", () => {
  assert.equal(dueLabel(TODAY, TODAY), "Dziś");
  assert.equal(dueLabel("2026-11-07", TODAY), "Jutro");
  assert.equal(dueLabel("2026-11-05", TODAY), "Wczoraj");
  assert.equal(dueLabel("2026-10-28", TODAY), "28 paź");
  assert.equal(dueLabel("2027-01-03", TODAY), "3 sty 2027");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("due state: overdue, today, the next 7 days; done tasks are never due", () => {
  assert.equal(dueState(task(1, { dueDate: "2026-11-01" }), TODAY), "overdue");
  assert.equal(dueState(task(1, { dueDate: TODAY }), TODAY), "today");
  assert.equal(dueState(task(1, { dueDate: "2026-11-12" }), TODAY), "soon");
  assert.equal(dueState(task(1, { dueDate: "2026-11-13" }), TODAY), "later");
  assert.equal(dueState(task(1, { dueDate: "2026-11-01", status: "done" }), TODAY), null);
  assert.equal(dueState(task(1), TODAY), null);
});

test("durations and initials match the cards", () => {
  assert.equal(formatDuration(12000), "3 h 20 min");
  assert.equal(formatDuration(6300), "1 h 45 min");
  assert.equal(formatDuration(7200), "2 h");
  assert.equal(formatDuration(59), "0 min");
  assert.equal(trackedNow({ trackedSeconds: 60, timerStartedAt: "x" }, 1000, 61000), 120);
  assert.equal(trackedNow({ trackedSeconds: 60, timerStartedAt: null }, 1000, 61000), 60);
  // each task counts from when it was read, not from the store's last write
  assert.equal(trackedNow({ trackedSeconds: 600, timerStartedAt: "x", fetchedAt: 1000 }, 50000, 61000), 660);
  assert.equal(initials("Dima Rohov"), "DR");
  assert.equal(initials("kasia"), "KA");
  assert.equal(initials(""), "?");
});

test("filters: space (null = private), project, label, assignee, words in any field, status and done", () => {
  const tasks = [
    task(1, { projectId: 1, labelIds: [3], assigneeId: 7, title: "Wdrożyć kafelki" }),
    task(2, { spaceId: null }),
    task(3, { status: "done", projectId: 1 }),
    task(4, { spaceId: 2, status: "needs_review" })
  ];
  const ids = filters => filterTasks(tasks, { showDone: false, ...filters }, ctx, TODAY).map(t => t.id);
  assert.deepEqual(ids({}), [1, 2, 4]);
  assert.deepEqual(ids({ showDone: true }), [1, 2, 3, 4]);
  assert.deepEqual(ids({ spaceId: 2 }), [2, 4]);
  assert.deepEqual(ids({ projectId: 1, showDone: true }), [1, 3]);
  assert.deepEqual(ids({ labelId: 3 }), [1]);
  assert.deepEqual(ids({ assigneeId: 7 }), [1]);
  assert.deepEqual(ids({ assigneeId: "none" }), [2, 4]);
  assert.deepEqual(ids({ search: "orhea frontend dima" }), [1]);
  assert.deepEqual(ids({ search: "KAFELKI" }), [1]);
  assert.deepEqual(ids({ status: "done" }), [3]);
});

test("counters share the scope and ignore status, done switch and the quick filter", () => {
  const tasks = [
    task(1, { dueDate: TODAY }), task(2, { dueDate: "2026-11-01" }), task(3, { dueDate: "2026-11-10", status: "in_progress" }),
    task(4, { dueDate: "2026-11-01", status: "done" }), task(5, { dueDate: "2026-12-24", spaceId: 2 })
  ];
  const result = counters(tasks, { status: "done", quick: "today", showDone: false }, ctx, TODAY);
  assert.deepEqual([result.all, result.today, result.overdue, result.week], [4, 1, 1, 2]);
  assert.deepEqual(result.byStatus, { todo: 3, in_progress: 1, needs_review: 0, done: 1, planned: 0 });
  assert.deepEqual(filterTasks(tasks, { quick: "week" }, ctx, TODAY).map(t => t.id), [1, 3]);
  assert.deepEqual(filterTasks(tasks, { quick: "overdue" }, ctx, TODAY).map(t => t.id), [2]);
});

test("optimistic moves give dense positions and match the server's canonical form", () => {
  const tasks = [task(1, { position: 0 }), task(2, { position: 1 }), task(3, { position: 0, status: "done" })];
  const moved = applyMove(tasks, 2, "done", 3);
  assert.deepEqual(moved.map(t => [t.id, t.status, t.position]), [[1, "todo", 0], [2, "done", 0], [3, "done", 1]]);
  const reordered = applyMove(tasks, 2, "todo", 1);
  assert.deepEqual(reordered.map(t => [t.id, t.position]), [[1, 1], [2, 0], [3, 0]]);
  assert.equal(applyMove(tasks, 9, "todo", null), tasks);
  assert.equal(boardCanonical([task(2, { position: "5" }), task(1, { position: 0 })]), '[[1,"todo",0],[2,"todo",5]]');
});

test("month grid starts on Monday and covers the month", () => {
  const weeks = monthGrid("2026-11-06");
  assert.equal(weeks[0][0].day, "2026-10-26");
  assert.equal(weeks[0][6].day, "2026-11-01");
  assert.ok(weeks.flat().filter(c => c.inMonth).length === 30);
  assert.ok(weeks.every(week => week.length === 7));
  assert.equal(shiftMonth("2026-01-31", -1), "2025-12-01");
});

test("long-term plans: goals years ahead, off the daily counters and due states", () => {
  assert.equal(yearsAhead(1, TODAY), "2027-11-06");
  assert.equal(yearsAhead(5, "2028-02-29"), "2033-02-28");
  assert.equal(goalLabel("2031-06-30", TODAY), "Cel: 2031");
  assert.equal(goalLabel("2026-12-24", TODAY), "Cel: 24 gru");
  assert.equal(goalLabel(null, TODAY), "Bez daty");
  const plan = task(9, { status: "planned", dueDate: "2026-11-01" });
  assert.equal(isOpen(plan), false);
  assert.equal(dueState(plan, TODAY), null);
  const result = counters([plan, task(1)], { showDone: true }, ctx, TODAY);
  assert.deepEqual([result.all, result.overdue, result.byStatus.planned], [1, 0, 1]);
});

test("title rules: 3–100 characters, an unchanged historical title stays valid", () => {
  assert.match(titleError("ab"), /3 do 100/);
  assert.equal(titleError("abc"), "");
  assert.equal(titleError("x".repeat(255), "x".repeat(255)), "");
  assert.match(titleError("x".repeat(101)), /3 do 100/);
});
