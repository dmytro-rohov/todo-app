// Mytko Tasks app shell: state, sidebar, header with counters, view tabs, filters, and the active view.
import { api } from "../api/client.js";
import { logout, markLoggedOut } from "../auth/login.js";
import { escapeHtml, safeColor } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { counters, filterTasks, initials, isOpen, isoDay, STATUS_LABELS, formatClock, trackedNow } from "./logic.js";
import { renderBoard, bindBoard, tickTimers, timerData, updatePeek } from "./board.js";
import { renderList, bindList } from "./list.js";
import { renderCalendar, bindCalendar, afterCalendarRender } from "./calendar.js";
import { calendarState, eventTime, loadCalendarAccounts, loadToday, openMeeting } from "./meetings.js";
import { openClient } from "./clients.js";
import { openAccounts, openPassword } from "./accounts.js";
import { bindMail, loadMail, mailAddress, mailBadge, renderMail, showMail } from "./mail.js";
import { renderArchive, bindArchive, loadArchive } from "./archive.js";
import { afterGoalsRender, bindGoals, renderGoals } from "./goals.js";
import { openAiSettings } from "./ai-settings.js";
import { openDrawer, closeDrawer, refreshDrawer } from "./drawer.js";
import { openNewTask, openManage, confirmDialog, openLanguageDialog, openScaleDialog } from "./dialogs.js";
import { toast } from "./toast.js";
import { LANG } from "../i18n.js";

const PREFS = "mytko-tasks-prefs";
const VIEWS = { board: ["board", "Tablica"], list: ["list", "Lista"], calendar: ["calendar", "Kalendarz"], goals: ["goals", "Cele / Marzenia"], archive: ["archive", "Archiwum"], mail: ["mail", "Poczta"] };

export const store = {
  session: null,
  tasks: [],
  fetchedAt: Date.now(),
  spaces: [], projects: [], labels: [], assignees: [],
  filters: { spaceId: null, projectId: null, clientId: null, labelId: null, assigneeId: null, status: "", search: "", showDone: true, quick: null },
  clients: [],
  view: "board",
  listSort: "position",
  // board columns shown by priority (P0 first) instead of the manual order, per status; kept on this device
  columnSort: {},
  month: isoDay(),
  calendarDay: isoDay(),
  calendarMode: "month",
  sidebarCollapsed: false,
  filtersOpen: false,
  archive: null,
  sidebarOpen: false
};

let root;
let pendingLink = null;

// Links: #board, #list, #calendar, #mail choose the view; #task-<id>, #mail-<id>, #new and #manage-<kind> open after loading.
function readLink() {
  const hash = window.location.hash.slice(1);
  if (VIEWS[hash]) store.view = hash;
  else if (/^task-\d+$|^mail-\d+$|^new$|^manage-(spaces|projects|categories|assignees)$/.test(hash)) pendingLink = hash;
}

function writeLink() {
  const hash = `#${store.view}`;
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
}

function openLink() {
  if (!pendingLink) return;
  const link = pendingLink;
  pendingLink = null;
  if (link === "new") openNewTask();
  else if (link.startsWith("task-")) openDrawer(Number(link.slice(5)));
  else if (link.startsWith("mail-")) { if (!isMember()) showMail(Number(link.slice(5))); }
  else openManage(link.slice(7));
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) || "{}");
    if (VIEWS[saved.view]) store.view = saved.view;
    if (typeof saved.showDone === "boolean") store.filters.showDone = saved.showDone;
    if (Number.isInteger(saved.spaceId)) store.filters.spaceId = saved.spaceId;
    if (Number.isInteger(saved.projectId)) store.filters.projectId = saved.projectId;
    if (saved.listSort) store.listSort = saved.listSort;
    if (saved.columnSort && typeof saved.columnSort === "object") {
      store.columnSort = Object.fromEntries(Object.entries(saved.columnSort).filter(([, v]) => v === "priority"));
    }
    if (typeof saved.sidebarCollapsed === "boolean") store.sidebarCollapsed = saved.sidebarCollapsed;
    if (saved.calendarMode === "week") store.calendarMode = "week";
  } catch { /* preferences are a convenience only */ }
}

export function savePrefs() {
  try {
    const { spaceId, projectId, showDone } = store.filters;
    localStorage.setItem(PREFS, JSON.stringify({ view: store.view, showDone, spaceId, projectId, listSort: store.listSort,
      sidebarCollapsed: store.sidebarCollapsed, calendarMode: store.calendarMode, columnSort: store.columnSort }));
  } catch { /* ignore */ }
}

