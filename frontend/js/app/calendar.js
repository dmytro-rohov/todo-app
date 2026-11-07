// Calendar view: a month of deadlines. Drag a task to another day to move its deadline; click a day to add one.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { byPosition, isoDay, monthGrid, MONTHS, shiftMonth, STATUS_LABELS, WEEKDAYS } from "./logic.js";
import { render, runTask, store, visibleTasks } from "./app.js";
import { openDrawer } from "./drawer.js";
import { openNewTask } from "./dialogs.js";

const PER_DAY = 3;
let dragged = null;

const phone = () => window.matchMedia("(max-width: 600px)").matches;

// Phones: a compact month with dots, and the chosen day's tasks below it (titles stay readable).
function renderAgenda(byDay, today) {
  const [y, m] = store.month.split("-").map(Number);
  const day = store.calendarDay.slice(0, 7) === store.month.slice(0, 7) ? store.calendarDay : (today.slice(0, 7) === store.month.slice(0, 7) ? today : `${store.month.slice(0, 7)}-01`);
  const list = byDay.get(day) || [];
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  return `<div class="calendar calendar--agenda">
    <div class="calendar__bar">
      <button type="button" class="icon-btn icon-btn--box" data-cal="prev" aria-label="Poprzedni miesiąc">${icon("chevronLeft")}</button>
      <h2>${MONTHS[m - 1]} ${y}</h2>
      <button type="button" class="icon-btn icon-btn--box" data-cal="next" aria-label="Następny miesiąc">${icon("chevronRight")}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-cal="today">Dziś</button>
    </div>
    <div class="mini" role="grid" aria-label="${MONTHS[m - 1]} ${y}">
      ${WEEKDAYS.map(d => `<span class="mini__weekday" role="columnheader">${d}</span>`).join("")}
      ${monthGrid(store.month).flat().map(cell => {
        const tasks = byDay.get(cell.day) || [];
        return `<button type="button" role="gridcell" class="mini__day${cell.inMonth ? "" : " is-out"}${cell.day === today ? " is-today" : ""}${cell.day === day ? " is-selected" : ""}" data-cal="pick" data-day="${cell.day}" aria-label="${cell.day}${tasks.length ? `, ${tasks.length} zadań` : ""}">
          <span>${Number(cell.day.slice(8))}</span><span class="mini__dots">${tasks.slice(0, 3).map(t => `<i class="mini__dot mini__dot--${t.status}"></i>`).join("")}</span></button>`;
      }).join("")}
    </div>
    <section class="agenda" aria-live="polite">
      <h3>${escapeHtml(label)}<button type="button" class="btn btn--ghost btn--sm" data-cal="add" data-day="${day}">${icon("plus", 16)}Dodaj</button></h3>
      ${list.length ? list.map(task => `<button type="button" class="agenda__item event--${task.status}" data-cal="open" data-id="${task.id}">
          <span class="agenda__title">${escapeHtml(task.title)}</span><span class="muted">${STATUS_LABELS[task.status]}</span></button>`).join("")
        : '<p class="muted">Brak zadań z terminem w tym dniu.</p>'}
    </section>
  </div>`;
}

export function renderCalendar() {
  const tasks = visibleTasks().filter(t => t.dueDate);
  const byDay = new Map();
  for (const task of tasks.sort(byPosition)) {
    if (!byDay.has(task.dueDate)) byDay.set(task.dueDate, []);
    byDay.get(task.dueDate).push(task);
  }
  const today = isoDay();
  const [y, m] = store.month.split("-").map(Number);
  const undated = visibleTasks().filter(t => !t.dueDate && t.status !== "done").length;
  if (phone()) return renderAgenda(byDay, today);
  return `<div class="calendar">
    <div class="calendar__bar">
      <button type="button" class="icon-btn icon-btn--box" data-cal="prev" aria-label="Poprzedni miesiąc">${icon("chevronLeft")}</button>
      <h2>${MONTHS[m - 1]} ${y}</h2>
      <button type="button" class="icon-btn icon-btn--box" data-cal="next" aria-label="Następny miesiąc">${icon("chevronRight")}</button>
      <button type="button" class="btn btn--ghost" data-cal="today">Dziś</button>
      <span class="calendar__note">${undated ? `${undated} otwartych bez terminu` : ""}</span>
    </div>
    <div class="calendar__grid" role="grid" aria-label="${MONTHS[m - 1]} ${y}">
      ${WEEKDAYS.map(d => `<div class="calendar__weekday" role="columnheader">${d}</div>`).join("")}
      ${monthGrid(store.month).flat().map(({ day, inMonth }) => {
        const list = byDay.get(day) || [];
        return `<div class="day${inMonth ? "" : " day--out"}${day === today ? " day--today" : ""}${day < today ? " day--past" : ""}" role="gridcell" data-day="${day}">
          <button type="button" class="day__num" data-cal="add" aria-label="Dodaj zadanie na ${day}">${Number(day.slice(8))}</button>
          ${list.slice(0, PER_DAY).map(task => `<button type="button" class="event event--${task.status}" draggable="true" data-cal="open" data-id="${task.id}" title="${escapeHtml(task.title)} — ${STATUS_LABELS[task.status]}">${escapeHtml(task.title)}</button>`).join("")}
          ${list.length > PER_DAY ? `<button type="button" class="day__more" data-cal="more" data-day="${day}">+${list.length - PER_DAY} więcej</button>` : ""}
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

export function bindCalendar(root) {
  const view = root.querySelector(".view");
  view.addEventListener("click", event => {
    if (view.dataset.view !== "calendar") return;
    const button = event.target.closest("[data-cal]");
    if (!button) return;
    const kind = button.dataset.cal;
    if (kind === "prev" || kind === "next") { store.month = shiftMonth(store.month, kind === "prev" ? -1 : 1); render(); }
    else if (kind === "today") { store.month = isoDay(); render(); }
    else if (kind === "open") openDrawer(Number(button.dataset.id));
    else if (kind === "add") openNewTask({ status: "todo", dueDate: button.dataset.day || button.closest("[data-day]").dataset.day });
    else if (kind === "pick") { store.calendarDay = button.dataset.day; render(); }
    else if (kind === "more") {
      store.view = "list";
      store.listSort = "due";
      render();
    }
  });
  // Native drag and drop between days (desktop); on touch, open the task and change its deadline there.
  view.addEventListener("dragstart", event => {
    const item = event.target.closest?.(".event");
    if (!item) return;
    dragged = Number(item.dataset.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(dragged));
  });
  view.addEventListener("dragover", event => {
    const day = event.target.closest?.("[data-day].day");
    if (!day || dragged === null) return;
    event.preventDefault();
    view.querySelectorAll(".day--drop").forEach(d => d.classList.remove("day--drop"));
    day.classList.add("day--drop");
  });
  view.addEventListener("dragend", () => { dragged = null; view.querySelectorAll(".day--drop").forEach(d => d.classList.remove("day--drop")); });
  view.addEventListener("drop", event => {
    const day = event.target.closest?.("[data-day].day");
    if (!day || dragged === null) return;
    event.preventDefault();
    const id = dragged;
    dragged = null;
    const task = store.tasks.find(t => t.id === id);
    if (task && task.dueDate !== day.dataset.day) runTask(() => api.updateTask(id, { dueDate: day.dataset.day }), "Nie udało się zmienić terminu.");
  });
}
