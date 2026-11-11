// Task details: a side panel that edits the task in place (each field saves on change), with subtasks, notes,
// the timer and the change history.
import { api } from "../api/client.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/core.js";
import { icon } from "../../vendor/mytko-kit/js/icons.js";
import { formatClock, formatDuration, PRIORITY_LABELS, STATUS_LABELS, titleError, trackedNow, yearsAhead } from "./logic.js";
import { isMember, lookup, paint, reload, runTask, store, workflowReady } from "./app.js";
import { moveTask, timerData, workflowLabel } from "./board.js";
import { confirmDialog } from "./dialogs.js";
import { toast } from "../../vendor/mytko-kit/js/ui.js";
import { LOCALE } from "../i18n.js";

const FIELD_NAMES = {
  created: "Utworzono", title: "Tytuł", description: "Opis", status: "Status", priority: "Priorytet", date: "Data",
  due_date: "Termin", category_id: "Etykieta główna", labels: "Etykiety", space_id: "Przestrzeń", project_id: "Projekt",
  assignee_id: "Wykonawca", client_id: "Klient", archived_at: "Archiwum"
};

let panel = null;
let current = null; // { id, notes, subtasks, history, trigger }

function when(value) {
  return new Date(value).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function historyValue(field, value) {
  if (value === null || value === "") return "—";
  if (field === "status") return STATUS_LABELS[value] || value;
  if (field === "space_id") return lookup.space(Number(value))?.name || `#${value}`;
  if (field === "project_id") return lookup.project(Number(value))?.name || `#${value}`;
  if (field === "assignee_id") return lookup.assignee(Number(value))?.name || `#${value}`;
  if (field === "client_id") return lookup.client(Number(value))?.name || `#${value}`;
  if (field === "category_id") return lookup.label(Number(value))?.name || `#${value}`;
  if (field === "labels") return value.split(",").map(id => lookup.label(Number(id))?.name || `#${id}`).join(", ");
  if (field === "archived_at") return "zarchiwizowano";
  return value;
}

function options(list, selected, empty) {
  return `${empty ? `<option value="">${empty}</option>` : ""}${list.map(item =>
    `<option value="${item.id}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`;
}

function bodyHtml(task) {
  const { notes = [], subtasks = [], history = [] } = current;
  const privateSpace = lookup.privateSpace();
  const spaceId = task.spaceId ?? privateSpace?.id;
  const projects = store.projects.filter(p => !p.archivedAt && p.spaceId === spaceId);
  const tracked = trackedNow(task, store.fetchedAt);
  const timerButton = task.status === "done" || task.status === "needs_review" ? ""
    : task.timerStartedAt
      ? `<button type="button" class="btn btn--ghost" data-d="timer-stop">${icon("pauseCircle", 18)}Zatrzymaj</button>`
      : `<button type="button" class="btn btn--ghost" data-d="timer-start">${icon("playCircle", 18)}${tracked ? "Wznów" : "Start"}</button>`;
  return `
    <header class="drawer__head">
      <label class="select select--status status--${task.status}"><span class="visually-hidden">Status</span>
        <select data-field="status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}"${task.status === k ? " selected" : ""}>${v}</option>`).join("")}</select>${icon("chevronDown", 16)}</label>
      <span class="drawer__spacer"></span>
      <button type="button" class="icon-btn" data-d="delete" aria-label="Usuń zadanie" title="Usuń zadanie">${icon("trash")}</button>
      <button type="button" class="icon-btn" data-d="close" aria-label="Zamknij szczegóły">${icon("x")}</button>
    </header>
    <div class="drawer__scroll">
      <label class="visually-hidden" for="drawer-title">Tytuł</label>
      <div class="title-wrap" data-value="${escapeHtml(task.title)}"><textarea id="drawer-title" class="drawer__title" data-field="title" rows="1" maxlength="255">${escapeHtml(task.title)}</textarea></div>
      <p class="field-error" data-error="title" hidden></p>
      <dl class="props">
        <dt>${icon(task.status === "planned" ? "target" : "calendar", 18)}${task.status === "planned" ? "Cel" : "Termin"}</dt>
        <dd><input type="date" data-field="dueDate" value="${task.dueDate || ""}" aria-label="${task.status === "planned" ? "Cel" : "Termin"}">
          ${task.status === "planned" ? `<span class="horizon">${[[1, "za rok"], [2, "za 2 lata"], [5, "za 5 lat"]].map(([years, label]) => `<button type="button" class="chip chip--toggle-btn" data-d="horizon" data-years="${years}">${label}</button>`).join("")}</span>` : ""}</dd>
        <dt>${icon("layers", 18)}Przestrzeń</dt>
        <dd><label class="select select--sm"><select data-field="spaceId" aria-label="Przestrzeń">${options(store.spaces, spaceId)}</select>${icon("chevronDown", 16)}</label></dd>
        <dt>${icon("folder", 18)}Projekt</dt>
        <dd><label class="select select--sm"><select data-field="projectId" aria-label="Projekt">${options(projects, task.projectId, "Bez projektu")}</select>${icon("chevronDown", 16)}</label></dd>
        ${isMember() ? "" : `<dt>${icon("users", 18)}Klient</dt>
        <dd><label class="select select--sm"><select data-field="clientId" aria-label="Klient">${options(store.clients.filter(c => c.status !== "archived" || c.id === task.clientId), task.clientId, lookup.clientOf(task) && !task.clientId ? `Z projektu: ${escapeHtml(lookup.client(lookup.clientOf(task))?.name || "")}` : "Bez klienta")}</select>${icon("chevronDown", 16)}</label></dd>`}
        ${isMember() ? "" : workflowRowHtml(task)}
        ${task.mailId && !isMember() ? `<dt>${icon("mail", 18)}E-mail</dt><dd><a class="btn btn--ghost btn--sm" href="#mail-${task.mailId}">Otwórz wiadomość</a></dd>` : ""}
        <dt>${icon("user", 18)}Wykonawca</dt>
        <dd><label class="select select--sm"><select data-field="assigneeId" aria-label="Wykonawca">${options(store.assignees, task.assigneeId, "Bez wykonawcy")}</select>${icon("chevronDown", 16)}</label></dd>
        <dt>${icon("flag", 18)}Priorytet</dt>
        <dd><label class="select select--sm"><select data-field="priority" aria-label="Priorytet">${Object.entries(PRIORITY_LABELS).map(([k, v]) => `<option value="${k}"${task.priority === k ? " selected" : ""}>${v}</option>`).join("")}</select>${icon("chevronDown", 16)}</label></dd>
        <dt>${icon("clock", 18)}Czas pracy</dt>
        <dd class="props__timer">${task.timerStartedAt ? `<span class="is-running" ${timerData(task)}>${formatClock(tracked)}</span>` : `<span>${formatDuration(tracked)}</span>`}${timerButton}</dd>
      </dl>
      <fieldset class="label-picker"><legend>${icon("tag", 18)}Etykiety</legend>
        ${store.labels.length ? store.labels.map(label => `<label class="chip chip--label chip--toggle" data-c="${escapeHtml(label.color)}">
          <input type="checkbox" data-label="${label.id}"${(task.labelIds || []).includes(label.id) ? " checked" : ""}><i class="dot"></i>${escapeHtml(label.name)}</label>`).join("")
          : '<span class="muted">Brak etykiet. Dodaj je w menu „Etykiety”.</span>'}
      </fieldset>
      <section class="block"><h3>Opis</h3>
        <textarea class="textarea" data-field="description" rows="4" maxlength="5000" placeholder="Co trzeba zrobić, linki, kontekst…">${escapeHtml(task.description)}</textarea>
      </section>
      <section class="block"><h3>${icon("subtasks", 18)}Podzadania <span class="count">${subtasks.filter(s => s.done).length}/${subtasks.length}</span></h3>
        <ul class="subtasks">${subtasks.map(s => `<li data-sub="${s.id}"><label><input type="checkbox" data-d="sub-toggle"${s.done ? " checked" : ""}><span>${escapeHtml(s.title)}</span></label>
          <button type="button" class="icon-btn icon-btn--sm" data-d="sub-delete" aria-label="Usuń podzadanie ${escapeHtml(s.title)}">${icon("x", 16)}</button></li>`).join("")}</ul>
        <form class="inline-add" data-form="subtask"><input name="title" maxlength="200" placeholder="Dodaj podzadanie…" aria-label="Nowe podzadanie" required><button type="submit" class="icon-btn icon-btn--box" aria-label="Dodaj podzadanie">${icon("plus")}</button></form>
      </section>
      <section class="block"><h3>${icon("note", 18)}Notatki <span class="count">${notes.length}</span></h3>
        <form class="note-add" data-form="note"><textarea class="textarea" name="body" rows="2" maxlength="5000" placeholder="Nowa notatka…" aria-label="Nowa notatka" required></textarea><button type="submit" class="btn btn--primary btn--sm">Dodaj notatkę</button></form>
        <ol class="notes">${notes.map(n => `<li data-note="${n.id}"><p>${escapeHtml(n.body)}</p><footer><time>${when(n.createdAt)}</time>
          <button type="button" class="icon-btn icon-btn--sm" data-d="note-delete" aria-label="Usuń notatkę">${icon("trash", 16)}</button></footer></li>`).join("")}</ol>
      </section>
      <details class="block history"><summary>${icon("history", 18)}Historia zmian <span class="count">${history.length}</span></summary>
        <ol>${history.map(h => `<li><time>${when(h.changedAt)}</time><span><strong>${FIELD_NAMES[h.field] || h.field}</strong>${h.field === "created" ? "" : `: ${escapeHtml(historyValue(h.field, h.oldValue))} → ${escapeHtml(historyValue(h.field, h.newValue))}`}</span></li>`).join("")}</ol>
      </details>
      <p class="drawer__foot muted">Utworzone ${when(task.createdAt)} · zmienione ${when(task.updatedAt)}</p>
    </div>`;
}

// Text the user has typed but not saved: drafts of new notes/subtasks always, and the field in focus.
function drafts() {
  const kept = new Map();
  for (const field of panel.querySelectorAll("[data-form] [name]")) if (field.value) kept.set(`[data-form="${field.closest("[data-form]").dataset.form}"] [name="${field.name}"]`, field.value);
  const focused = document.activeElement;
  if (focused && panel.contains(focused) && focused.dataset.field && focused.matches("textarea, input:not([type=checkbox])")) {
    kept.set(`[data-field="${focused.dataset.field}"]`, focused.value);
  }
  return kept;
}

// A selector that finds the same control again after the panel is rebuilt.
function focusKey(element) {
  if (element.dataset.field) return `[data-field="${element.dataset.field}"]`;
  if (element.dataset.label) return `[data-label="${element.dataset.label}"]`;
  const form = element.closest("[data-form]");
  if (form && element.name) return `[data-form="${form.dataset.form}"] [name="${element.name}"]`;
  const item = element.closest("[data-sub], [data-note]");
  if (item && element.dataset.d) return `[data-${item.dataset.sub ? "sub" : "note"}="${item.dataset.sub || item.dataset.note}"] [data-d="${element.dataset.d}"]`;
  return element.dataset.d ? `[data-d="${element.dataset.d}"]` : null;
}

function draw() {
  const task = current && lookup.task(current.id);
  if (!panel || !task) return;
  const focused = document.activeElement;
  const keep = focused && panel.contains(focused) ? focusKey(focused) : null;
  const selection = keep && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const typed = drafts();
  const scroll = panel.querySelector(".drawer__scroll")?.scrollTop || 0;
  panel.querySelector(".drawer__panel").innerHTML = bodyHtml(task);
  for (const [selector, value] of typed) { const field = panel.querySelector(selector); if (field) field.value = value; }
  paint(panel);
  panel.querySelector(".drawer__scroll").scrollTop = scroll;
  if (keep) {
    const field = panel.querySelector(keep);
    field?.focus();
    if (field && selection) try { field.setSelectionRange(...selection); } catch { /* not a text field */ }
  }
}

async function loadDetails() {
  const id = current.id;
  try {
    const [notes, subtasks, history] = await Promise.all([api.notes(id), api.subtasks(id), api.history(id)]);
    if (current?.id !== id) return;
    Object.assign(current, { notes, subtasks, history });
    draw();
  } catch { /* the panel still works with the task itself */ }
}

// Mytko Workflow ToDo: send / withdraw, and where it stands there. Only spaces visible to agents can send.
function workflowRowHtml(task) {
  const space = lookup.space(task.spaceId);
  const label = workflowLabel(task);
  const requested = Boolean(task.workflowRequestedAt);
  const action = requested
    ? `<button type="button" class="btn btn--ghost btn--sm" data-d="workflow-off">Wycofaj</button>`
    : !space?.agentVisible ? `<small class="muted">Ta przestrzeń nie jest widoczna dla agentów</small>`
      : !workflowReady() ? `<small class="muted">Połączenie z Mytko Workflow jest wyłączone (Porządek → AI i Workflow)</small>`
        : `<button type="button" class="btn btn--ghost btn--sm" data-d="workflow-on">${icon("layers", 15)}Wyślij do Workflow</button>`;
  // why the AI routing thinks so (sent by AI, or only marked)
  const ai = task.aiReason && (task.aiCoding || task.workflowRequestedBy === "ai")
    ? `<small class="workflow-ai">${icon("sparkles", 14)}${task.workflowRequestedBy === "ai" && requested ? "Wysłane przez AI" : "AI: praca dla Workflow"} · ${escapeHtml(task.aiReason)}</small>` : "";
  const link = task.workflowUrl && requested ? `<a class="btn btn--ghost btn--sm" href="${escapeHtml(task.workflowUrl)}" target="_blank" rel="noopener noreferrer">Otwórz w Workflow</a>` : "";
  const hint = requested && !task.workflowRef ? '<small class="muted">Workflow pobierze je, gdy Fujitsu będzie włączone.</small>' : "";
  return `<dt>${icon("layers", 18)}Workflow</dt><dd class="workflow-cell">${label ? `<span class="chip chip--workflow">${escapeHtml(label)}</span>` : ""}${action}${link}${hint}${ai}</dd>`;
}

async function save(body, failure) {
  const id = current.id;
  const task = await runTask(() => api.updateTask(id, body), failure);
  if (task) loadDetails();
}

async function onChange(event) {
  const field = event.target.dataset.field;
  const id = current.id;
  const task = lookup.task(id);
  if (event.target.dataset.label) {
    const labelIds = [...panel.querySelectorAll("[data-label]:checked")].map(input => Number(input.dataset.label));
    return save({ labelIds }, "Nie udało się zmienić etykiet.");
  }
  if (event.target.dataset.d === "sub-toggle") {
    const subId = Number(event.target.closest("[data-sub]").dataset.sub);
    await api.updateSubtask(id, subId, { done: event.target.checked }).catch(() => toast("Nie udało się zapisać podzadania.", { tone: "error" }));
    await loadDetails();
    return reload({ quiet: true });
  }
  if (!field) return;
  const value = event.target.value;
  if (field === "status") return moveTask(id, value, null);
  if (field === "title") {
    const error = titleError(value, task.title);
    const box = panel.querySelector('[data-error="title"]');
    box.textContent = error;
    box.hidden = !error;
    if (error || value.trim() === task.title) return;
    return save({ title: value.trim() }, "Nie udało się zmienić tytułu.");
  }
  if (field === "description") return value === task.description ? null : save({ description: value }, "Nie udało się zapisać opisu.");
  if (field === "dueDate") return save({ dueDate: value || null }, "Nie udało się zmienić terminu.");
  if (field === "priority") return save({ priority: value }, "Nie udało się zmienić priorytetu.");
  if (field === "spaceId") return save({ spaceId: Number(value) }, "Nie udało się zmienić przestrzeni.");
  if (field === "projectId") return save({ projectId: Number(value) || null }, "Nie udało się zmienić projektu.");
  if (field === "clientId") return save({ clientId: Number(value) || null }, "Nie udało się zmienić klienta.");
  if (field === "assigneeId") return save({ assigneeId: Number(value) || null }, "Nie udało się zmienić wykonawcy.");
}

async function onClick(event) {
  if (event.target === panel) return closeDrawer();
  const button = event.target.closest("[data-d]");
  if (!button || button.dataset.d === "sub-toggle") return;
  const id = current.id;
  const kind = button.dataset.d;
  if (kind === "close") return closeDrawer();
  if (kind === "workflow-on" || kind === "workflow-off") return save({ workflow: kind === "workflow-on" }, "Nie udało się zmienić Workflow.");
  if (kind === "horizon") return save({ dueDate: yearsAhead(Number(button.dataset.years)) }, "Nie udało się ustawić celu.");
  if (kind === "timer-start" || kind === "timer-stop") {
    await runTask(() => api.timer(id, kind === "timer-start" ? "start" : "stop"));
    return kind === "timer-start" ? reload({ quiet: true }) : null; // the server stopped any other timer
  }
  if (kind === "delete") {
    const task = lookup.task(id);
    if (!(await confirmDialog(`Usunąć zadanie „${task.title}” razem z notatkami i podzadaniami? Tego nie da się cofnąć.`, "Usuń"))) return;
    try {
      await api.deleteTask(id);
      closeDrawer();
      toast("Zadanie usunięte.");
      return reload({ quiet: true });
    } catch (error) {
      return toast(error.message || "Nie udało się usunąć zadania.", { tone: "error" });
    }
  }
  if (kind === "sub-delete") {
    await api.deleteSubtask(id, Number(button.closest("[data-sub]").dataset.sub)).catch(() => {});
    await loadDetails();
    return reload({ quiet: true });
  }
  if (kind === "note-delete") {
    if (!(await confirmDialog("Usunąć tę notatkę?", "Usuń"))) return;
    await api.deleteNote(id, Number(button.closest("[data-note]").dataset.note)).catch(() => {});
    await loadDetails();
    return reload({ quiet: true });
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const id = current.id;
  const value = (form.title || form.body).value.trim();
  if (!value) return;
  try {
    if (form.dataset.form === "subtask") await api.addSubtask(id, value);
    else await api.addNote(id, value);
    form.reset();
    await loadDetails();
    await reload({ quiet: true });
    panel.querySelector(`[data-form="${form.dataset.form}"] [name]`)?.focus();
  } catch (error) {
    toast(error.message || "Nie udało się zapisać.", { tone: "error" });
  }
}

export function openDrawer(id) {
  if (!lookup.task(id)) return;
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "drawer";
    panel.innerHTML = '<aside class="drawer__panel" role="dialog" aria-modal="true" aria-label="Szczegóły zadania"></aside>';
    document.body.append(panel);
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    panel.addEventListener("submit", onSubmit);
    panel.addEventListener("input", event => {
      // the hidden copy behind the title gives it its height (see .title-wrap)
      if (event.target.classList.contains("drawer__title")) event.target.parentElement.dataset.value = event.target.value;
    });
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.stopPropagation(); closeDrawer(); }
      if (event.key === "Enter" && event.target.classList.contains("drawer__title")) { event.preventDefault(); event.target.blur(); }
    });
  }
  current = { id, notes: [], subtasks: [], history: [], trigger: document.activeElement };
  panel.hidden = false;
  document.body.classList.add("drawer-open");
  draw();
  panel.querySelector('[data-d="close"]').focus();
  loadDetails();
}

export function closeDrawer() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove("drawer-open");
  const trigger = current?.trigger;
  current = null;
  if (trigger?.isConnected) trigger.focus();
}

export function refreshDrawer() {
  if (!current) return;
  if (!lookup.task(current.id)) return closeDrawer();
  draw();
}