export const lookup = {
  space: id => store.spaces.find(s => s.id === id),
  project: id => store.projects.find(p => p.id === id),
  label: id => store.labels.find(l => l.id === id),
  assignee: id => store.assignees.find(a => a.id === id),
  client: id => store.clients.find(c => c.id === id),
  // a task's client: its own, else its project's
  clientOf: task => task.clientId ?? store.projects.find(p => p.id === task.projectId)?.clientId ?? null,
  task: id => store.tasks.find(t => t.id === id),
  privateSpace: () => store.spaces.find(s => s.key === "private")
};

export function context() {
  return {
    privateSpaceId: lookup.privateSpace()?.id ?? null,
    clientOf: lookup.clientOf,
    names: {
      client: task => lookup.client(lookup.clientOf(task))?.name || "",
      project: id => lookup.project(id)?.name || "",
      assignee: id => lookup.assignee(id)?.name || "",
      label: id => lookup.label(id)?.name || ""
    }
  };
}

export function visibleTasks() {
  return filterTasks(store.tasks, store.filters, context());
}

// Colours never go into style attributes (CSP style-src 'self'): elements carry data-c and get a CSS variable.
export function paint(element) {
  for (const node of element.querySelectorAll("[data-c]")) node.style.setProperty("--c", safeColor(node.dataset.c, "#7d8a80"));
  for (const node of element.querySelectorAll("[data-pc]")) node.style.setProperty("--pc", safeColor(node.dataset.pc, "#7d8a80"));
}

// A member account (not the owner, the only administrator): the task app without clients, meetings and accounts.
export const isMember = () => store.session?.user?.role === "member";

// Tasks can go to the Mytko Workflow ToDo: the owner, with the connection set up on the server and not turned off in
// Porządek → AI i Workflow (store.settings, GET /api/settings).
export const workflowReady = () => !isMember() && Boolean(store.settings?.workflow.configured && store.settings.workflow.enabled);

// green: Workflow asked recently; grey: no contact or turned off
function settingsDot() {
  const w = store.settings?.workflow;
  if (!w?.configured) return "";
  return `<i class="nav-dot nav-dot--${w.enabled && w.active ? "ok" : "off"}" title="${w.enabled && w.active ? "Mytko Workflow: aktywne" : "Mytko Workflow: brak kontaktu"}"></i>`;
}

export async function loadSettings() {
  if (isMember()) return;
  try { store.settings = await api.settings(); } catch { /* the board works without it */ }
}

export async function reload({ quiet = false } = {}) {
  try {
    const [tasks, spaces, projects, labels, assignees, clients] = await Promise.all([
      api.tasks(), api.list("spaces"), api.list("projects?archived=true"), api.list("categories"), api.list("assignees"),
      isMember() ? [] : api.list("clients?archived=true")
    ]);
    await loadSettings();
    const now = Date.now();
    Object.assign(store, { tasks: tasks.map(t => ({ ...t, fetchedAt: now })), spaces, projects, labels, assignees, clients, fetchedAt: now });
    if (store.filters.clientId && !lookup.client(store.filters.clientId)) store.filters.clientId = null;
    if (store.filters.spaceId && !lookup.space(store.filters.spaceId)) store.filters.spaceId = null;
    if (store.filters.projectId && !lookup.project(store.filters.projectId)) store.filters.projectId = null;
    calendarState.rangeKey = ""; // meetings are re-read with the tasks
    render();
    refreshDrawer();
    openLink();
  } catch (error) {
    if (!quiet) toast(error.message || "Nie udało się wczytać zadań.", { tone: "error" });
  }
}

// Replaces one task in place after a write (the API returns the full task).
export function upsertTask(written) {
  const task = { ...written, fetchedAt: Date.now() };
  const index = store.tasks.findIndex(t => t.id === task.id);
  if (index === -1) store.tasks.push(task); else store.tasks[index] = task;
  render();
  refreshDrawer();
}

export async function runTask(action, failure = "Nie udało się zapisać zmian.") {
  try {
    const result = await action();
    if (result && result.id) upsertTask(result);
    return result;
  } catch (error) {
    toast(error.status === 0 ? error.message : `${failure} ${error.status >= 500 ? "" : error.message || ""}`.trim(), { tone: "error" });
    await reload({ quiet: true });
    return null;
  }
}

export function setFilter(changes) {
  Object.assign(store.filters, changes);
  if ("spaceId" in changes && !("projectId" in changes)) {
    const project = lookup.project(store.filters.projectId);
    if (project && changes.spaceId && project.spaceId !== changes.spaceId) store.filters.projectId = null;
  }
  savePrefs();
  render();
}

