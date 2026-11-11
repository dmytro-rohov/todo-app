// Calendar view: task deadlines and the meetings of the connected Google Calendars. Month (drag a task to another
// day to move its deadline), week with hours (click a free slot for a meeting), and an agenda on phones.
import { api } from "../api/client.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/helpers.js";
import { icon } from "../../vendor/mytko-kit/js/icons.js";
import { addDays, byPosition, isoDay, monthGrid, MONTHS, MONTHS_SHORT, shiftMonth, STATUS_LABELS, WEEKDAYS } from "./logic.js";
import { lookup, render, runTask, store, visibleTasks } from "./app.js";
import { calendarState, ensureEvents, eventsByDay, eventTime, hasCalendars, openMeeting, scopedEvents } from "./meetings.js";
import { openDrawer } from "./drawer.js";
import { openNewTask } from "./dialogs.js";
import { uiScale } from "../../vendor/mytko-kit/js/ui-scale.js";
import { LOCALE } from "../i18n.js";

const PER_DAY = 3;
const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_PX = 48;
let dragged = null;

const phone = () => window.matchMedia("(max-width: 600px)").matches;

function weekStart(day) {
  const [y, m, d] = day.split("-").map(Number);
  return addDays(day, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}

function spaceColor(event) {
  return escapeHtml(lookup.space(event.spaceId)?.color || "#b7e34d");
}

function meetingChip(event) {
  return `<button type="button" class="event event--meeting" data-cal="meeting" data-event="${event.id}" data-c="${spaceColor(event)}" title="${escapeHtml(event.title)} · ${escapeHtml(eventTime(event))}">${event.allDay ? "" : `<b>${escapeHtml(eventTime(event).slice(0, 5))}</b> `}${escapeHtml(event.title)}</button>`;
}

function modeSwitch() {
  return `<div class="seg" role="group" aria-label="Zakres"><button type="button" data-cal="mode" data-mode="month" aria-pressed="${store.calendarMode !== "week"}">Miesiąc</button><button type="button" data-cal="mode" data-mode="week" aria-pressed="${store.calendarMode === "week"}">Tydzień</button></div>`;
}

function meetingButton() {
  return hasCalendars() ? `<button type="button" class="btn btn--primary btn--sm" data-cal="new-meeting">${icon("plus", 16)}Spotkanie</button>` : "";
}

// Week: hours down, days across; all-day items in a row on top.
function renderWeek(byDay, meetingsByDay, today) {
  const start = weekStart(store.calendarDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6];
  ensureEvents(start, end);
  const short = day => `${Number(day.slice(8))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  return `<div class="calendar calendar--week">
    <div class="calendar__bar">
      <button type="button" class="icon-btn icon-btn--box" data-cal="prev" aria-label="Poprzedni tydzień">${icon("chevronLeft")}</button>
      <h2>${short(start)} – ${short(end)} ${end.slice(0, 4)}</h2>
      <button type="button" class="icon-btn icon-btn--box" data-cal="next" aria-label="Następny tydzień">${icon("chevronRight")}</button>
      <button type="button" class="btn btn--ghost" data-cal="today">Dziś</button>
      <span class="calendar__spacer"></span>${modeSwitch()}${meetingButton()}
    </div>
    <div class="week">
      <div class="week__head"><span></span>${days.map((day, i) => `<span class="${day === today ? "is-today" : ""}">${WEEKDAYS[i]} <b>${Number(day.slice(8))}</b></span>`).join("")}</div>
      <div class="week__allday"><span class="week__label">cały dzień</span>${days.map(day => `<div data-day="${day}" class="day week__cell">${(meetingsByDay.get(day) || []).filter(e => e.allDay).map(meetingChip).join("")}${(byDay.get(day) || []).map(task => `<button type="button" class="event event--${task.status}" draggable="true" data-cal="open" data-id="${task.id}">${escapeHtml(task.title)}</button>`).join("")}</div>`).join("")}</div>
      <div class="week__scroll"><div class="week__body">
        <div class="week__hours">${hours.map(h => `<span>${String(h).padStart(2, "0")}:00</span>`).join("")}</div>
        ${days.map(day => `<div class="week__col${day === today ? " is-today" : ""}">
          ${hours.map(h => `<button type="button" class="week__slot" data-cal="slot" data-day="${day}" data-hour="${h}" aria-label="Nowe spotkanie ${day} ${h}:00"></button>`).join("")}
          ${(meetingsByDay.get(day) || []).filter(e => !e.allDay).map(e => {
            const s = new Date(e.startAt);
            const en = new Date(e.endAt);
            const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - HOUR_START) * HOUR_PX);
            const height = Math.max(22, (en - s) / 3600000 * HOUR_PX);
            // up to an hour: time and title on one line, so the title is never cut to nothing
            return `<button type="button" class="week__event${height <= 60 ? " is-short" : ""}" data-cal="meeting" data-event="${e.id}" data-c="${spaceColor(e)}" data-top="${Math.round(top)}" data-h="${Math.round(height)}" title="${escapeHtml(eventTime(e))} ${escapeHtml(e.title)}"><b>${escapeHtml(height <= 60 ? eventTime(e).slice(0, 5) : eventTime(e))}</b><span>${escapeHtml(e.title)}</span></button>`;
          }).join("")}
        </div>`).join("")}
      </div></div>
    </div>
  </div>`;
}

// Positions the week's events (CSSOM, not style attributes: the CSP allows no inline styles).
export function afterCalendarRender(view) {
  for (const node of view.querySelectorAll(".week__event")) {
    // rem, like the hour grid: the events scale with the interface
    node.style.top = `${node.dataset.top / 16}rem`;
    node.style.height = `${node.dataset.h / 16}rem`;
  }
  const scroll = view.querySelector(".week__scroll");
  if (scroll && !scroll.dataset.placed) { scroll.scrollTop = (8 - HOUR_START) * HOUR_PX * uiScale(); scroll.dataset.placed = "1"; }
}

// Phones: a compact month with dots, and the chosen day's tasks below it (titles stay readable).
function renderAgenda(byDay, today, meetingsByDay) {
  const [y, m] = store.month.split("-").map(Number);
  const day = store.calendarDay.slice(0, 7) === store.month.slice(0, 7) ? store.calendarDay : (today.slice(0, 7) === store.month.slice(0, 7) ? today : `${store.month.slice(0, 7)}-01`);
  const list = byDay.get(day) || [];
  const meetings = meetingsByDay.get(day) || [];
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });
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
        const tasks = [...(meetingsByDay.get(cell.day) || []).map(() => ({ status: "meeting" })), ...(byDay.get(cell.day) || [])];
        return `<button type="button" role="gridcell" class="mini__day${cell.inMonth ? "" : " is-out"}${cell.day === today ? " is-today" : ""}${cell.day === day ? " is-selected" : ""}" data-cal="pick" data-day="${cell.day}" aria-label="${cell.day}${tasks.length ? `, ${tasks.length} zadań` : ""}">
          <span>${Number(cell.day.slice(8))}</span><span class="mini__dots">${tasks.slice(0, 3).map(t => `<i class="mini__dot mini__dot--${t.status}"></i>`).join("")}</span></button>`;
      }).join("")}
    </div>
    <section class="agenda" aria-live="polite">
      <h3>${escapeHtml(label)}<span class="agenda__actions"><button type="button" class="btn btn--ghost btn--sm" data-cal="add" data-day="${day}">${icon("plus", 16)}Zadanie</button>${hasCalendars() ? `<button type="button" class="btn btn--ghost btn--sm" data-cal="new-meeting" data-day="${day}">${icon("plus", 16)}Spotkanie</button>` : ""}</span></h3>
      ${meetings.map(e => `<button type="button" class="agenda__item agenda__item--meeting" data-cal="meeting" data-event="${e.id}" data-c="${spaceColor(e)}"><span class="agenda__title">${escapeHtml(e.title)}</span><span class="muted">${escapeHtml(eventTime(e))}${e.meetUrl ? " · Google Meet" : ""}</span></button>`).join("")}
      ${list.length ? list.map(task => `<button type="button" class="agenda__item event--${task.status}" data-cal="open" data-id="${task.id}">
          <span class="agenda__title">${escapeHtml(task.title)}</span><span class="muted">${STATUS_LABELS[task.status]}</span></button>`).join("")
        : meetings.length ? "" : '<p class="muted">Brak zadań i spotkań w tym dniu.</p>'}
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
  const meetingsByDay = eventsByDay(scopedEvents());
  if (store.calendarMode === "week" && !phone()) return renderWeek(byDay, meetingsByDay, today);
  const cells = monthGrid(store.month).flat();
  ensureEvents(cells[0].day, cells.at(-1).day);
  if (phone()) return renderAgenda(byDay, today, meetingsByDay);
  return `<div class="calendar">
    <div class="calendar__bar">
      <button type="button" class="icon-btn icon-btn--box" data-cal="prev" aria-label="Poprzedni miesiąc">${icon("chevronLeft")}</button>
      <h2>${MONTHS[m - 1]} ${y}</h2>
      <button type="button" class="icon-btn icon-btn--box" data-cal="next" aria-label="Następny miesiąc">${icon("chevronRight")}</button>
      <button type="button" class="btn btn--ghost" data-cal="today">Dziś</button>
      <span class="calendar__note">${undated ? `${undated} otwartych bez terminu` : ""}</span>${modeSwitch()}${meetingButton()}
    </div>
    <div class="calendar__grid" role="grid" aria-label="${MONTHS[m - 1]} ${y}">
      ${WEEKDAYS.map(d => `<div class="calendar__weekday" role="columnheader">${d}</div>`).join("")}
      ${monthGrid(store.month).flat().map(({ day, inMonth }) => {
        const list = byDay.get(day) || [];
        const meetings = meetingsByDay.get(day) || [];
        const shownMeetings = meetings.slice(0, PER_DAY);
        const shownTasks = list.slice(0, PER_DAY - shownMeetings.length);
        const hidden = list.length + meetings.length - shownMeetings.length - shownTasks.length;
        return `<div class="day${inMonth ? "" : " day--out"}${day === today ? " day--today" : ""}${day < today ? " day--past" : ""}" role="gridcell" data-day="${day}">
          <button type="button" class="day__num" data-cal="add" aria-label="Dodaj zadanie na ${day}">${Number(day.slice(8))}</button>
          ${shownMeetings.map(meetingChip).join("")}
          ${shownTasks.map(task => `<button type="button" class="event event--${task.status}" draggable="true" data-cal="open" data-id="${task.id}" title="${escapeHtml(task.title)} — ${STATUS_LABELS[task.status]}">${escapeHtml(task.title)}</button>`).join("")}
          ${hidden > 0 ? `<button type="button" class="day__more" data-cal="more" data-day="${day}">+${hidden} więcej</button>` : ""}
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
    const week = store.calendarMode === "week" && !phone();
    if (kind === "prev" || kind === "next") {
      if (week) store.calendarDay = addDays(store.calendarDay, kind === "prev" ? -7 : 7);
      else store.month = shiftMonth(store.month, kind === "prev" ? -1 : 1);
      render();
    }
    else if (kind === "today") { store.month = isoDay(); store.calendarDay = isoDay(); render(); }
    else if (kind === "mode") { store.calendarMode = button.dataset.mode; if (store.calendarMode === "week" && store.month.slice(0, 7) !== store.calendarDay.slice(0, 7)) store.calendarDay = store.month; render(); }
    else if (kind === "meeting") openMeeting(calendarState.events.find(e => e.id === Number(button.dataset.event)) || calendarState.today.find(e => e.id === Number(button.dataset.event)));
    else if (kind === "new-meeting") openMeeting(null, { day: button.dataset.day || (week ? store.calendarDay : isoDay()) });
    else if (kind === "slot") openMeeting(null, { day: button.dataset.day, start: `${String(button.dataset.hour).padStart(2, "0")}:00` });
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
