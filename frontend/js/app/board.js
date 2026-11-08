// Board view: four columns, cards, drag and drop (mouse, touch, keyboard) and the card actions.
import { api, sha256Hex } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { applyMove, boardCanonical, byPosition, columns, dueLabel, dueState, formatClock, formatDuration, goalLabel, initials, PRIORITY_LABELS, STATUSES,
  STATUS_LABELS, trackedNow } from "./logic.js";
import { lookup, reload, render, runTask, store, visibleTasks } from "./app.js";
import { openDrawer } from "./drawer.js";
import { retentionNote } from "./archive.js";
import { toast } from "./toast.js";

const COLUMN_ICONS = { todo: "circle", in_progress: "play", needs_review: "warning", done: "checkCircle", planned: "target" };
const DRAG_THRESHOLD = 6;
const TOUCH_HOLD_MS = 280;
let drag = null;
let suppressClick = false;

export const isDragging = () => drag?.active === true;

// Where the task stands in the Mytko Workflow ToDo (C6), or "" when it was never sent.
const WORKFLOW = { requested: "Czeka na Workflow", todo: "W Workflow", in_progress: "Workflow: w realizacji", needs_attention: "Workflow: wymaga uwagi",
  done: "Workflow: zrobione", withdrawn: "Wycofane z Workflow" };
export function workflowLabel(task) {
  if (!task.workflowStatus || task.workflowStatus === "cancelled") return "";
  return WORKFLOW[task.workflowStatus] || "W Workflow";
}

// P0, P1 and P3 are marked on the card; the default P2 is not (it would be on every card).
function priorityHtml(task) {
  if (!["P0", "P1", "P3"].includes(task.priority)) return "";
  return `<span class="chip chip--priority chip--${task.priority.toLowerCase()}" title="Priorytet ${task.priority}">${icon("flag", 14)}${PRIORITY_LABELS[task.priority]}</span>`;
}

export function chipsHtml(task) {
  const priorityChip = priorityHtml(task);
  const project = lookup.project(task.projectId);
  const client = lookup.client(lookup.clientOf(task));
  const clientChip = client ? `<span class="chip chip--client" data-c="${escapeHtml(client.color)}">${icon("user", 14)}${escapeHtml(client.name)}</span>` : "";
  const projectChip = project ? `<span class="chip chip--project" data-c="${escapeHtml(project.color)}">${icon("folder", 15)}${escapeHtml(project.name)}</span>` : "";
  const labels = (task.labelIds || []).map(lookup.label).filter(Boolean).map(label =>
    `<span class="chip chip--label" data-c="${escapeHtml(label.color)}"><i class="dot"></i>${escapeHtml(label.name)}</span>`).join("");
  const flow = workflowLabel(task);
  const workflowChip = flow ? `<span class="chip chip--workflow" title="Mytko Workflow">${icon("layers", 14)}${escapeHtml(flow)}</span>` : "";
  return priorityChip || clientChip || projectChip || labels || workflowChip
    ? `<div class="chips">${priorityChip}${workflowChip}${clientChip}${projectChip}${labels}</div>` : "";
}

export function avatarHtml(task) {
  const person = lookup.assignee(task.assigneeId);
  return person
    ? `<span class="avatar" data-c="${escapeHtml(person.color)}" title="${escapeHtml(person.name)}">${escapeHtml(initials(person.name))}</span>`
    : `<span class="avatar avatar--empty" title="Bez wykonawcy">${icon("user", 16)}</span><span class="muted">–</span>`;
}

export function dueHtml(task) {
  if (task.status === "planned") return `<span class="due due--goal">${icon("target", 17)}${escapeHtml(goalLabel(task.dueDate))}</span>`;
  if (!task.dueDate) return "";
  const state = dueState(task);
  return `<span class="due${state ? ` due--${state}` : ""}">${icon("calendar", 17)}${escapeHtml(dueLabel(task.dueDate))}</span>`;
}

// A running timer ticks every second (tickTimers); recorded time shows in every column, done tasks included.
export function timerHtml(task) {
  const seconds = trackedNow(task, store.fetchedAt);
  if (!seconds && !task.timerStartedAt) return "";
  return task.timerStartedAt
    ? `<span class="timer is-running" ${timerData(task)}>${icon("clock", 16)}<span>${formatClock(seconds)}</span></span>`
    : `<span class="timer" title="Zarejestrowany czas">${icon("clock", 16)}${formatDuration(seconds)}</span>`;
}