function scopeTitle() {
  const project = lookup.project(store.filters.projectId);
  const space = lookup.space(store.filters.spaceId) || (project && lookup.space(project.spaceId));
  return { project, space };
}

function sidebarHtml() {
  const { filters } = store;
  const openCount = id => store.tasks.filter(t => isOpen(t) && (t.spaceId ?? lookup.privateSpace()?.id) === id).length;
  const projectCount = id => store.tasks.filter(t => isOpen(t) && t.projectId === id).length;
  const activeProjects = store.projects.filter(p => !p.archivedAt && (!filters.spaceId || p.spaceId === filters.spaceId));
  const user = store.session?.user?.name || store.session?.login || "";
  return `
    <div class="sidebar__brand">
      <img src="./icons/icon-192.png" alt="" width="44" height="44">
      <span><strong>Mytko</strong><small>Tasks</small></span>
      <button type="button" class="icon-btn sidebar__close" data-action="sidebar-close" aria-label="Zamknij menu">${icon("x")}</button>
      <button type="button" class="icon-btn sidebar__collapse" data-action="sidebar-collapse" aria-pressed="${store.sidebarCollapsed}"
        aria-label="${store.sidebarCollapsed ? "Rozwiń panel boczny" : "Zwiń panel boczny"}" title="${store.sidebarCollapsed ? "Rozwiń panel" : "Zwiń panel"}">${icon(store.sidebarCollapsed ? "chevronRight" : "chevronLeft")}</button>
    </div>
    <nav class="sidebar__nav" aria-label="Przestrzenie i projekty">
      <button type="button" class="nav-item${!filters.spaceId && !filters.projectId ? " is-active" : ""}" data-action="scope" data-space="" data-project="" title="Wszystkie zadania">
        ${icon("checkSquare")}<span>Wszystkie zadania</span><em>${store.tasks.filter(isOpen).length}</em>
      </button>
      <p class="nav-heading"><span>Przestrzenie</span><button type="button" class="icon-btn icon-btn--sm" data-action="manage" data-tab="spaces" aria-label="Zarządzaj przestrzeniami">${icon("plus", 16)}</button></p>
      ${store.spaces.map(space => `
        <button type="button" class="nav-item nav-item--space${filters.spaceId === space.id && !filters.projectId ? " is-active" : ""}" data-action="scope" data-space="${space.id}" data-project="" title="${escapeHtml(space.name)}">
          <i class="dot" data-c="${escapeHtml(space.color)}"></i><span${space.key === "work" || String(space.key).startsWith("private") ? "" : ' translate="no"'}>${escapeHtml(space.name)}</span>${space.shared ? `<i class="shared-mark" title="Wspólna przestrzeń">${icon("users", 14)}</i>` : ""}<em>${openCount(space.id)}</em>
        </button>`).join("")}
      <p class="nav-heading"><span>Projekty</span><button type="button" class="icon-btn icon-btn--sm" data-action="manage" data-tab="projects" aria-label="Zarządzaj projektami">${icon("plus", 16)}</button></p>
      ${activeProjects.length ? activeProjects.map(project => `
        <button type="button" class="nav-item nav-item--sub${filters.projectId === project.id ? " is-active" : ""}" data-action="scope" data-space="${project.spaceId}" data-project="${project.id}" title="${escapeHtml(project.name)}">
          <span class="folder" data-c="${escapeHtml(project.color)}">${icon("folder", 16)}</span><span>${escapeHtml(project.name)}</span><em>${projectCount(project.id)}</em>
        </button>`).join("") : '<p class="nav-empty">Brak projektów w tej przestrzeni.</p>'}
      ${isMember() ? "" : `<p class="nav-heading"><span>Klienci</span><button type="button" class="icon-btn icon-btn--sm" data-action="manage" data-tab="clients" aria-label="Zarządzaj klientami">${icon("plus", 16)}</button></p>
      ${store.clients.filter(c => c.status !== "archived").map(client => `
        <button type="button" class="nav-item nav-item--sub${filters.clientId === client.id ? " is-active" : ""}" data-action="client-scope" data-client="${client.id}" title="${escapeHtml(client.name)}">
          <span class="folder" data-c="${escapeHtml(client.color)}">${icon("user", 16)}</span><span>${escapeHtml(client.name)}</span>${client.status === "lead" ? '<i class="lead-badge">lead</i>' : `<em>${client.openTasks}</em>`}
        </button>`).join("") || '<p class="nav-empty">Brak klientów.</p>'}`}
      <p class="nav-heading"><span>Porządek</span></p>
      <button type="button" class="nav-item nav-item--sub" data-action="manage" data-tab="categories" title="Etykiety">${icon("tag", 18)}<span>Etykiety</span><em>${store.labels.length}</em></button>
      <button type="button" class="nav-item nav-item--sub" data-action="manage" data-tab="assignees" title="Wykonawcy">${icon("users", 18)}<span>Wykonawcy</span><em>${store.assignees.length}</em></button>
      ${isMember() ? "" : `<button type="button" class="nav-item nav-item--sub" data-action="accounts" title="Konta">${icon("lock", 18)}<span>Konta</span></button>
      <button type="button" class="nav-item nav-item--sub" data-action="ai-settings" title="AI i Workflow">${icon("sparkles", 18)}<span>AI i Workflow</span>${settingsDot()}</button>`}
      <button type="button" class="nav-item nav-item--sub" data-action="ui-scale" title="Rozmiar interfejsu">${icon("sliders", 18)}<span>Rozmiar interfejsu</span></button>
      <button type="button" class="nav-item nav-item--sub" data-action="language" title="Język">${icon("globe", 18)}<span>Język</span><em translate="no">${LANG === "uk" ? "УКР" : "PL"}</em></button>
    </nav>
    <div class="sidebar__foot">
      <div class="profile">
        <span class="avatar avatar--lime">${escapeHtml(initials(user))}</span>
        <span class="profile__text"><strong>${escapeHtml(user)}</strong><small>${isMember() ? escapeHtml(store.session.login) : store.session?.method === "mytko" ? "Administrator · konto Mytko" : "Administrator"}</small></span>
        ${isMember() ? `<button type="button" class="icon-btn" data-action="password" aria-label="Zmień hasło" title="Zmień hasło">${icon("lock")}</button>` : ""}
        <button type="button" class="icon-btn" data-action="logout" aria-label="Wyloguj" title="Wyloguj">${icon("logout")}</button>
      </div>
    </div>`;
}

