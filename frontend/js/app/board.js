// Board view: four columns, cards, drag and drop (mouse, touch, keyboard) and the card actions.
import { api, sha256Hex } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { applyMove, boardCanonical, byPosition, columns, dueLabel, dueState, formatDuration, initials, STATUSES,
  STATUS_LABELS, trackedNow } from "./logic.js";
import { lookup, reload, render, runTask, store, visibleTasks } from "./app.js";
import { openDrawer } from "./drawer.js";
import { toast } from "./toast.js";

const COLUMN_ICONS = { todo: "circle", in_progress: "play", needs_review: "warning", done: "checkCircle" };
const DRAG_THRESHOLD = 6;
const TOUCH_HOLD_MS = 280;
let drag = null;
let suppressClick = false;

export const isDragging = () => drag?.active === true;

export function chipsHtml(task) {
  const project = lookup.project(task.projectId);
  const projectChip = project ? `<span class="chip chip--project" data-c="${escapeHtml(project.color)}">${icon("folder", 15)}${escapeHtml(project.name)}</span>` : "";
  const labels = (task.labelIds || []).map(lookup.label).filter(Boolean).map(label =>
    `<span class="chip chip--label" data-c="${escapeHtml(label.color)}"><i class="dot"></i>${escapeHtml(label.name)}</span>`).join("");
  return projectChip || labels ? `<div class="chips">${projectChip}${labels}</div>` : "";
}

export function avatarHtml(task) {
  const person = lookup.assignee(task.assigneeId);
  return person
    ? `<span class="avatar" data-c="${escapeHtml(person.color)}" title="${escapeHtml(person.name)}">${escapeHtml(initials(person.name))}</span>`
    : `<span class="avatar avatar--empty" title="Bez wykonawcy">${icon("user", 16)}</span><span class="muted">–</span>`;
}

export function dueHtml(task) {
  if (!task.dueDate) return "";
  const state = dueState(task);
  return `<span class="due${state ? ` due--${state}` : ""}">${icon("calendar", 17)}${escapeHtml(dueLabel(task.dueDate))}</span>`;
}

function timerHtml(task) {
  const seconds = trackedNow(task, store.fetchedAt);
  if (task.status !== "in_progress" || (!seconds && !task.timerStartedAt)) return "";
  return `<span class="timer${task.timerStartedAt ? " is-running" : ""}"${task.timerStartedAt ? " data-timer" : ""}>${icon("clock", 16)}${formatDuration(seconds)}</span>`;
}

function actionHtml(task) {
  const title = escapeHtml(task.title);
  if (task.status === "todo") return `<button type="button" class="round-btn" data-card="timer-start" aria-label="Rozpocznij pracę: ${title}" title="Rozpocznij pracę">${icon("play", 14)}</button>`;
  if (task.status === "in_progress") {
    return task.timerStartedAt
      ? `<button type="button" class="round-btn is-running" data-card="timer-stop" aria-label="Zatrzymaj licznik: ${title}" title="Zatrzymaj licznik">${icon("pauseCircle", 20)}</button>`
      : `<button type="button" class="round-btn" data-card="timer-start" aria-label="Wznów licznik: ${title}" title="Wznów licznik">${icon("play", 14)}</button>`;
  }
  if (task.status === "needs_review") return `<button type="button" class="round-btn round-btn--warn" data-card="approve" aria-label="Zatwierdź i zakończ: ${title}" title="Zatwierdź i zakończ">${icon("warning", 15)}</button>`;
  return `<span class="round-btn round-btn--done" title="Zakończone">${icon("check", 15)}</span>`;
}

export function cardHtml(task) {
  return `<article class="card card--${task.status}" data-id="${task.id}" tabindex="0" aria-roledescription="karta zadania"
      aria-label="${escapeHtml(task.title)}. ${STATUS_LABELS[task.status]}. Alt i strzałki przenoszą, Enter otwiera.">
    <h3 class="card__title">${escapeHtml(task.title)}</h3>
    ${chipsHtml(task)}
    ${task.subtaskCount ? `<p class="card__meta">${icon("subtasks", 15)}${task.subtaskDoneCount}/${task.subtaskCount}${task.noteCount ? ` · ${icon("note", 15)}${task.noteCount}` : ""}</p>` : ""}
    <div class="card__foot">
      <span class="card__who">${avatarHtml(task)}</span>
      ${timerHtml(task) || dueHtml(task)}
      <span class="card__action">${actionHtml(task)}</span>
    </div>
  </article>`;
}

