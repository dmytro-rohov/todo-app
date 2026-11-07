// Client card (CRM-lite): details, status (lead → client), projects, open tasks and meetings of one client.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { addDays, dueLabel, isoDay, isOpen, STATUS_LABELS } from "./logic.js";
import { lookup, reload, setFilter, store } from "./app.js";
import { confirmDialog, dialog, openNewTask } from "./dialogs.js";
import { openDrawer } from "./drawer.js";
import { calendarState, eventDay, eventTime, openMeeting } from "./meetings.js";
import { toast } from "./toast.js";

const STATUS = { lead: "Lead", client: "Klient", archived: "Archiwum" };

export async function openClient(id) {
  const client = lookup.client(id);
  if (!client) return;
  // The client's meetings from a month back to three months ahead (the API serves at most 120 days at once).
  let meetings = [];
  if (calendarState.accounts.length) {
    try { meetings = await api.events(addDays(isoDay(), -30), addDays(isoDay(), 89), id); } catch { /* the card still opens */ }
  }
  const projects = store.projects.filter(p => p.clientId === id && !p.archivedAt);
  const tasks = store.tasks.filter(t => lookup.clientOf(t) === id && isOpen(t));
  const now = new Date().toISOString();
  const upcoming = meetings.filter(e => e.endAt >= now).slice(0, 5);
  const recent = meetings.filter(e => e.endAt < now).slice(-3).reverse();
  const meetingRow = (e, past) => `<button type="button" class="client-row${past ? " is-past" : ""}" data-meeting="${e.id}"><span>${escapeHtml(e.title)}</span>
    <small class="muted">${past ? "Odbyło się · " : ""}${escapeHtml(eventDay(e))} · ${escapeHtml(eventTime(e))}${e.taskCount ? ` · zadania: ${e.taskCount}` : ""}</small></button>`;
  const field = (name, label, value, type = "text") =>
    `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value || "")}" maxlength="300"></label>`;
  const element = dialog("dialog--client", `
    <form class="dialog__body" novalidate>
      <header class="dialog__head"><h2><span class="client-dot" data-c="${escapeHtml(client.color)}"></span>${escapeHtml(client.name)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
      <div class="client-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-act="tasks">${icon("checkSquare", 16)}Zadania (${tasks.length})</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="task">${icon("plus", 16)}Zadanie</button>
        ${calendarState.accounts.length ? `<button type="button" class="btn btn--ghost btn--sm" data-act="meeting">${icon("calendar", 16)}Spotkanie</button>` : ""}
        ${client.status === "lead" ? `<button type="button" class="btn btn--primary btn--sm" data-act="promote">${icon("check", 16)}Zostaje klientem</button>` : ""}
      </div>
      <div class="field-row">
        ${field("name", "Nazwa", client.name)}
        <label class="field"><span>Status</span><span class="select"><select name="status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}"${client.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>${icon("chevronDown", 16)}</span></label>
      </div>
      <div class="field-row">${field("company", "Firma", client.company)}${field("email", "E-mail", client.email, "email")}</div>
      <div class="field-row">${field("phone", "Telefon", client.phone, "tel")}${field("website", "Strona", client.website, "url")}</div>
      <label class="field"><span>Notatki</span><textarea class="textarea" name="notes" rows="3" maxlength="8000">${escapeHtml(client.notes)}</textarea></label>
      <section class="client-section"><h3>${icon("calendar", 18)}Spotkania</h3>
        ${upcoming.map(e => meetingRow(e, false)).join("") || '<p class="muted">Brak zaplanowanych spotkań.</p>'}
        ${recent.map(e => meetingRow(e, true)).join("")}
      </section>
      <section class="client-section"><h3>${icon("folder", 18)}Projekty</h3>
        ${projects.length ? projects.map(p => `<span class="chip chip--project" data-c="${escapeHtml(p.color)}">${icon("folder", 14)}${escapeHtml(p.name)}</span>`).join(" ") : '<p class="muted">Brak projektów. Przypisz projekt do klienta w „Porządek → Projekty”.</p>'}
      </section>
      <section class="client-section"><h3>${icon("checkSquare", 18)}Otwarte zadania</h3>
        ${tasks.length ? tasks.slice(0, 8).map(t => `<button type="button" class="client-row" data-task="${t.id}"><span>${escapeHtml(t.title)}</span><small class="muted">${STATUS_LABELS[t.status]}${t.dueDate ? ` · ${dueLabel(t.dueDate)}` : ""}</small></button>`).join("") : '<p class="muted">Brak otwartych zadań.</p>'}
      </section>
      <p class="field-error" data-error hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-act="delete">${icon("trash", 18)}Usuń</button>
        <button type="button" class="btn btn--ghost" data-close>Zamknij</button>
        <button type="submit" class="btn btn--primary">Zapisz</button>
      </div>
    </form>`);
  const form = element.querySelector("form");
  const fail = message => { const box = form.querySelector("[data-error]"); box.textContent = message; box.hidden = false; };
  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    const task = event.target.closest("[data-task]");
    if (task) { element.close(); return openDrawer(Number(task.dataset.task)); }
    const meeting = event.target.closest("[data-meeting]");
    if (meeting) { element.close(); return openMeeting(meetings.find(e => e.id === Number(meeting.dataset.meeting))); }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "tasks") { element.close(); return setFilter({ clientId: id, spaceId: null, projectId: null }); }
    if (act === "task") { element.close(); return openNewTask({ clientId: id }); }
    if (act === "meeting") { element.close(); return openMeeting(null, { clientId: id, attendees: client.email ? [client.email] : [], title: `Spotkanie: ${client.name}` }); }
    try {
      if (act === "promote") {
        await api.update("clients", id, { status: "client" });
        toast(`${client.name} jest teraz klientem.`);
      }
      if (act === "delete") {
        if (!(await confirmDialog(`Usunąć „${client.name}”? Zadania, projekty i spotkania zostaną, bez klienta.`, "Usuń"))) return;
        await api.remove("clients", id);
        if (store.filters.clientId === id) setFilter({ clientId: null });
      }
      element.close();
      await reload({ quiet: true });
    } catch (error) { fail(error.message || "Nie udało się."); }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = { name: form.name.value.trim(), status: form.status.value, company: form.company.value, email: form.email.value.trim() || null,
      phone: form.phone.value, website: form.website.value, notes: form.notes.value };
    try {
      await api.update("clients", id, body);
      element.close();
      toast("Zapisano.");
      await reload({ quiet: true });
    } catch (error) { fail(error.message || "Nie udało się zapisać."); }
  });
}
