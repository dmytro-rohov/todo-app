// Modal dialogs (native <dialog>): new task, managing spaces / projects / labels / people, confirmations.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { isoDay, STATUS_LABELS, titleError, yearsAhead } from "./logic.js";
import { isMember, lookup, paint, reload, render, store, upsertTask } from "./app.js";
import { calendarState, loadCalendarAccounts, refreshEvents } from "./meetings.js";
import { openClient } from "./clients.js";
import { openDrawer } from "./drawer.js";
import { toast } from "./toast.js";

const PALETTE = ["#b7e34d", "#84cc16", "#22c55e", "#14b8a6", "#38bdf8", "#818cf8", "#f2c463", "#fb923c", "#f87171", "#e879f9"];

export function dialog(className, html) {
  const element = document.createElement("dialog");
  element.className = `dialog ${className}`;
  element.innerHTML = html;
  document.body.append(element);
  element.addEventListener("close", () => element.remove());
  element.addEventListener("click", event => { if (event.target === element) element.close(); });
  paint(element);
  element.showModal();
  return element;
}

export function confirmDialog(message, confirmLabel = "OK") {
  return new Promise(resolve => {
    const element = dialog("dialog--confirm", `
      <form method="dialog" class="dialog__body">
        <p>${escapeHtml(message)}</p>
        <div class="dialog__actions">
          <button type="submit" value="cancel" class="btn btn--ghost">Anuluj</button>
          <button type="submit" value="ok" class="btn btn--danger">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`);
    element.querySelector('[value="cancel"]').focus();
    element.addEventListener("close", () => resolve(element.returnValue === "ok"));
  });
}

function choices(list, selected, empty) {
  return `${empty ? `<option value="">${empty}</option>` : ""}${list.map(item =>
    `<option value="${item.id}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`;
}

