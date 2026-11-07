// Mytko Tasks app shell: state, sidebar, header with counters, view tabs, filters, and the active view.
import { api } from "../api/client.js";
import { logout, markLoggedOut } from "../auth/login.js";
import { escapeHtml, safeColor } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { counters, filterTasks, initials, isOpen, isoDay, STATUS_LABELS } from "./logic.js";
import { renderBoard, bindBoard, isDragging, updatePeek } from "./board.js";
import { renderList, bindList } from "./list.js";
import { renderCalendar, bindCalendar, afterCalendarRender } from "./calendar.js";
import { calendarState, eventTime, loadCalendarAccounts, loadToday, openMeeting } from "./meetings.js";
import { renderArchive, bindArchive, loadArchive } from "./archive.js";
import { openDrawer, closeDrawer, refreshDrawer } from "./drawer.js";
import { openNewTask, openManage, confirmDialog } from "./dialogs.js";
import { toast } from "./toast.js";

const PREFS = "mytko-tasks-prefs";
const VIEWS = { board: ["board", "Tablica"], list: ["list", "Lista"], calendar: ["calendar", "Kalendarz"], archive: ["archive", "Archiwum"] };

export const store = {
  session: null,
  tasks: [],
  fetchedAt: Date.now(),
  spaces: [], projects: [], labels: [], assignees: [],
  filters: { spaceId: null, projectId: null, labelId: null, assigneeId: null, status: "", search: "", showDone: true, quick: null },
  view: "board",
  listSort: "position",
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

// Links: #board, #list, #calendar choose the view; #task-<id>, #new and #manage-<kind> open after loading.
function readLink() {
  const hash = window.location.hash.slice(1);
  if (VIEWS[hash]) store.view = hash;
  else if (/^task-\d+$|^new$|^manage-(spaces|projects|categories|assignees)$/.test(hash)) pendingLink = hash;
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
    if (typeof saved.sidebarCollapsed === "boolean") store.sidebarCollapsed = saved.sidebarCollapsed;
    if (saved.calendarMode === "week") store.calendarMode = "week";
  } catch { /* preferences are a convenience only */ }
}

function savePrefs() {
  try {
    const { spaceId, projectId, showDone } = store.filters;
    localStorage.setItem(PREFS, JSON.stringify({ view: store.view, showDone, spaceId, projectId, listSort: store.listSort,
      sidebarCollapsed: store.sidebarCollapsed, calendarMode: store.calendarMode }));
  } catch { /* ignore */ }
}

export const lookup = {
  space: id => store.spaces.find(s => s.id === id),
  project: id => store.projects.find(p => p.id === id),
  label: id => store.labels.find(l => l.id === id),
  assignee: id => store.assignees.find(a => a.id === id),
  task: id => store.tasks.find(t => t.id === id),
  privateSpace: () => store.spaces.find(s => s.key === "private")
};