function headHtml() {
  if (store.view === "goals") {
    return `<div class="page-head__title"><span class="page-head__icon">${icon("star", 30)}</span>
      <div><h1>Cele / Marzenia</h1><p>Na miesiąc albo na cały rok: co chcesz osiągnąć i o czym marzysz</p></div></div>`;
  }
  if (store.view === "mail") {
    return `<div class="page-head__title"><span class="page-head__icon">${icon("mail", 30)}</span>
      <div><h1>Poczta</h1><p>${escapeHtml(mailAddress() || "Skrzynka studia")} · wiadomości, zadania i leady z e-maili</p></div></div>`;
  }
  const { project, space } = scopeTitle();
  const client = lookup.client(store.filters.clientId);
  const count = counters(store.tasks, store.filters, context());
  const title = client ? client.name : project ? project.name : space ? space.name : "Tasks";
  const subtitle = client ? `${{ lead: "Lead", client: "Klient", archived: "Archiwum" }[client.status]}${client.company ? ` · ${client.company}` : ""}${client.email ? ` · ${client.email}` : ""}` : project ? `Zadania, prace i działania w projekcie ${project.name}`
    : space ? `Zadania w przestrzeni ${space.name}` : "Wszystkie zadania, prace i działania";
  const tile = (key, iconName, value, label, tone = "") => `
    <button type="button" class="tile${tone ? ` tile--${tone}` : ""}${store.filters.quick === key ? " is-active" : ""}" data-action="quick" data-quick="${key}" aria-pressed="${store.filters.quick === key}">
      <span class="tile__icon">${icon(iconName, 22)}</span><span><strong>${value}</strong><small>${label}</small></span>
    </button>`;
  return `
    <div class="page-head__title">
      <span class="page-head__icon">${icon("checkSquare", 30)}</span>
      <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
      ${client ? `<button type="button" class="btn btn--ghost btn--sm" data-action="client-card" data-client="${client.id}">${icon("user", 16)}Karta klienta</button>` : ""}
    </div>
    <div class="tiles" role="group" aria-label="Szybkie filtry terminów">
      ${tile("all", "calendar", count.all, "Otwarte")}
      ${tile("today", "sun", count.today, "Na dziś")}
      ${tile("overdue", "warning", count.overdue, "Po terminie", count.overdue ? "warn" : "")}
      ${tile("week", "calendarRange", count.week, "W ciągu 7 dni")}
    </div>`;
}