export function renderBoard() {
  const cols = columns(visibleTasks());
  return `<div class="board">${STATUSES.map(status => `
    <section class="column column--${status}" data-status="${status}" aria-label="${STATUS_LABELS[status]}">
      <header class="column__head">
        <span class="column__icon">${icon(COLUMN_ICONS[status], 22)}</span>
        <h2>${STATUS_LABELS[status]}</h2><span class="count">${cols[status].length}</span>
        <span class="column__tools">
          <button type="button" class="icon-btn" data-action="new-task" data-status="${status}" aria-label="Dodaj zadanie do kolumny ${STATUS_LABELS[status]}">${icon("plus")}</button>
          <button type="button" class="icon-btn" data-card="only" data-status="${status}" aria-label="Pokaż tylko kolumnę ${STATUS_LABELS[status]}" title="Pokaż tylko tę kolumnę">${icon("more")}</button>
        </span>
      </header>
      <div class="column__cards" data-drop="${status}">
        ${cols[status].map(cardHtml).join("") || `<p class="column__empty">${status === "done" && !store.filters.showDone ? "Zakończone są ukryte." : "Brak zadań. Przeciągnij tu kartę albo dodaj nową."}</p>`}
      </div>
    </section>`).join("")}</div>`;
}

// Next task in the same column (to put a task back where it was).
function nextSibling(task) {
  return store.tasks.filter(t => t.status === task.status).sort(byPosition)
    .find(t => byPosition(t, task) > 0)?.id ?? null;
}

export async function moveTask(id, status, beforeId, { undoable = true } = {}) {
  const task = lookup.task(id);
  if (!task || (task.status === status && nextSibling(task) === beforeId) || beforeId === id) return;
  const previous = store.tasks;
  const back = { status: task.status, beforeId: nextSibling(task) };
  const expected = await sha256Hex(boardCanonical(store.tasks));
  store.tasks = applyMove(store.tasks, id, status, beforeId);
  render();
  try {
    await api.moveTask({ id, status, beforeId, expected });
    if (task.status !== status && undoable) {
      toast(`„${task.title}” → ${STATUS_LABELS[status]}`, { action: "Cofnij", onAction: () => moveTask(id, back.status, back.beforeId, { undoable: false }) });
    }
    await reload({ quiet: true });
  } catch (error) {
    store.tasks = previous;
    render();
    toast(error.status === 409 ? "Tablica zmieniła się w międzyczasie. Odświeżono, spróbuj ponownie." : error.message || "Nie udało się przenieść zadania.", { tone: "error" });
    await reload({ quiet: true });
  }
}

async function cardAction(button) {
  const id = Number(button.closest("[data-id]")?.dataset.id);
  const kind = button.dataset.card;
  if (kind === "only") {
    store.filters.status = store.filters.status === button.dataset.status ? "" : button.dataset.status;
    return render();
  }
  if (kind === "timer-start") {
    // The server stops any other running timer, so every card is refreshed, not only this one.
    if (await runTask(() => api.timer(id, "start"), "Nie udało się uruchomić licznika.")) await reload({ quiet: true });
    return;
  }
  if (kind === "timer-stop") return runTask(() => api.timer(id, "stop"), "Nie udało się zatrzymać licznika.");
  if (kind === "approve") {
    const firstDone = store.tasks.filter(t => t.status === "done").sort(byPosition)[0]?.id ?? null;
    return moveTask(id, "done", firstDone);
  }
}