export function context() {
  return {
    privateSpaceId: lookup.privateSpace()?.id ?? null,
    names: {
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
}

export async function reload({ quiet = false } = {}) {
  try {
    const [tasks, spaces, projects, labels, assignees] = await Promise.all([
      api.tasks(), api.list("spaces"), api.list("projects?archived=true"), api.list("categories"), api.list("assignees")
    ]);
    const now = Date.now();
    Object.assign(store, { tasks: tasks.map(t => ({ ...t, fetchedAt: now })), spaces, projects, labels, assignees, fetchedAt: now });
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
  const user = store.session?.login || "";
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
          <i class="dot" data-c="${escapeHtml(space.color)}"></i><span>${escapeHtml(space.name)}</span><em>${openCount(space.id)}</em>
        </button>`).join("")}
      <p class="nav-heading"><span>Projekty</span><button type="button" class="icon-btn icon-btn--sm" data-action="manage" data-tab="projects" aria-label="Zarządzaj projektami">${icon("plus", 16)}</button></p>
      ${activeProjects.length ? activeProjects.map(project => `
        <button type="button" class="nav-item nav-item--sub${filters.projectId === project.id ? " is-active" : ""}" data-action="scope" data-space="${project.spaceId}" data-project="${project.id}" title="${escapeHtml(project.name)}">
          <span class="folder" data-c="${escapeHtml(project.color)}">${icon("folder", 16)}</span><span>${escapeHtml(project.name)}</span><em>${projectCount(project.id)}</em>
        </button>`).join("") : '<p class="nav-empty">Brak projektów w tej przestrzeni.</p>'}
      <p class="nav-heading"><span>Porządek</span></p>
      <button type="button" class="nav-item nav-item--sub" data-action="manage" data-tab="categories" title="Etykiety">${icon("tag", 18)}<span>Etykiety</span><em>${store.labels.length}</em></button>
      <button type="button" class="nav-item nav-item--sub" data-action="manage" data-tab="assignees" title="Wykonawcy">${icon("users", 18)}<span>Wykonawcy</span><em>${store.assignees.length}</em></button>
    </nav>
    <div class="sidebar__foot">
      <div class="profile">
        <span class="avatar avatar--lime">${escapeHtml(initials(user))}</span>
        <span class="profile__text"><strong>${escapeHtml(user)}</strong><small>${store.session?.method === "mytko" ? "Konto Mytko" : "Mytko Tasks"}</small></span>
        <button type="button" class="icon-btn" data-action="logout" aria-label="Wyloguj" title="Wyloguj">${icon("logout")}</button>
      </div>
    </div>`;
}

function headHtml() {
  const { project, space } = scopeTitle();
  const count = counters(store.tasks, store.filters, context());
  const title = project ? project.name : space ? space.name : "Tasks";
  const subtitle = project ? `Zadania, prace i działania w projekcie ${project.name}`
    : space ? `Zadania w przestrzeni ${space.name}` : "Wszystkie zadania, prace i działania";
  const tile = (key, iconName, value, label, tone = "") => `
    <button type="button" class="tile${tone ? ` tile--${tone}` : ""}${store.filters.quick === key ? " is-active" : ""}" data-action="quick" data-quick="${key}" aria-pressed="${store.filters.quick === key}">
      <span class="tile__icon">${icon(iconName, 22)}</span><span><strong>${value}</strong><small>${label}</small></span>
    </button>`;
  return `
    <div class="page-head__title">
      <span class="page-head__icon">${icon("checkSquare", 30)}</span>
      <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
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
    <label class="select"><span class="visually-hidden">Etykieta</span><select data-filter="labelId">
      ${option("", "Wszystkie etykiety", !f.labelId)}${store.labels.map(l => option(l.id, l.name, f.labelId === l.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    <label class="select"><span class="visually-hidden">Wykonawca</span><select data-filter="assigneeId">
      ${option("", "Wszyscy wykonawcy", !f.assigneeId)}${option("none", "Bez wykonawcy", f.assigneeId === "none")}${store.assignees.map(a => option(a.id, a.name, f.assigneeId === a.id)).join("")}
    </select>${icon("chevronDown", 18)}</label>
    <span class="filters__spacer"></span>
    <button type="button" class="icon-btn icon-btn--box" data-action="clear-filters" aria-label="Wyczyść filtry" title="Wyczyść filtry">${icon("sliders")}</button>
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
  const f = store.filters;
  const active = [f.status, f.projectId, f.labelId, f.assigneeId, f.quick, !f.showDone].filter(Boolean).length;
  const badge = root.querySelector(".filters-toggle .count");
  badge.hidden = !active;
  badge.textContent = String(active);
  root.querySelector(".filters-toggle").setAttribute("aria-expanded", String(store.filtersOpen));
  const filters = root.querySelector(".filters");
  if (!filters.contains(document.activeElement)) filters.innerHTML = filtersHtml();
  const hasDue = store.tasks.some(t => isOpen(t) && t.dueDate && t.dueDate <= isoDay());
  root.querySelector(".bell").classList.toggle("has-dot", hasDue || calendarState.today.length > 0);
  root.querySelector('.menu [data-action="new-meeting"]').hidden = !(calendarState.configured && calendarState.accounts.length);
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
    : store.view === "archive" ? renderArchive() : renderBoard();
  if (keep) {
    const board = view.querySelector(".board");
    if (board) board.scrollLeft = keep.left;
    for (const zone of view.querySelectorAll("[data-drop]")) zone.scrollTop = keep.columns[zone.dataset.drop] || 0;
  }
  updatePeek(view);
  if (store.view === "calendar") afterCalendarRender(view);
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
        <button type="button" role="tab" class="tab" data-view="archive">${icon("archive")}<span>Archiwum</span></button>
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
  <button type="button" class="fab" data-action="new-task" aria-label="Nowe zadanie">${icon("plus", 26)}</button>`;
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

async function handleAction(target, event) {
  const action = target.dataset.action;
  if (action === "scope") {
    toggleSidebar(false);
    setFilter({ spaceId: Number(target.dataset.space) || null, projectId: Number(target.dataset.project) || null });
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
    setFilter({ status: "", labelId: null, assigneeId: null, quick: null, search: "" });
    root.querySelector("#search").value = "";
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
  render();
  reload();
  loadArchive();
  loadCalendarAccounts().then(loadToday).then(render);
  if (notice) toast(notice.text, { tone: notice.tone });
  // Running timers tick; other devices' changes arrive when the tab comes back.
  setInterval(() => !isDragging() && root.querySelector("[data-timer]") && render(), 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reload({ quiet: true }); });
  return { closeDrawer };
}
