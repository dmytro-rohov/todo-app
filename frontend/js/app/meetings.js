// Meetings: events of the Google Calendars connected to spaces (read, created and edited through Tasks).
import { api } from "../api/client.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/core.js";
import { icon } from "../../vendor/mytko-kit/js/icons.js";
import { addDays, isoDay, STATUS_LABELS } from "./logic.js";
import { lookup, reload, render, store } from "./app.js";
import { confirmDialog, dialog } from "./dialogs.js";
import { openDrawer } from "./drawer.js";
import { openBrief } from "./brief.js";
import { toast } from "../../vendor/mytko-kit/js/ui.js";
import { LOCALE } from "../i18n.js";

export const calendarState = { configured: false, accounts: [], events: [], rangeKey: "", today: [] };

export const accountFor = spaceId => calendarState.accounts.find(a => a.spaceId === spaceId);
export const hasCalendars = () => calendarState.configured && calendarState.accounts.length > 0;

// Local calendar day of an event (all-day events are stored at UTC midnight of their date).
export function eventDay(event) {
  return event.allDay ? new Date(event.startAt).toISOString().slice(0, 10) : isoDay(new Date(event.startAt));
}

export function eventTime(event) {
  if (event.allDay) return "cały dzień";
  const f = d => new Date(d).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  return `${f(event.startAt)}–${f(event.endAt)}`;
}

// Events within the current space / project scope (a project narrows to its space).
export function scopedEvents(events = calendarState.events) {
  const project = lookup.project(store.filters.projectId);
  const spaceId = project ? project.spaceId : store.filters.spaceId;
  return spaceId ? events.filter(e => e.spaceId === spaceId) : events;
}

export function eventsByDay(events) {
  const map = new Map();
  for (const event of events) {
    if (event.allDay) {
      // a multi-day event shows on each of its days
      for (let day = eventDay(event); day < new Date(event.endAt).toISOString().slice(0, 10); day = addDays(day, 1)) {
        if (!map.has(day)) map.set(day, []);
        map.get(day).push(event);
      }
    } else {
      const day = eventDay(event);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(event);
    }
  }
  for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
  return map;
}

export async function loadCalendarAccounts() {
  try {
    Object.assign(calendarState, await api.calendarAccounts());
  } catch { calendarState.configured = false; }
}

// Loads the events of [from, to] once per range (and again on refresh). Re-renders when they arrive.
export async function ensureEvents(from, to, { force = false } = {}) {
  if (!hasCalendars()) return;
  const key = `${from}:${to}`;
  if (!force && calendarState.rangeKey === key) return;
  calendarState.rangeKey = key;
  try {
    calendarState.events = await api.events(from, to);
    render();
  } catch { calendarState.rangeKey = ""; }
}

export async function loadToday() {
  if (!hasCalendars()) return;
  const today = isoDay();
  try { calendarState.today = (await api.events(today, today)).filter(e => eventDay(e) === today); } catch { /* the bell works without it */ }
}