function crumbsHtml() {
  const { project, space } = scopeTitle();
  const parts = [space && `<button type="button" class="crumb" data-action="scope" data-space="${space.id}" data-project="" title="${escapeHtml(space.name)}">${escapeHtml(space.name)}</button>`,
    project && `<span class="crumb">${escapeHtml(project.name)}</span>`].filter(Boolean);
  return `<button type="button" class="crumb crumb--home" data-action="scope" data-space="" data-project="" aria-label="Wszystkie zadania">${icon("home", 18)}</button>
    ${parts.map(p => `<span class="crumb-sep">/</span>${p}`).join("")}<span class="crumb-sep">/</span><strong>Tasks</strong>`;
}

// Any filter narrowing the tasks (the space chosen in the sidebar and "Pokaż zakończone" are not filters here).
function filtered() {
  const f = store.filters;
  return Boolean(f.status || f.projectId || f.clientId || f.labelId || f.assigneeId || f.quick || f.search);
}

function filtersHtml() {
  const f = store.filters;
  const option = (value, label, selected) => `<option value="${value}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const projects = store.projects.filter(p => !p.archivedAt && (!f.spaceId || p.spaceId === f.spaceId));
  return `
    <label class="select"><span class="visually-hidden">Status</span><select data-filter="status">
      ${option("", "Wszystkie zadania", !f.status)}${Object.entries(STATUS_LABELS).map(([k, v]) => option(k, v, f.status === k)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    <label class="select"><span class="visually-hidden">Projekt</span><select data-filter="projectId">
      ${option("", "Wszystkie projekty", !f.projectId)}${projects.map(p => option(p.id, p.name, f.projectId === p.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    ${isMember() ? "" : `<label class="select"><span class="visually-hidden">Klient</span><select data-filter="clientId">
      ${option("", "Wszyscy klienci", !f.clientId)}${store.clients.filter(c => c.status !== "archived").map(c => option(c.id, c.name, f.clientId === c.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>`}
    <label class="select"><span class="visually-hidden">Etykieta</span><select data-filter="labelId">
      ${option("", "Wszystkie etykiety", !f.labelId)}${store.labels.map(l => option(l.id, l.name, f.labelId === l.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    <label class="select"><span class="visually-hidden">Wykonawca</span><select data-filter="assigneeId">
      ${option("", "Wszyscy wykonawcy", !f.assigneeId)}${option("none", "Bez wykonawcy", f.assigneeId === "none")}${store.assignees.map(a => option(a.id, a.name, f.assigneeId === a.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    <span class="filters__spacer"></span>
    <button type="button" class="btn btn--ghost btn--sm filters__clear" data-action="clear-filters"${filtered() ? "" : " hidden"}>${icon("x", 16)}Wyczyść filtry</button>
    <label class="switch"><input type="checkbox" data-filter="showDone"${f.showDone ? " checked" : ""}><span class="switch__track"></span><span>Pokaż zakończone</span></label>`;
}

function notificationsHtml() {
  const meetings = calendarState.today.length ? `<p class="popover__title">Spotkania dziś</p>${calendarState.today.map(e => `
    <button type="button" class="popover__item" data-action="open-meeting" data-id="${e.id}"><span class="is-meeting">${icon("users", 16)}</span>
      <span>${escapeHtml(eventTime(e))} · ${escapeHtml(e.title)}</span></button>`).join("")}` : "";
  const due = store.tasks.filter(t => isOpen(t) && t.dueDate && t.dueDate <= isoDay())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8);
  if (!due.length) return meetings || '<p class="popover__empty">Nic na dziś i nic po terminie.</p>';
  return `${meetings}<p class="popover__title">Na dziś i po terminie</p>${due.map(t => `
    <button type="button" class="popover__item" data-action="open-task" data-id="${t.id}">
      <span class="${t.dueDate < isoDay() ? "is-overdue" : "is-today"}">${t.dueDate < isoDay() ? icon("warning", 16) : icon("sun", 16)}</span>
      <span>${escapeHtml(t.title)}</span></button>`).join("")}`;
}

export function render() {
  if (!root) return;
  root.querySelector(".sidebar").innerHTML = sidebarHtml();
  root.querySelector(".crumbs").innerHTML = crumbsHtml();
  root.querySelector(".page-head").innerHTML = headHtml();
  root.classList.toggle("sidebar-collapsed", store.sidebarCollapsed);
  root.classList.toggle("filters-open", store.filtersOpen);
  root.classList.toggle("view-mail", store.view === "mail");
  root.classList.toggle("view-goals", store.view === "goals");
  const f = store.filters;
  const active = [f.status, f.projectId, f.clientId, f.labelId, f.assigneeId, f.quick, !f.showDone].filter(Boolean).length;
  const badge = root.querySelector(".filters-toggle .count");
  badge.hidden = !active;
  badge.textContent = String(active);
  root.querySelector(".filters-toggle").setAttribute("aria-expanded", String(store.filtersOpen));
  const filters = root.querySelector(".filters");
  if (!filters.contains(document.activeElement)) filters.innerHTML = filtersHtml();
  filters.querySelector('[data-action="clear-filters"]').hidden = !filtered();
  const hasDue = store.tasks.some(t => isOpen(t) && t.dueDate && t.dueDate <= isoDay());
  root.querySelector(".bell").classList.toggle("has-dot", hasDue || calendarState.today.length > 0);
  root.querySelector('.menu [data-action="new-meeting"]').hidden = !(calendarState.configured && calendarState.accounts.length);
  const mailTab = root.querySelector('[data-view="mail"]');
  mailTab.hidden = isMember();
  mailTab.querySelector(".count").hidden = !mailBadge();
  mailTab.querySelector(".count").textContent = String(mailBadge());
  if (store.view === "mail" && isMember()) store.view = "board";
  for (const tab of root.querySelectorAll("[data-view]")) {
    tab.classList.toggle("is-active", tab.dataset.view === store.view);
    tab.setAttribute("aria-selected", String(tab.dataset.view === store.view));
  }
  const view = root.querySelector(".view");
  // Re-rendering must not throw the reader back to the start of the board or the top of a long column.
  const keep = view.dataset.view === store.view ? {
    left: view.querySelector(".board")?.scrollLeft || 0,
    columns: Object.fromEntries([...view.querySelectorAll("[data-drop]")].map(zone => [zone.dataset.drop, zone.scrollTop]))
  } : null;
  view.dataset.view = store.view;
  view.innerHTML = store.view === "list" ? renderList() : store.view === "calendar" ? renderCalendar()
    : store.view === "archive" ? renderArchive() : store.view === "mail" ? renderMail() : store.view === "goals" ? renderGoals() : renderBoard();
  if (keep) {
    const board = view.querySelector(".board");
    if (board) board.scrollLeft = keep.left;
    for (const zone of view.querySelectorAll("[data-drop]")) zone.scrollTop = keep.columns[zone.dataset.drop] || 0;
  }
  updatePeek(view);
  renderTimerDock();
  if (store.view === "calendar") afterCalendarRender(view);
  if (store.view === "goals") afterGoalsRender(view);
  paint(root);
}

function shellHtml() {
  return `
  <aside class="sidebar" id="sidebar"></aside>
  <div class="sidebar-backdrop" data-action="sidebar-close"></div>
  <div class="main">
    <header class="topbar">
      <button type="button" class="icon-btn topbar__menu" data-action="sidebar-open" aria-label="Otwórz menu" aria-controls="sidebar">${icon("menu")}</button>
      <nav class="crumbs" aria-label="Okruszki"></nav>
      <button type="button" class="icon-btn icon-btn--box topbar__search" data-action="search-toggle" aria-label="Szukaj" aria-expanded="false">${icon("search")}</button>
      <label class="search">${icon("search", 20)}<span class="visually-hidden">Szukaj</span>
        <input type="search" id="search" placeholder="Szukaj zadań, osób lub etykiet…" autocomplete="off"><kbd>Ctrl K</kbd></label>
      <div class="bell-wrap">
        <button type="button" class="icon-btn icon-btn--box bell" data-action="bell" aria-label="Powiadomienia" aria-expanded="false">${icon("bell")}</button>
        <div class="popover" hidden></div>
      </div>
    </header>
    <section class="page-head"></section>
    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Widok zadań">
        <button type="button" role="tab" class="tab" data-view="board">${icon("board")}<span>Tablica</span></button>
        <button type="button" role="tab" class="tab" data-view="list">${icon("list")}<span>Lista</span></button>
        <button type="button" role="tab" class="tab" data-view="calendar">${icon("calendar")}<span>Kalendarz</span></button>
        <button type="button" role="tab" class="tab" data-view="goals">${icon("star")}<span>Cele<span class="tab__more"> / Marzenia</span></span></button>
        <button type="button" role="tab" class="tab" data-view="archive">${icon("archive")}<span>Archiwum</span></button>
        <button type="button" role="tab" class="tab" data-view="mail" hidden>${icon("mail")}<span>Poczta</span><em class="count" hidden></em></button>
      </div>
      <button type="button" class="btn btn--ghost filters-toggle" data-action="filters-toggle" aria-expanded="false" aria-controls="filters">${icon("sliders", 18)}<span>Filtry</span><em class="count" hidden></em></button>
      <div class="split-btn">
        <button type="button" class="btn btn--primary" data-action="new-task">${icon("plus")}<span>Nowe zadanie</span></button>
        <button type="button" class="btn btn--primary btn--caret" data-action="new-menu" aria-label="Więcej: nowy projekt, etykieta, przestrzeń" aria-expanded="false">${icon("chevronDown")}</button>
        <div class="menu" hidden>
          <button type="button" data-action="new-task">${icon("checkSquare", 18)}Nowe zadanie</button>
          <button type="button" data-action="new-meeting" hidden>${icon("calendar", 18)}Nowe spotkanie</button>
          <button type="button" data-action="manage" data-tab="projects">${icon("folder", 18)}Nowy projekt</button>
          <button type="button" data-action="manage" data-tab="spaces">${icon("layers", 18)}Nowa przestrzeń</button>
          <button type="button" data-action="manage" data-tab="categories" title="Etykiety">${icon("tag", 18)}Nowa etykieta</button>
          <button type="button" data-action="manage" data-tab="assignees">${icon("user", 18)}Nowy wykonawca</button>
        </div>
      </div>
    </div>
    <div class="filters" id="filters" role="group" aria-label="Filtry"></div>
    <section class="view" aria-live="polite"></section>
  </div>
  <button type="button" class="fab" data-action="new-task" aria-label="Nowe zadanie">${icon("plus", 26)}</button>
  <aside class="timer-dock" aria-live="polite" hidden></aside>`;
}

function closePopups(except) {
  for (const [selector, trigger] of [[".menu", "[data-action=new-menu]"], [".popover", ".bell"]]) {
    const popup = root.querySelector(selector);
    if (popup === except) continue;
    popup.hidden = true;
    root.querySelector(trigger).setAttribute("aria-expanded", "false");
  }
}

function toggleSidebar(open) {
  store.sidebarOpen = open;
  root.classList.toggle("sidebar-open", open);
}

// The task being worked on (its timer runs), always in sight in the bottom right corner: title, time, stop.
function renderTimerDock() {
  const dock = root.querySelector(".timer-dock");
  const task = store.tasks.find(t => t.timerStartedAt);
  dock.hidden = !task;
  root.classList.toggle("has-timer-dock", Boolean(task));
  if (!task) { dock.innerHTML = ""; return; }
  dock.innerHTML = `
    <button type="button" class="timer-dock__open" data-action="dock-open" data-id="${task.id}" title="Otwórz zadanie">
      <i class="timer-dock__pulse" aria-hidden="true"></i>
      <span class="timer-dock__text"><small>Pracujesz nad</small><strong>${escapeHtml(task.title)}</strong></span>
      <span class="timer-dock__time" ${timerData(task)}><span>${formatClock(trackedNow(task, store.fetchedAt))}</span></span>
    </button>
    <button type="button" class="icon-btn timer-dock__stop" data-action="dock-stop" data-id="${task.id}" aria-label="Zatrzymaj licznik: ${escapeHtml(task.title)}" title="Zatrzymaj licznik">${icon("pauseCircle", 22)}</button>`;
}

async function handleAction(target, event) {
  const action = target.dataset.action;
  if (action === "scope") {
    toggleSidebar(false);
    setFilter({ spaceId: Number(target.dataset.space) || null, projectId: Number(target.dataset.project) || null, clientId: null });
  } else if (action === "quick") {
    setFilter({ quick: store.filters.quick === target.dataset.quick || target.dataset.quick === "all" ? null : target.dataset.quick });
  } else if (action === "new-task") {
    closePopups();
    openNewTask({ status: target.dataset.status || "todo", dueDate: target.dataset.due || null });
  } else if (action === "new-menu") {
    const menu = root.querySelector(".menu");
    closePopups(menu);
    menu.hidden = !menu.hidden;
    target.setAttribute("aria-expanded", String(!menu.hidden));
  } else if (action === "bell") {
    const popover = root.querySelector(".popover");
    closePopups(popover);
    popover.innerHTML = notificationsHtml();
    popover.hidden = !popover.hidden;
    target.setAttribute("aria-expanded", String(!popover.hidden));
  } else if (action === "manage") {
    closePopups();
    toggleSidebar(false);
    openManage(target.dataset.tab);
  } else if (action === "client-scope") {
    toggleSidebar(false);
    setFilter({ clientId: Number(target.dataset.client), spaceId: null, projectId: null });
  } else if (action === "ui-scale") {
    openScaleDialog();
  } else if (action === "ai-settings") {
    openAiSettings();
  } else if (action === "language") {
    openLanguageDialog();
  } else if (action === "accounts") {
    openAccounts();
  } else if (action === "password") {
    openPassword();
  } else if (action === "client-card") {
    openClient(Number(target.dataset.client));
  } else if (action === "new-meeting") {
    closePopups();
    openMeeting();
  } else if (action === "open-meeting") {
    closePopups();
    openMeeting(calendarState.today.find(e => e.id === Number(target.dataset.id)));
  } else if (action === "open-task") {
    closePopups();
    openDrawer(Number(target.dataset.id));
  } else if (action === "clear-filters") {
    // the filter bar is not redrawn while focus is inside it: let go of the button, then land on the first filter
    target.blur();
    root.querySelector("#search").value = "";
    setFilter({ status: "", projectId: null, clientId: null, labelId: null, assigneeId: null, quick: null, search: "" });
    root.querySelector(".filters select")?.focus();
  } else if (action === "sidebar-collapse") {
    store.sidebarCollapsed = !store.sidebarCollapsed;
    savePrefs();
    render();
  } else if (action === "search-toggle") {
    const open = !root.classList.contains("search-open");
    root.classList.toggle("search-open", open);
    target.setAttribute("aria-expanded", String(open));
    if (open) root.querySelector("#search").focus();
  } else if (action === "filters-toggle") {
    store.filtersOpen = !store.filtersOpen;
    render();
  } else if (action === "sidebar-open") {
    toggleSidebar(true);
  } else if (action === "sidebar-close") {
    toggleSidebar(false);
  } else if (action === "dock-open") {
    openDrawer(Number(target.dataset.id));
  } else if (action === "dock-stop") {
    await runTask(() => api.timer(Number(target.dataset.id), "stop"), "Nie udało się zatrzymać licznika.");
  } else if (action === "logout") {
    if (!(await confirmDialog("Wylogować się z Mytko Tasks?", "Wyloguj"))) return;
    markLoggedOut();
    await logout().catch(() => {});
    window.location.replace("/");
  } else {
    return false;
  }
  event.preventDefault();
  return true;
}

export function startApp(element, session, { notice = null } = {}) {
  root = element;
  store.session = session;
  loadPrefs();
  readLink();
  root.className = "app";
  root.innerHTML = shellHtml();

  root.addEventListener("click", async event => {
    const target = event.target.closest("[data-action]");
    if (!target || !root.contains(target)) {
      if (!event.target.closest(".menu, .popover")) closePopups();
      return;
    }
    if (await handleAction(target, event)) return;
  });
  root.querySelector(".tabs").addEventListener("click", event => {
    const tab = event.target.closest("[data-view]");
    if (!tab) return;
    store.view = tab.dataset.view;
    savePrefs();
    writeLink();
    render();
    if (store.view === "archive") loadArchive();
    if (store.view === "mail") loadMail({ quiet: false });
  });
  root.querySelector(".filters").addEventListener("change", event => {
    const key = event.target.dataset.filter;
    if (!key) return;
    const value = key === "showDone" ? event.target.checked : key === "status" || event.target.value === "none" ? event.target.value : Number(event.target.value) || null;
    setFilter({ [key]: value });
  });
  const search = root.querySelector("#search");
  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilter({ search: search.value.trim() }), 120);
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === "Escape") {
      if (document.querySelector("dialog[open]")) return; // the dialog closes itself
      closeDrawer();
      closePopups();
      toggleSidebar(false);
    }
  });

  window.matchMedia("(max-width: 600px)").addEventListener("change", () => render());
  // Links (#calendar, #task-12, #manage-spaces…) also work in an open tab.
  window.addEventListener("hashchange", () => { const view = store.view; readLink(); if (store.view !== view) render(); openLink(); });
  bindBoard(root);
  bindList(root);
  bindCalendar(root);
  bindArchive(root);
  bindGoals(root);
  bindMail(root);
  render();
  const ready = reload();
  loadArchive();
  if (!isMember()) {
    loadCalendarAccounts().then(loadToday).then(render);
    loadMail();
  }
  if (notice) toast(notice.text, { tone: notice.tone });
  // Running timers tick; other devices' changes arrive when the tab comes back.
  // Running timers tick every second in place; the board re-renders on its own changes only.
  setInterval(() => tickTimers(document), 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { reload({ quiet: true }); loadMail(); } });
  return { closeDrawer, ready };
}
