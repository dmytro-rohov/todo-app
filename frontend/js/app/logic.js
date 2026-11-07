// Pure board logic: no DOM, no network. Everything here is unit tested.

// The fifth column holds long-term plans and dreams (a year, two, five): off the daily counters, to the right.
export const STATUSES = ["todo", "in_progress", "needs_review", "done", "planned"];
export const STATUS_LABELS = { todo: "ToDo", in_progress: "W realizacji", needs_review: "Needs review", done: "Zakończone",
  planned: "Plany długoterminowe" };

// Work that is on the table now: not finished and not a long-term plan.
export function isOpen(task) {
  return task.status !== "done" && task.status !== "planned";
}
export const PRIORITY_LABELS = { P0: "Krytyczny", P1: "Wysoki", P2: "Normalny", P3: "Niski" };
const MONTHS_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
export const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień",
  "Październik", "Listopad", "Grudzień"];
export const WEEKDAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

// Local calendar date as YYYY-MM-DD (deadlines are calendar days, not instants).
export function isoDay(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day, count) {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + count));
}

// "Dziś", "Jutro", "Wczoraj" or "28 paź" (with the year when it is not the current one).
export function dueLabel(dueDate, today = isoDay()) {
  if (!dueDate) return "";
  if (dueDate === today) return "Dziś";
  if (dueDate === addDays(today, 1)) return "Jutro";
  if (dueDate === addDays(today, -1)) return "Wczoraj";
  const [y, m, d] = dueDate.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${String(y) === today.slice(0, 4) ? "" : ` ${y}`}`;
}

// "overdue" | "today" | "soon" (next 7 days) | "later" | null, for open tasks only.
export function dueState(task, today = isoDay()) {
  if (!task.dueDate || !isOpen(task)) return null;
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return task.dueDate <= addDays(today, 6) ? "soon" : "later";
}

// "3 h 20 min", "45 min", "0 min".
export function formatDuration(seconds) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Tracked time including a running timer, as of `now` (ms). trackedSeconds was computed by the server when the
// task was read: task.fetchedAt (set per task by the store), else `fetchedAt`.
export function trackedNow(task, fetchedAt, now = Date.now()) {
  const running = task.timerStartedAt ? Math.max(0, (now - (task.fetchedAt ?? fetchedAt)) / 1000) : 0;
  return (task.trackedSeconds || 0) + running;
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts.at(-1)[0];
  return letters.toLocaleUpperCase("pl");
}

// Built-in private space id, the space of tasks without one.
export function effectiveSpace(task, privateSpaceId) {
  return task.spaceId ?? privateSpaceId;
}

function matchesSearch(task, query, names) {
  if (!query) return true;
  const haystack = [task.title, task.description, names.project(task.projectId), names.assignee(task.assigneeId), names.client?.(task) || "",
    ...(task.labelIds || []).map(names.label)].join(" ").toLocaleLowerCase("pl");
  return query.toLocaleLowerCase("pl").split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

// Scope = everything except status, the "show done" switch and the quick (due) filter: the tiles and column
// counters count within it, so they never contradict each other.
export function inScope(task, filters, ctx) {
  if (filters.spaceId && effectiveSpace(task, ctx.privateSpaceId) !== filters.spaceId) return false;
  if (filters.projectId && task.projectId !== filters.projectId) return false;
  if (filters.clientId && ctx.clientOf?.(task) !== filters.clientId) return false;
  if (filters.labelId && !(task.labelIds || []).includes(filters.labelId)) return false;
  if (filters.assigneeId === "none" ? task.assigneeId !== null : filters.assigneeId && task.assigneeId !== filters.assigneeId) return false;
  return matchesSearch(task, filters.search, ctx.names);
}

export function filterTasks(tasks, filters, ctx, today = isoDay()) {
  return tasks.filter(task => inScope(task, filters, ctx) &&
    (!filters.status || task.status === filters.status) &&
    (filters.showDone || task.status !== "done" || filters.status === "done") &&
    (!filters.quick || (filters.quick === "week" ? ["today", "soon"].includes(dueState(task, today)) : dueState(task, today) === filters.quick)));
}

export function counters(tasks, filters, ctx, today = isoDay()) {
  const scoped = tasks.filter(task => inScope(task, filters, ctx));
  const due = state => scoped.filter(task => dueState(task, today) === state).length;
  return {
    all: scoped.filter(isOpen).length,
    today: due("today"),
    overdue: due("overdue"),
    week: due("today") + due("soon"),
    byStatus: Object.fromEntries(STATUSES.map(status => [status, scoped.filter(task => task.status === status).length]))
  };
}

// Board order: position, then id (the server's order).
export function byPosition(a, b) {
  return Number(a.position) - Number(b.position) || a.id - b.id;
}

export function columns(tasks) {
  return Object.fromEntries(STATUSES.map(status => [status, tasks.filter(t => t.status === status).sort(byPosition)]));
}

// Optimistic local move, mirroring the server: dense positions in the touched columns.
export function applyMove(tasks, id, status, beforeId) {
  const moving = tasks.find(t => t.id === id);
  if (!moving) return tasks;
  const from = moving.status;
  const target = tasks.filter(t => t.status === status && t.id !== id).sort(byPosition);
  const index = beforeId === null ? target.length : target.findIndex(t => t.id === beforeId);
  if (index < 0) return tasks;
  const moved = { ...moving, status };
  target.splice(index, 0, moved);
  const source = from === status ? [] : tasks.filter(t => t.status === from && t.id !== id).sort(byPosition);
  const updates = new Map();
  [target, source].forEach(list => list.forEach((t, position) => updates.set(t.id, { ...t, position })));
  return tasks.map(t => updates.get(t.id) || t);
}

// The server's optimistic-concurrency token: sha256 over the canonical board (see backend/ordering.js).
export function boardCanonical(tasks) {
  return JSON.stringify(tasks.map(t => [Number(t.id), t.status, Number(t.position)]).sort((a, b) => a[0] - b[0]));
}

export const SORTS = {
  position: { label: "Kolejność", compare: byPosition },
  due: { label: "Termin", compare: (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || byPosition(a, b) },
  title: { label: "Tytuł", compare: (a, b) => a.title.localeCompare(b.title, "pl") },
  updated: { label: "Ostatnio zmienione", compare: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) }
};

// Weeks (Monday first) covering the month of `day`: [[{day, inMonth}, ...7], ...].
export function monthGrid(day) {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = isoDay(new Date(y, m - 1, 1 - offset));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const cell = addDays(start, w * 7 + i);
      return { day: cell, inMonth: Number(cell.slice(5, 7)) === m };
    });
    if (w >= 4 && !week.some(cell => cell.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(day, delta) {
  const [y, m] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1 + delta, 1));
}

// The same calendar day `years` years ahead (29 Feb becomes 28 Feb).
export function yearsAhead(years, today = isoDay()) {
  const [y, m, d] = today.split("-").map(Number);
  const target = new Date(y + years, m - 1, d);
  return isoDay(target.getMonth() === m - 1 ? target : new Date(y + years, m, 0));
}

// "Cel: 2031" for a goal in another year, "Cel: 30 cze" within this one.
export function goalLabel(dueDate, today = isoDay()) {
  if (!dueDate) return "Bez daty";
  return dueDate.slice(0, 4) === today.slice(0, 4) ? `Cel: ${dueLabel(dueDate, today)}` : `Cel: ${dueDate.slice(0, 4)}`;
}

export function titleError(title, original = null) {
  if (original !== null && title === original) return "";
  const length = title.trim().length;
  return length < 3 || title.length > 100 ? "Tytuł musi mieć od 3 do 100 znaków." : "";
}