export function openNewTask({ status = "todo", dueDate = null, clientId = null, meetingId = null, spaceId = null, title = "" } = {}) {
  const privateSpace = lookup.privateSpace();
  const project = lookup.project(store.filters.projectId);
  spaceId = spaceId || project?.spaceId || store.filters.spaceId || privateSpace?.id;
  clientId = clientId ?? store.filters.clientId ?? null;
  const projectsFor = id => store.projects.filter(p => !p.archivedAt && p.spaceId === id);
  const element = dialog("dialog--task", `
    <form class="dialog__body" novalidate>
      <header class="dialog__head"><h2>Nowe zadanie</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
      <label class="field"><span>Tytuł</span><input name="title" maxlength="100" required placeholder="Co jest do zrobienia?" autocomplete="off" value="${escapeHtml(title)}"></label>
      <p class="field-error" data-error hidden></p>
      <div class="field-row">
        <label class="field"><span>Status</span><span class="select"><select name="status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}"${k === status ? " selected" : ""}>${v}</option>`).join("")}</select>${icon("chevronDown", 16)}</span></label>
        <label class="field"><span data-date-label>${status === "planned" ? "Cel (opcjonalnie)" : "Termin"}</span><input type="date" name="dueDate" value="${dueDate || ""}"></label>
      </div>
      <div class="horizon" data-horizon${status === "planned" ? "" : " hidden"}><span>Cel za:</span>
        ${[[1, "rok"], [2, "2 lata"], [5, "5 lat"]].map(([years, label]) => `<button type="button" class="chip chip--toggle-btn" data-years="${years}">${label}</button>`).join("")}
        <button type="button" class="chip chip--toggle-btn" data-years="0">kiedyś</button></div>
      <div class="field-row">
        <label class="field"><span>Przestrzeń</span><span class="select"><select name="spaceId">${choices(store.spaces, spaceId)}</select>${icon("chevronDown", 16)}</span></label>
        <label class="field"><span>Projekt</span><span class="select"><select name="projectId">${choices(projectsFor(spaceId), project?.id, "Bez projektu")}</select>${icon("chevronDown", 16)}</span></label>
      </div>
      <div class="field-row">
        ${isMember() ? "" : `<label class="field"><span>Klient</span><span class="select"><select name="clientId">${choices(store.clients.filter(c => c.status !== "archived"), clientId, "Bez klienta")}</select>${icon("chevronDown", 16)}</span></label>`}
        <label class="field"><span>Wykonawca</span><span class="select"><select name="assigneeId">${choices(store.assignees, null, "Bez wykonawcy")}</select>${icon("chevronDown", 16)}</span></label>
      </div>
      ${store.labels.length ? `<fieldset class="label-picker"><legend>Etykiety</legend>${store.labels.map(label => `<label class="chip chip--label chip--toggle" data-c="${escapeHtml(label.color)}"><input type="checkbox" name="labelIds" value="${label.id}"${store.filters.labelId === label.id ? " checked" : ""}><i class="dot"></i>${escapeHtml(label.name)}</label>`).join("")}</fieldset>` : ""}
      <label class="field"><span>Opis</span><textarea class="textarea" name="description" rows="3" maxlength="5000" placeholder="Szczegóły, linki, kontekst…"></textarea></label>
      <div class="dialog__actions">
        <label class="check"><input type="checkbox" name="open">Otwórz szczegóły po dodaniu</label>
        <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
        <button type="submit" class="btn btn--primary">${icon("plus")}Dodaj zadanie</button>
      </div>
    </form>`);
  const form = element.querySelector("form");
  form.title.focus();
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
  form.status.addEventListener("change", () => {
    const plan = form.status.value === "planned";
    form.querySelector("[data-horizon]").hidden = !plan;
    form.querySelector("[data-date-label]").textContent = plan ? "Cel (opcjonalnie)" : "Termin";
  });
  form.querySelector("[data-horizon]").addEventListener("click", event => {
    const button = event.target.closest("[data-years]");
    if (button) form.dueDate.value = Number(button.dataset.years) ? yearsAhead(Number(button.dataset.years)) : "";
  });
  form.spaceId.addEventListener("change", () => {
    form.projectId.innerHTML = choices(projectsFor(Number(form.spaceId.value)), null, "Bez projektu");
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = form.title.value;
    const error = titleError(title);
    const box = form.querySelector("[data-error]");
    box.textContent = error;
    box.hidden = !error;
    if (error) return form.title.focus();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const task = await api.createTask({
        title: title.trim(),
        date: isoDay(),
        status: form.status.value,
        dueDate: form.dueDate.value || null,
        spaceId: Number(form.spaceId.value) || null,
        projectId: Number(form.projectId.value) || null,
        assigneeId: Number(form.assigneeId.value) || null,
        clientId: Number(form.clientId?.value) || null,
        meetingId: meetingId || null,
        labelIds: [...form.querySelectorAll('[name="labelIds"]:checked')].map(input => Number(input.value)),
        description: form.description.value
      });
      const open = form.open.checked;
      element.close();
      upsertTask(task);
      toast(`Dodano „${task.title}”.`);
      if (open) openDrawer(task.id);
    } catch (failure) {
      submit.disabled = false;
      box.textContent = failure.message || "Nie udało się dodać zadania.";
      box.hidden = false;
    }
  });
}

// ---- manage ------------------------------------------------------------------------------------------------
const KINDS = {
  spaces: { title: "Przestrzenie", placeholder: "Nowa przestrzeń…", list: () => store.spaces, hint: "Praca i Prywatne są wbudowane: można zmienić ich nazwę i kolor, nie można ich usunąć. Zadania z usuniętej przestrzeni trafiają do Prywatnych. Każda przestrzeń może mieć własny Kalendarz Google." },
  projects: { title: "Projekty", placeholder: "Nowy projekt…", list: () => store.projects, hint: "Projekt to folder klienta w jednej przestrzeni. Jego zadania dostają jego etykietę. Usunięcie projektu zostawia zadania bez projektu." },
  categories: { title: "Etykiety", placeholder: "Nowa etykieta…", list: () => store.labels, hint: "Etykiety można łączyć: zadanie może mieć kilka. Usunięcie etykiety zdejmuje ją ze wszystkich zadań." },
  clients: { title: "Klienci", placeholder: "Nowy klient lub lead…", list: () => store.clients, hint: "Lead to ktoś przed współpracą (np. po rezerwacji spotkania), klient to stała współpraca. Spotkania z gośćmi z jego adresu lub domeny same się do niego przypinają. Usunięcie zostawia zadania i projekty bez klienta." },
  assignees: { title: "Wykonawcy", placeholder: "Nowy wykonawca…", list: () => store.assignees, hint: "Osoby, którym przypisujesz zadania (to nie są konta logowania). Usunięcie zostawia zadania bez wykonawcy." }
};

// Spaces, labels, assignees and projects of another account (seen through a shared space): shown, not editable.
function sharedItemHtml(item) {
  return `<li data-item="${item.id}" class="is-shared"><i class="dot" data-c="${escapeHtml(item.color)}"></i>
    <span>${escapeHtml(item.name)}</span><span class="badge" title="Należy do innego konta, widoczna przez wspólną przestrzeń">${icon("users", 16)}wspólne</span></li>`;
}

function itemHtml(kind, item) {
  if (item.mine === false) return sharedItemHtml(item);
  const builtIn = kind === "spaces" && item.key;
  const extra = kind === "clients"
    ? `<span class="select select--sm"><select name="status" aria-label="Status">${[["lead", "Lead"], ["client", "Klient"], ["archived", "Archiwum"]].map(([v, l]) => `<option value="${v}"${item.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>${icon("chevronDown", 16)}</span>
       <button type="button" class="btn btn--ghost btn--sm" data-client-card="${item.id}">Karta</button>`
    : kind === "projects"
    ? `<span class="select select--sm"><select name="spaceId" aria-label="Przestrzeń">${choices(store.spaces, item.spaceId)}</select>${icon("chevronDown", 16)}</span>
       ${isMember() ? "" : `<span class="select select--sm"><select name="clientId" aria-label="Klient">${choices(store.clients.filter(c => c.status !== "archived" || c.id === item.clientId), item.clientId, "Bez klienta")}</select>${icon("chevronDown", 16)}</span>`}
       <label class="check" title="Zarchiwizowany projekt znika z list, jego zadania zostają"><input type="checkbox" name="archived"${item.archivedAt ? " checked" : ""}>Archiwum</label>`
    : kind === "spaces"
      ? `<label class="check" title="Wspólną przestrzeń widzą i edytują wszystkie konta (np. Dom, zakupy)"><input type="checkbox" name="shared"${item.shared ? " checked" : ""}${builtIn ? " disabled" : ""}>Wspólna</label>
        ${isMember() ? "" : `<label class="check" title="Tylko takie przestrzenie mogą kiedyś zobaczyć integracje i agenci AI"><input type="checkbox" name="agentVisible"${item.agentVisible ? " checked" : ""}${item.key === "private" ? " disabled" : ""}>Dla agentów</label>`}`
      : "";
  const account = kind === "spaces" ? calendarState.accounts.find(a => a.spaceId === item.id) : null;
  const calendarRow = kind !== "spaces" ? "" : !calendarState.configured
    ? ""
    : account
      ? `<div class="cal-link">${icon("calendar", 16)}<span><strong>${escapeHtml(account.accountEmail)}</strong>
          <small class="${account.lastError ? "is-error" : "muted"}">${account.lastError ? escapeHtml(account.lastError) : account.lastSyncAt ? `zsynchronizowano ${new Date(account.lastSyncAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : "synchronizacja…"}</small></span>
          <button type="button" class="btn btn--ghost btn--sm" data-cal-action="sync" data-account="${account.id}">Synchronizuj</button>
          <button type="button" class="btn btn--ghost btn--sm" data-cal-action="connect" data-space="${item.id}">Zmień konto</button>
          <button type="button" class="icon-btn" data-cal-action="disconnect" data-account="${account.id}" aria-label="Odłącz kalendarz" title="Odłącz kalendarz">${icon("x", 18)}</button></div>`
      : `<div class="cal-link"><button type="button" class="btn btn--ghost btn--sm" data-cal-action="connect" data-space="${item.id}">${icon("calendar", 16)}Podłącz Kalendarz Google</button></div>`;
  return `<li data-item="${item.id}">
    <input type="color" name="color" value="${escapeHtml(item.color)}" aria-label="Kolor">
    <input name="name" value="${escapeHtml(item.name)}" maxlength="${kind === "spaces" || kind === "categories" ? 50 : 80}" aria-label="Nazwa">
    ${extra}
    ${builtIn ? `<span class="badge" title="Wbudowana">${icon("layers", 16)}</span>` : `<button type="button" class="icon-btn" data-remove aria-label="Usuń ${escapeHtml(item.name)}">${icon("trash", 18)}</button>`}
    ${calendarRow}
  </li>`;
}

export function openManage(kind = "projects") {
  const element = dialog("dialog--manage", `<div class="dialog__body">
    <header class="dialog__head"><h2>Porządek</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <div class="tabs tabs--sm" role="tablist">${Object.entries(KINDS).filter(([key]) => key !== "clients" || !isMember()).map(([key, k]) => `<button type="button" role="tab" class="tab" data-kind="${key}">${k.title}</button>`).join("")}</div>
    <div class="manage" aria-live="polite"></div>
  </div>`);
  let active = kind;

  function draw() {
    const k = KINDS[active];
    for (const tab of element.querySelectorAll("[data-kind]")) {
      tab.classList.toggle("is-active", tab.dataset.kind === active);
      tab.setAttribute("aria-selected", String(tab.dataset.kind === active));
    }
    const color = PALETTE[k.list().length % PALETTE.length];
    const defaultSpace = store.filters.spaceId || lookup.privateSpace()?.id;
    element.querySelector(".manage").innerHTML = `
      <p class="manage__hint">${active === "spaces" && isMember() ? "Prywatne są wbudowane. Własne przestrzenie możesz oznaczyć jako wspólne: wtedy widzą je i edytują wszystkie konta. Przestrzenie oznaczone ikoną osób udostępnił ktoś inny." : k.hint}</p>
      <ul class="manage__list">${k.list().map(item => itemHtml(active, item)).join("") || `<li class="muted">Jeszcze nic tu nie ma.</li>`}</ul>
      <form class="manage__add" data-add>
        <input type="color" name="color" value="${color}" aria-label="Kolor">
        <input name="name" maxlength="${active === "spaces" || active === "categories" ? 50 : 80}" placeholder="${k.placeholder}" aria-label="Nazwa" required>
        ${active === "projects" ? `<span class="select select--sm"><select name="spaceId" aria-label="Przestrzeń">${choices(store.spaces, defaultSpace)}</select>${icon("chevronDown", 16)}</span>` : ""}
        <button type="submit" class="btn btn--primary btn--sm">${icon("plus", 18)}Dodaj</button>
      </form>
      <p class="field-error" data-error hidden></p>`;
  }

  function fail(error) {
    const box = element.querySelector("[data-error]");
    box.textContent = error.message || "Nie udało się zapisać.";
    box.hidden = false;
  }

  async function afterChange() {
    await reload({ quiet: true });
    draw();
  }

  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    const calendarButton = event.target.closest("[data-cal-action]");
    if (calendarButton) {
      const kind = calendarButton.dataset.calAction;
      try {
        if (kind === "connect") {
          const { url } = await api.calendarConnect(Number(calendarButton.dataset.space));
          return window.location.assign(url);
        }
        if (kind === "sync") {
          calendarButton.disabled = true;
          const result = await api.calendarSync(Number(calendarButton.dataset.account));
          toast(result.ok ? `Zsynchronizowano (${result.events} wydarzeń).` : result.error, { tone: result.ok ? "info" : "error" });
        }
        if (kind === "disconnect") {
          if (!(await confirmDialog("Odłączyć kalendarz od tej przestrzeni? Spotkania znikną z Tasks (w Google zostają).", "Odłącz"))) return;
          await api.calendarDisconnect(Number(calendarButton.dataset.account));
        }
        await loadCalendarAccounts();
        refreshEvents();
        draw();
        render();
      } catch (error) { fail(error); }
      return;
    }
    const tab = event.target.closest("[data-kind]");
    if (tab) { active = tab.dataset.kind; return draw(); }
    const card = event.target.closest("[data-client-card]");
    if (card) { element.close(); return openClient(Number(card.dataset.clientCard)); }
    const remove = event.target.closest("[data-remove]");
    if (!remove) return;
    const row = remove.closest("[data-item]");
    const name = row.querySelector('[name="name"]').value;
    if (!(await confirmDialog(`Usunąć „${name}”?`, "Usuń"))) return;
    try { await api.remove(active, row.dataset.item); await afterChange(); } catch (error) { fail(error); }
  });

  element.addEventListener("change", async event => {
    const row = event.target.closest("[data-item]");
    if (!row) return;
    const body = { name: row.querySelector('[name="name"]').value.trim(), color: row.querySelector('[name="color"]').value };
    const field = event.target.name;
    if (active === "projects") {
      body.spaceId = Number(row.querySelector('[name="spaceId"]').value);
      if (row.querySelector('[name="clientId"]')) body.clientId = Number(row.querySelector('[name="clientId"]').value) || null;
      if (field === "archived") { Object.keys(body).forEach(key => delete body[key]); body.archived = event.target.checked; }
    }
    if (active === "clients") {
      body.status = row.querySelector('[name="status"]').value;
    }
    if (active === "spaces" && (field === "agentVisible" || field === "shared")) {
      if (field === "shared" && !event.target.checked &&
          !(await confirmDialog("Przestać udostępniać tę przestrzeń? Zadania innych kont z tej przestrzeni wrócą do ich Prywatnych.", "Przestań udostępniać"))) {
        event.target.checked = true;
        return;
      }
      Object.keys(body).forEach(key => delete body[key]);
      body[field] = event.target.checked;
    }
    try { await api.update(active, row.dataset.item, body); await afterChange(); } catch (error) { fail(error); await afterChange(); }
  });

  element.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const body = { name: form.name.value.trim(), color: form.color.value };
    if (active === "projects") body.spaceId = Number(form.spaceId.value);
    try {
      await api.create(active, body);
      await afterChange();
      element.querySelector("[data-add] [name=name]").focus();
    } catch (error) { fail(error); }
  });

  draw();
  element.querySelector("[data-add] [name=name]").focus();
  // The calendar rows need the connected accounts; refresh them (also right after returning from Google).
  if (active === "spaces" && !isMember()) loadCalendarAccounts().then(() => { if (element.open) draw(); });
}