function emails(text) {
  return text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

function localTime(value) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Create (preset: { day, start }) or edit (event) a meeting.
export function openMeeting(event = null, preset = {}) {
  const spaces = store.spaces.filter(s => accountFor(s.id));
  if (!spaces.length) {
    toast("Najpierw podłącz kalendarz Google do przestrzeni (Porządek → Przestrzenie).");
    return;
  }
  const editing = Boolean(event);
  const day = editing ? eventDay(event) : preset.day || isoDay();
  const start = editing ? (event.allDay ? "09:00" : localTime(event.startAt)) : preset.start || "10:00";
  const end = editing ? (event.allDay ? "10:00" : localTime(event.endAt)) : preset.end || `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, "0")}:${start.slice(3)}`;
  const defaultSpace = editing ? event.spaceId : (accountFor(store.filters.spaceId) ? store.filters.spaceId : spaces[0].id);
  const element = dialog("dialog--meeting", `
    <form class="dialog__body" novalidate>
      <header class="dialog__head"><h2>${editing ? "Spotkanie" : "Nowe spotkanie"}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
      ${editing ? `<button type="button" class="btn btn--ghost btn--sm meet-brief" data-brief-open>${icon("note", 16)}Brief ze spotkania</button>` : ""}
      ${editing && event.meetUrl ? `<a class="btn btn--primary meet-join" href="${escapeHtml(event.meetUrl)}" target="_blank" rel="noopener noreferrer">${icon("users", 18)}Dołącz do Google Meet</a>` : ""}
      <label class="field"><span>Tytuł</span><input name="title" maxlength="500" required value="${escapeHtml(editing ? event.title : preset.title || "")}" placeholder="Spotkanie z…"></label>
      <label class="field"><span>Klient</span><span class="select"><select name="clientId"><option value="">Bez klienta</option>${store.clients.filter(c => c.status !== "archived" || c.id === event?.clientId).map(c => `<option value="${c.id}"${c.id === (editing ? event.clientId : preset.clientId) ? " selected" : ""}>${escapeHtml(c.name)}${c.status === "lead" ? " (lead)" : ""}</option>`).join("")}</select>${icon("chevronDown", 16)}</span></label>
      <div class="field-row">
        <label class="field"><span>Przestrzeń</span><span class="select"><select name="spaceId"${editing ? " disabled" : ""}>${spaces.map(s => `<option value="${s.id}"${s.id === defaultSpace ? " selected" : ""}>${escapeHtml(s.name)} · ${escapeHtml(accountFor(s.id).accountEmail)}</option>`).join("")}</select>${icon("chevronDown", 16)}</span></label>
        <label class="field"><span>Dzień</span><input type="date" name="day" value="${day}" required></label>
      </div>
      <div class="field-row field-row--time">
        <label class="field"><span>Od</span><input type="time" name="start" value="${start}"></label>
        <label class="field"><span>Do</span><input type="time" name="end" value="${end}"></label>
        <label class="check"><input type="checkbox" name="allDay"${editing && event.allDay ? " checked" : ""}>Cały dzień</label>
      </div>
      <label class="field"><span>Goście (e-maile, dostaną zaproszenie od Google)</span><input name="attendees" value="${escapeHtml(editing ? (event.attendees || []).filter(a => !a.self).map(a => a.email).join(", ") : (preset.attendees || []).join(", "))}" placeholder="klient@firma.pl"></label>
      <label class="check"><input type="checkbox" name="meet"${editing ? (event.meetUrl ? " checked disabled" : "") : " checked"}>Dodaj link Google Meet</label>
      <label class="field"><span>Miejsce</span><input name="location" maxlength="500" value="${editing ? escapeHtml(event.location) : ""}"></label>
      <label class="field"><span>Opis</span><textarea class="textarea" name="description" rows="3" maxlength="8000">${editing ? escapeHtml(event.description) : ""}</textarea></label>
      ${editing && event.attendees?.length ? `<ul class="guests">${event.attendees.map(a => `<li><span>${escapeHtml(a.name || a.email)}</span><small class="muted">${escapeHtml(a.email)} · ${{ accepted: "przyjął", declined: "odrzucił", tentative: "może", needsAction: "bez odpowiedzi" }[a.response] || ""}</small></li>`).join("")}</ul>` : ""}
      ${editing ? `<section class="client-section"><h3>${icon("checkSquare", 18)}Zadania do spotkania</h3>
        ${store.tasks.filter(t => t.meetingId === event.id).map(t => `<button type="button" class="client-row" data-task="${t.id}"><span>${escapeHtml(t.title)}</span><small class="muted">${STATUS_LABELS[t.status] || ""}</small></button>`).join("")}
        <div class="inline-add"><input name="newTask" maxlength="100" placeholder="Np. przygotować wycenę…" aria-label="Nowe zadanie do spotkania"><button type="button" class="icon-btn icon-btn--box" data-add-task aria-label="Dodaj zadanie do spotkania">${icon("plus")}</button></div>
      </section>` : ""}
      <p class="field-error" data-error hidden></p>
      <div class="dialog__actions">
        ${editing ? `<button type="button" class="btn btn--ghost" data-delete>${icon("trash", 18)}Usuń</button>${event.htmlLink ? `<a class="btn btn--ghost" href="${escapeHtml(event.htmlLink)}" target="_blank" rel="noopener noreferrer">Google Calendar</a>` : ""}` : ""}
        <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
        <button type="submit" class="btn btn--primary">${editing ? "Zapisz" : `${icon("plus")}Dodaj spotkanie`}</button>
      </div>
    </form>`);
  const form = element.querySelector("form");
  const box = form.querySelector("[data-error]");
  const fail = message => { box.textContent = message; box.hidden = false; };
  const syncAllDay = () => { for (const name of ["start", "end"]) form[name].disabled = form.allDay.checked; };
  form.allDay.addEventListener("change", syncAllDay);
  syncAllDay();
  form.title.focus();
  form.newTask?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    form.querySelector("[data-add-task]").click();
  });
  element.addEventListener("click", async e => {
    if (e.target.closest("[data-close]")) return element.close();
    if (e.target.closest("[data-brief-open]")) { element.close(); return openBrief({ event }); }
    const linked = e.target.closest("[data-task]");
    if (linked) { element.close(); return openDrawer(Number(linked.dataset.task)); }
    if (e.target.closest("[data-add-task]")) {
      const title = form.newTask.value.trim();
      if (title.length < 3) return fail("Tytuł zadania musi mieć co najmniej 3 znaki.");
      try {
        await api.createTask({ title, date: isoDay(), dueDate: eventDay(event), meetingId: event.id, spaceId: event.spaceId,
          clientId: Number(form.clientId.value) || null });
        element.close();
        toast("Zadanie dodane do spotkania.");
        await reload({ quiet: true });
        return openMeeting({ ...event, ...(calendarState.events.find(x => x.id === event.id) || {}), taskCount: (event.taskCount || 0) + 1 });
      } catch (error) { return fail(error.message || "Nie udało się dodać zadania."); }
    }
    if (!e.target.closest("[data-delete]")) return;
    if (!(await confirmDialog(`Usunąć „${event.title}”? Goście dostaną odwołanie.`, "Usuń"))) return;
    try {
      await api.deleteEvent(event.id);
      element.close();
      toast("Spotkanie usunięte.");
      refreshEvents();
    } catch (error) { fail(error.message || "Nie udało się usunąć."); }
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return fail("Podaj tytuł.");
    const allDay = form.allDay.checked;
    const body = { title, description: form.description.value, location: form.location.value, attendees: emails(form.attendees.value), allDay };
    if (allDay) {
      body.start = form.day.value;
      body.end = addDays(form.day.value, 1);
    } else {
      const from = new Date(`${form.day.value}T${form.start.value}`);
      const to = new Date(`${form.day.value}T${form.end.value}`);
      if (!(to > from)) return fail("Koniec musi być po początku.");
      body.start = from.toISOString();
      body.end = to.toISOString();
    }
    if (!form.meet.disabled) body.meet = form.meet.checked;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const clientId = Number(form.clientId.value) || null;
      const saved = editing ? await api.updateEvent(event.id, body) : await api.createEvent({ ...body, spaceId: Number(form.spaceId.value) });
      if ((saved.clientId ?? null) !== clientId) await api.setEventClient(saved.id, clientId);
      element.close();
      toast(editing ? "Spotkanie zapisane." : body.attendees.length ? "Spotkanie dodane, zaproszenia wysłane." : "Spotkanie dodane.");
      refreshEvents();
    } catch (error) {
      submit.disabled = false;
      fail(error.message || "Nie udało się zapisać spotkania.");
    }
  });
}

export function refreshEvents() {
  const [from, to] = calendarState.rangeKey.split(":");
  if (from) ensureEvents(from, to, { force: true });
  loadToday().then(render);
}