// What tickTimers needs: seconds recorded when the task was read, and when it was read.
export function timerData(task) {
  return `data-timer data-base="${task.trackedSeconds || 0}" data-at="${task.fetchedAt ?? store.fetchedAt ?? Date.now()}"`;
}

// Updates every running timer's text in place (no re-render: drags, focus and scroll stay untouched).
export function tickTimers(root) {
  const now = Date.now();
  for (const node of root.querySelectorAll("[data-timer]")) {
    const seconds = Number(node.dataset.base) + Math.max(0, (now - Number(node.dataset.at)) / 1000);
    const text = node.querySelector(":scope > span") || node;
    text.textContent = formatClock(seconds);
  }
}

function actionHtml(task) {
  const title = escapeHtml(task.title);
  if (task.status === "todo") return `<button type="button" class="round-btn" data-card="timer-start" aria-label="Rozpocznij pracę: ${title}" title="Rozpocznij pracę">${icon("play", 14)}</button>`;
  if (task.status === "in_progress") {
    return task.timerStartedAt
      ? `<button type="button" class="round-btn is-running" data-card="timer-stop" aria-label="Zatrzymaj licznik: ${title}" title="Zatrzymaj licznik">${icon("pauseCircle", 20)}</button>`
      : `<button type="button" class="round-btn" data-card="timer-start" aria-label="Wznów licznik: ${title}" title="Wznów licznik">${icon("play", 14)}</button>`;
  }
  if (task.status === "planned") return `<button type="button" class="round-btn round-btn--plan" data-card="to-todo" aria-label="Przenieś do ToDo: ${title}" title="Przenieś do ToDo">${icon("arrowLeft", 15)}</button>`;
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
  return `<div class="board-wrap">
    <div class="board__bar">
      <button type="button" class="board__peek" data-card="peek" aria-label="Przewiń do kolumny Plany długoterminowe">
        ${icon("target", 17)}<span>Plany długoterminowe</span><em>${cols.planned.length}</em>${icon("chevronRight", 17)}</button>
      <button type="button" class="board__peek board__peek--back" data-card="peek-back" aria-label="Wróć do początku tablicy">
        ${icon("chevronLeft", 17)}<span>Wróć do tablicy</span></button>
    </div>
    <div class="board">${STATUSES.map(status => `
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
      ${status === "done" && retentionNote() ? `<p class="column__note">${icon("archive", 15)}${retentionNote()}</p>` : ""}
      ${status === "planned" ? `<p class="column__note">${icon("target", 15)}Cele na rok, dwa, pięć lat. Nie liczą się do „Otwarte” i terminów.</p>` : ""}
    </section>`).join("")}</div></div>`;
}

// The fifth column waits off screen to the right; the peek button shows until the board is scrolled to its end.
export function updatePeek(view) {
  const board = view.querySelector(".board");
  if (!board) return;
  const atEnd = board.scrollLeft + board.clientWidth >= board.scrollWidth - 8;
  view.querySelector(".board-wrap")?.classList.toggle("is-end", atEnd);
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
  if (kind === "peek" || kind === "peek-back") {
    const board = button.closest(".board-wrap").querySelector(".board");
    return board.scrollTo({ left: kind === "peek" ? board.scrollWidth : 0, behavior: "smooth" });
  }
  if (kind === "to-todo") return moveTask(id, "todo", null);
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
  // the column under the pointer scrolls too, so a card reaches any place in a long column
  const column = document.elementFromPoint(x, y)?.closest(".column__cards");
  if (column && column.scrollHeight > column.clientHeight) {
    const r = column.getBoundingClientRect();
    const before = column.scrollTop;
    column.scrollTop += edgeSpeed(y - r.top) ? -edgeSpeed(y - r.top) : edgeSpeed(r.bottom - y);
    scrolled = scrolled || column.scrollTop !== before;
  }
  // Over a column only the column scrolls: moving the page too would pull the column away from the pointer.
  if (column) return scrolled;
  const top = window.scrollY;
  if (y < 60) window.scrollBy(0, -12); else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  return scrolled || window.scrollY !== top;
}

// Pixels per frame: faster the closer the pointer is to the edge (0 outside the 48 px band).
function edgeSpeed(distance) {
  return distance < 48 ? Math.round(4 + 28 * (1 - Math.max(0, distance) / 48)) : 0;
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
  view.addEventListener("scroll", event => { if (event.target.classList?.contains("board")) updatePeek(view); }, true);

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