// ---- pointer drag and drop ---------------------------------------------------------------------------------
function dropTarget(x, y) {
  const zone = document.elementFromPoint(x, y)?.closest("[data-drop]");
  if (!zone) return null;
  const cards = [...zone.querySelectorAll(".card")].filter(card => Number(card.dataset.id) !== drag.id);
  const before = cards.find(card => { const r = card.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { zone, status: zone.dataset.drop, beforeId: before ? Number(before.dataset.id) : null, beforeEl: before || null };
}

function showMarker(target) {
  drag.marker.remove();
  if (!target) return;
  if (target.beforeEl) target.zone.insertBefore(drag.marker, target.beforeEl);
  else target.zone.append(drag.marker);
}

// Near an edge the board (sideways) or the page (vertically) keeps scrolling while the pointer rests there, so a
// card can travel to a column that is off screen on a phone. Returns whether anything scrolled.
function autoScroll(x, y) {
  let scrolled = false;
  const scroller = drag.card.closest(".view")?.querySelector(".board");
  if (scroller) {
    const r = scroller.getBoundingClientRect();
    const before = scroller.scrollLeft;
    if (x < r.left + 48) scroller.scrollLeft -= 12; else if (x > r.right - 48) scroller.scrollLeft += 12;
    scrolled = scroller.scrollLeft !== before;
  }
  const top = window.scrollY;
  if (y < 60) window.scrollBy(0, -12); else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  return scrolled || window.scrollY !== top;
}

function scrollLoop() {
  if (!drag?.active) return;
  if (autoScroll(drag.lastX, drag.lastY)) { drag.target = dropTarget(drag.lastX, drag.lastY); showMarker(drag.target); }
  drag.frame = requestAnimationFrame(scrollLoop);
}

function beginDrag() {
  const rect = drag.card.getBoundingClientRect();
  drag.active = true;
  drag.ghost = drag.card.cloneNode(true);
  drag.ghost.classList.add("card--ghost");
  drag.ghost.removeAttribute("tabindex");
  drag.ghost.style.width = `${rect.width}px`;
  drag.offsetX = drag.x - rect.left;
  drag.offsetY = drag.y - rect.top;
  document.body.append(drag.ghost);
  drag.marker = document.createElement("div");
  drag.marker.className = "drop-marker";
  drag.marker.style.height = `${rect.height}px`;
  drag.card.classList.add("is-dragging");
  document.body.classList.add("is-dragging");
  try { drag.card.setPointerCapture(drag.pointerId); } catch { /* pointer already gone */ }
  drag.lastX = drag.x;
  drag.lastY = drag.y;
  drag.frame = requestAnimationFrame(scrollLoop);
}

function moveGhost(x, y) {
  drag.ghost.style.transform = `translate(${x - drag.offsetX}px, ${y - drag.offsetY}px) rotate(1.5deg)`;
  drag.lastX = x;
  drag.lastY = y;
  drag.target = dropTarget(x, y);
  showMarker(drag.target);
}

function endDrag(commit) {
  if (!drag) return;
  clearTimeout(drag.hold);
  cancelAnimationFrame(drag.frame);
  const { active, target, id } = drag;
  if (active) {
    drag.ghost.remove();
    drag.marker.remove();
    drag.card.classList.remove("is-dragging");
    document.body.classList.remove("is-dragging");
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag = null;
  if (active && commit && target) moveTask(id, target.status, target.beforeId);
}

export function bindBoard(root) {
  const view = root.querySelector(".view");

  view.addEventListener("pointerdown", event => {
    if (view.dataset.view !== "board" || event.button !== 0) return;
    const card = event.target.closest(".card");
    if (!card || event.target.closest("button, a, input")) return;
    drag = { id: Number(card.dataset.id), card, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false, touch: event.pointerType !== "mouse" };
    // Touch: hold briefly to pick a card up, so scrolling the board keeps working.
    if (drag.touch) drag.hold = setTimeout(() => { if (drag && !drag.active) { beginDrag(); moveGhost(drag.x, drag.y); navigator.vibrate?.(15); } }, TOUCH_HOLD_MS);
  });

  view.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (!drag.active) {
      if (drag.touch) { if (distance > 10) endDrag(false); return; }
      if (distance < DRAG_THRESHOLD) return;
      beginDrag();
    }
    event.preventDefault();
    moveGhost(event.clientX, event.clientY);
  });

  view.addEventListener("pointerup", event => { if (drag && event.pointerId === drag.pointerId) endDrag(true); });
  view.addEventListener("pointercancel", () => endDrag(false));
  view.addEventListener("touchmove", event => { if (drag?.active) event.preventDefault(); }, { passive: false });
  view.addEventListener("contextmenu", event => { if (drag) event.preventDefault(); });

  view.addEventListener("click", event => {
    if (view.dataset.view !== "board") return;
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); return; }
    const button = event.target.closest("[data-card]");
    if (button) { event.stopPropagation(); cardAction(button); return; }
    const card = event.target.closest(".card");
    if (card && !event.target.closest("button")) openDrawer(Number(card.dataset.id));
  }, true);

  // Keyboard: Enter opens; Alt+↑/↓ reorders within the column; Alt+←/→ moves to the neighbouring column.
  view.addEventListener("keydown", event => {
    const card = event.target.closest?.(".card");
    if (!card || view.dataset.view !== "board") return;
    const id = Number(card.dataset.id);
    const task = lookup.task(id);
    if (event.key === "Enter") { event.preventDefault(); openDrawer(id); return; }
    if (!event.altKey || !task) return;
    const list = store.tasks.filter(t => t.status === task.status).sort(byPosition);
    const index = list.findIndex(t => t.id === id);
    let move = null;
    if (event.key === "ArrowUp" && index > 0) move = [task.status, list[index - 1].id];
    if (event.key === "ArrowDown" && index < list.length - 1) move = [task.status, list[index + 2]?.id ?? null];
    const column = STATUSES.indexOf(task.status) + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0);
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && STATUSES[column]) move = [STATUSES[column], null];
    if (!move) return;
    event.preventDefault();
    moveTask(id, move[0], move[1]).then(() => root.querySelector(`.card[data-id="${id}"]`)?.focus());
  });
}
