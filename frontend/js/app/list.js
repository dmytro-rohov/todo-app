// List view: rows grouped by status, sortable, with a quick status toggle.
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { formatDuration, SORTS, STATUSES, STATUS_LABELS, trackedNow } from "./logic.js";
import { render, store, visibleTasks } from "./app.js";
import { avatarHtml, chipsHtml, dueHtml, moveTask } from "./board.js";
import { openDrawer } from "./drawer.js";

const STATUS_ICONS = { todo: "circle", in_progress: "playCircle", needs_review: "warningCircle", done: "checkCircle" };

function rowHtml(task) {
  const tracked = trackedNow(task, store.fetchedAt);
  return `<li class="row row--${task.status}" data-id="${task.id}">
    <button type="button" class="row__status" data-list="toggle" aria-label="${task.status === "done" ? "Otwórz ponownie" : "Oznacz jako zakończone"}: ${escapeHtml(task.title)}" title="${task.status === "done" ? "Otwórz ponownie" : "Zakończ"}">${icon(STATUS_ICONS[task.status], 22)}</button>
    <button type="button" class="row__main" data-list="open">
      <span class="row__title">${escapeHtml(task.title)}</span>
      ${chipsHtml(task)}
    </button>
    <span class="row__who">${avatarHtml(task)}</span>
    <span class="row__due">${dueHtml(task) || '<span class="muted">Bez terminu</span>'}</span>
    <span class="row__time">${tracked ? `${icon("clock", 16)}${formatDuration(tracked)}` : ""}</span>
  </li>`;
}

export function renderList() {
  const tasks = visibleTasks();
  const compare = (SORTS[store.listSort] || SORTS.position).compare;
  const groups = STATUSES.map(status => [status, tasks.filter(t => t.status === status).sort(compare)]).filter(([, list]) => list.length);
  return `<div class="list">
    <div class="list__bar">
      <span>${tasks.length} ${tasks.length === 1 ? "zadanie" : tasks.length % 10 >= 2 && tasks.length % 10 <= 4 && (tasks.length < 10 || tasks.length > 20) ? "zadania" : "zadań"}</span>
      <label class="select select--sm"><span>Sortuj:</span><select data-list-sort>
        ${Object.entries(SORTS).map(([key, sort]) => `<option value="${key}"${store.listSort === key ? " selected" : ""}>${sort.label}</option>`).join("")}
      </select>${icon("chevronDown", 16)}</label>
    </div>
    ${groups.length ? groups.map(([status, list]) => `
      <section class="list__group list__group--${status}">
        <h2>${icon(STATUS_ICONS[status], 20)}${STATUS_LABELS[status]}<span class="count">${list.length}</span></h2>
        <ul>${list.map(rowHtml).join("")}</ul>
      </section>`).join("") : '<p class="empty">Brak zadań dla tych filtrów.</p>'}
  </div>`;
}

export function bindList(root) {
  const view = root.querySelector(".view");
  view.addEventListener("click", event => {
    if (view.dataset.view !== "list") return;
    const button = event.target.closest("[data-list]");
    if (!button) return;
    const id = Number(button.closest("[data-id]").dataset.id);
    if (button.dataset.list === "open") return openDrawer(id);
    const task = store.tasks.find(t => t.id === id);
    moveTask(id, task.status === "done" ? "todo" : "done", null);
  });
  view.addEventListener("change", event => {
    if (!event.target.matches("[data-list-sort]")) return;
    store.listSort = event.target.value;
    render();
  });
}
