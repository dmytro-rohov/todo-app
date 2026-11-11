// Modal dialogs (native <dialog>): new task, managing spaces / projects / labels / people, confirmations.
import { api } from "../api/client.js";
import { SCALES, confirmDialog as kitConfirmDialog, dialog, savedScale, saveScale, toast } from "../../vendor/mytko-kit/js/ui.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/core.js";
import { icon } from "../../vendor/mytko-kit/js/icons.js";
import { isoDay, PRIORITY_LABELS, STATUS_LABELS, titleError, yearsAhead } from "./logic.js";
import { isMember, lookup, paint, reload, render, store, upsertTask } from "./app.js";
import { calendarState, loadCalendarAccounts, refreshEvents } from "./meetings.js";
import { openClient } from "./clients.js";
import { openDrawer } from "./drawer.js";
import { avatarHtml as personAvatar } from "./avatar.js";
import { LANG, LANGUAGES, LOCALE, setLang } from "../i18n.js";
import { openJoin, openSpacePeople } from "./sharing.js";

const PALETTE = ["#b7e34d", "#84cc16", "#22c55e", "#14b8a6", "#38bdf8", "#818cf8", "#f2c463", "#fb923c", "#f87171", "#e879f9"];

// Dialogs are the Mytko Kit's (ui.js): the title (.dialog__head h2) names the dialog for screen readers, [data-close]
// closes it, and the backdrop closes it only when the press started there too (selecting text in a field and letting
// go outside never throws typed data away).
export { dialog };

// "Rozmiar interfejsu": the whole interface scales (every size is in rem); kept on this device only.
export function openScaleDialog() {
  const labels = { auto: "Automatycznie (komputer 75%, telefon 70%)", "0.7": "70%", "0.8": "80%", "0.9": "90%", "1": "100%" };
  const current = savedScale();
  const element = dialog("dialog--confirm dialog--scale", `<form class="dialog__body" novalidate>
    <header class="dialog__head"><h2>Rozmiar interfejsu</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <p class="muted">Ustawienie tego urządzenia. Zmianę widać od razu.</p>
    <div class="scale-options">${SCALES.map(value => `<label class="check"><input type="radio" name="scale" value="${value}"${value === current ? " checked" : ""}>${labels[value]}</label>`).join("")}</div>
    <div class="dialog__actions"><button type="button" class="btn btn--primary" data-close>Gotowe</button></div>
  </form>`);
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
  element.addEventListener("change", event => { if (event.target.name === "scale") saveScale(event.target.value); });
}

// "Język": Polish or Ukrainian interface, on this device; the page reloads in the chosen language.
export function openLanguageDialog() {
  const element = dialog("dialog--confirm dialog--scale", `<form class="dialog__body" novalidate>
    <header class="dialog__head"><h2>Język interfejsu</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <p class="muted">Ustawienie tego urządzenia.</p>
    <div class="scale-options">${Object.entries(LANGUAGES).map(([value, label]) => `<label class="check" translate="no" lang="${value}"><input type="radio" name="lang" value="${value}"${value === LANG ? " checked" : ""}>${label}<span class="scale-options__code">${value === "uk" ? "УКР" : "PL"}</span></label>`).join("")}</div>
    <div class="dialog__actions"><button type="button" class="btn btn--primary" data-close>Gotowe</button></div>
  </form>`);
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
  element.addEventListener("change", event => { if (event.target.name === "lang" && event.target.value !== LANG) setLang(event.target.value); });
}

// The kit's confirmation (the question names the dialog; Cancel has the focus, so Enter never confirms by accident).
export function confirmDialog(message, confirmLabel = "OK") {
  return kitConfirmDialog(message, confirmLabel);
}

function choices(list, selected, empty) {
  return `${empty ? `<option value="">${empty}</option>` : ""}${list.map(item =>
    `<option value="${item.id}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`;
}

// mailId / meetingId link the task to an e-mail / a meeting; onCreated(task) runs after it is saved.
// A new task goes to the one chosen in the filter, else to the account itself; "Bez wykonawcy" can still be picked.
function defaultAssignee() {
  if (typeof store.filters.assigneeId === "number") return store.filters.assigneeId;
  return store.assignees.find(person => person.self && person.mine)?.id ?? null;
}

export function openNewTask({ status = "todo", priority = "P2", dueDate = null, clientId = null, meetingId = null, mailId = null, spaceId = null, title = "", description = "",
  onCreated = null } = {}) {
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
      <fieldset class="label-picker priority-picker"><legend>Priorytet</legend>${Object.entries(PRIORITY_LABELS).map(([value, label]) =>
        `<label class="chip chip--toggle chip--priority chip--${value.toLowerCase()}"><input type="radio" name="priority" value="${value}"${value === priority ? " checked" : ""}>${icon("flag", 14)}${label}</label>`).join("")}</fieldset>
      <div class="field-row">
        <label class="field"><span>Przestrzeń</span><span class="select"><select name="spaceId">${choices(store.spaces, spaceId)}</select>${icon("chevronDown", 16)}</span></label>
        <label class="field"><span>Projekt</span><span class="select"><select name="projectId">${choices(projectsFor(spaceId), project?.id, "Bez projektu")}</select>${icon("chevronDown", 16)}</span></label>
      </div>
      <div class="field-row">
        ${isMember() ? "" : `<label class="field"><span>Klient</span><span class="select"><select name="clientId">${choices(store.clients.filter(c => c.status !== "archived"), clientId, "Bez klienta")}</select>${icon("chevronDown", 16)}</span></label>`}
        <label class="field"><span>Wykonawca</span><span class="select"><select name="assigneeId">${choices(store.assignees, defaultAssignee(), "Bez wykonawcy")}</select>${icon("chevronDown", 16)}</span></label>
      </div>
      ${store.labels.length ? `<fieldset class="label-picker"><legend>Etykiety</legend>${store.labels.map(label => `<label class="chip chip--label chip--toggle" data-c="${escapeHtml(label.color)}"><input type="checkbox" name="labelIds" value="${label.id}"${store.filters.labelId === label.id ? " checked" : ""}><i class="dot"></i>${escapeHtml(label.name)}</label>`).join("")}</fieldset>` : ""}
      <label class="field"><span>Opis</span><textarea class="textarea" name="description" rows="3" maxlength="5000" placeholder="Szczegóły, linki, kontekst…">${escapeHtml(description)}</textarea></label>
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
        priority: form.elements.priority.value || "P2",
        dueDate: form.dueDate.value || null,
        spaceId: Number(form.spaceId.value) || null,
        projectId: Number(form.projectId.value) || null,
        assigneeId: Number(form.assigneeId.value) || null,
        clientId: Number(form.clientId?.value) || null,
        meetingId: meetingId || null,
        mailId: mailId || null,
        labelIds: [...form.querySelectorAll('[name="labelIds"]:checked')].map(input => Number(input.value)),
        description: form.description.value
      });
      const open = form.open.checked;
      element.close();
      upsertTask(task);
      if (onCreated) await onCreated(task);
      else toast(`Dodano „${task.title}”.`);
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
  assignees: { title: "Wykonawcy", placeholder: "Nowy wykonawca…", list: () => store.assignees, hint: "Ty jesteś tu zawsze (ze swoim zdjęciem) i nowe zadania trafiają domyślnie do Ciebie; można też wybrać „Bez wykonawcy”. Pozostali to osoby, którym przypisujesz zadania (to nie są konta logowania). Usunięcie zostawia zadania bez wykonawcy." }
};

// Spaces, labels, assignees and projects of another account (seen through a shared space): shown, not editable; a
// shared space shows its people (and can be left there).
function sharedItemHtml(kind, item) {
  return `<li data-item="${item.id}" class="is-shared"><i class="dot" data-c="${escapeHtml(item.color)}"></i>
    <span>${escapeHtml(item.name)}</span>${kind === "spaces" ? peopleButton(item)
      : `<span class="badge" title="Należy do innego konta, widoczna przez wspólną przestrzeń">${icon("users", 16)}wspólne</span>`}</li>`;
}

const peopleButton = item => `<button type="button" class="btn btn--ghost btn--sm people-btn" data-people="${item.id}" title="Kto jest w tej przestrzeni">${icon("users", 16)}<span>Osoby</span><em>${item.people}</em></button>`;

// A project shows the space it is in; built-in space names are translated, the user's own are not.
function spaceChip(spaceId) {
  const space = store.spaces.find(item => item.id === spaceId);
  if (!space) return "";
  const builtIn = space.key === "work" || String(space.key).startsWith("private");
  return `<span class="space-chip" data-c="${escapeHtml(space.color)}" title="Przestrzeń"><i class="dot"></i><span${builtIn ? "" : ' translate="no"'}>${escapeHtml(space.name)}</span></span>`;
}

// expanded: ids of the projects whose details (space, client, archive) are open.
function itemHtml(kind, item, expanded = new Set()) {
  if (item.mine === false) return sharedItemHtml(kind, item);
  const builtIn = (kind === "spaces" && item.key) || (kind === "assignees" && item.self);
  const extra = kind === "assignees"
    ? item.self
      ? `<span class="me-badge" title="To Ty: to konto, zawsze na liście">Ty</span>`
      : `<button type="button" class="btn btn--ghost btn--sm mrow__hover" data-into-self title="Przenieś zadania tego wykonawcy na siebie i usuń ten wpis">${icon("user", 16)}To ja</button>`
    : kind === "clients"
    ? `<span class="select select--sm"><select name="status" aria-label="Status">${[["lead", "Lead"], ["client", "Klient"], ["archived", "Archiwum"]].map(([v, l]) => `<option value="${v}"${item.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>${icon("chevronDown", 16)}</span>
       <button type="button" class="btn btn--ghost btn--sm" data-client-card="${item.id}">Karta</button>`
    : kind === "projects"
    ? `<span class="select select--sm"><select name="spaceId" aria-label="Przestrzeń">${choices(store.spaces, item.spaceId)}</select>${icon("chevronDown", 16)}</span>
       ${isMember() ? "" : `<span class="select select--sm"><select name="clientId" aria-label="Klient">${choices(store.clients.filter(c => c.status !== "archived" || c.id === item.clientId), item.clientId, "Bez klienta")}</select>${icon("chevronDown", 16)}</span>`}
       <label class="check" title="Zarchiwizowany projekt znika z list, jego zadania zostają"><input type="checkbox" name="archived"${item.archivedAt ? " checked" : ""}>Archiwum</label>`
    : kind === "spaces"
      ? `<label class="check" title="Wspólną przestrzeń widzą i edytują osoby, które do niej dodasz lub zaprosisz"><input type="checkbox" name="shared"${item.shared ? " checked" : ""}${builtIn ? " disabled" : ""}>Wspólna</label>
        ${item.shared ? peopleButton(item) : ""}
        ${isMember() ? "" : `<label class="check" title="Tylko takie przestrzenie mogą kiedyś zobaczyć integracje i agenci AI"><input type="checkbox" name="agentVisible"${item.agentVisible ? " checked" : ""}${item.key === "private" ? " disabled" : ""}>Dla agentów</label>`}`
      : "";
  const account = kind === "spaces" ? calendarState.accounts.find(a => a.spaceId === item.id) : null;
  const calendarRow = kind !== "spaces" ? "" : !calendarState.configured
    ? ""
    : account
      ? `<div class="cal-link">${icon("calendar", 16)}<span><strong>${escapeHtml(account.accountEmail)}</strong>
          <small class="${account.lastError ? "is-error" : "muted"}">${account.lastError ? escapeHtml(account.lastError) : account.lastSyncAt ? `zsynchronizowano ${new Date(account.lastSyncAt).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}` : "synchronizacja…"}</small></span>
          <button type="button" class="btn btn--ghost btn--sm" data-cal-action="sync" data-account="${account.id}">Synchronizuj</button>
          <button type="button" class="btn btn--ghost btn--sm" data-cal-action="connect" data-space="${item.id}">Zmień konto</button>
          <button type="button" class="icon-btn" data-cal-action="disconnect" data-account="${account.id}" aria-label="Odłącz kalendarz" title="Odłącz kalendarz">${icon("x", 18)}</button></div>`
      : `<div class="cal-link"><button type="button" class="btn btn--ghost btn--sm" data-cal-action="connect" data-space="${item.id}">${icon("calendar", 16)}Podłącz Kalendarz Google</button></div>`;
  // one's own entry shows one's picture (or initials) instead of the colour
  const swatch = kind === "assignees" && item.self
    ? `${personAvatar({ id: item.accountId, name: item.name, avatarAt: item.avatarAt }, "avatar--lime mrow__me")}<input type="hidden" name="color" value="${escapeHtml(item.color)}">`
    : `<input type="color" name="color" value="${escapeHtml(item.color)}" aria-label="Kolor">`;
  const name = `${swatch}
    <input name="name" value="${escapeHtml(item.name)}" maxlength="${kind === "spaces" || kind === "categories" ? 50 : 80}" aria-label="Nazwa">`;
  if (kind === "projects") {
    const open = expanded.has(item.id);
    return `<li data-item="${item.id}" class="mrow mrow--project${open ? " is-open" : ""}${item.archivedAt ? " is-archived" : ""}">
    ${name}
    ${spaceChip(item.spaceId)}${item.archivedAt ? '<span class="mrow__flag">Archiwum</span>' : ""}
    <button type="button" class="icon-btn mrow__toggle" data-expand aria-expanded="${open}" aria-label="Szczegóły projektu" title="Przestrzeń, klient, archiwum">${icon("chevronDown", 18)}</button>
    <button type="button" class="icon-btn" data-remove aria-label="Usuń ${escapeHtml(item.name)}">${icon("trash", 18)}</button>
    <div class="mrow__more"${open ? "" : " hidden"}>${extra}</div>
  </li>`;
  }
  return `<li data-item="${item.id}" class="mrow">
    ${name}
    ${extra}
    ${builtIn ? (kind === "assignees" ? "" : `<span class="badge" title="Wbudowana">${icon("layers", 16)}</span>`) : `<button type="button" class="icon-btn" data-remove aria-label="Usuń ${escapeHtml(item.name)}">${icon("trash", 18)}</button>`}
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
  const expanded = new Set();

  function draw() {
    const k = KINDS[active];
    for (const tab of element.querySelectorAll("[data-kind]")) {
      tab.classList.toggle("is-active", tab.dataset.kind === active);
      tab.setAttribute("aria-selected", String(tab.dataset.kind === active));
    }
    const color = PALETTE[k.list().length % PALETTE.length];
    const defaultSpace = store.filters.spaceId || lookup.privateSpace()?.id;
    element.querySelector(".manage").innerHTML = `
      <p class="manage__hint">${active === "spaces" && isMember() ? "Prywatne są wbudowane. Własną przestrzeń możesz oznaczyć jako wspólną i zaprosić do niej kogoś kodem lub linkiem. Przestrzenie oznaczone ikoną osób udostępnił Ci ktoś inny." : k.hint}</p>
      ${active === "spaces" ? `<p class="manage__hint">${isMember() ? "Masz kod od kogoś? Dołącz nim do jego przestrzeni." : "Wspólną przestrzeń widzą i edytują tylko osoby, które do niej dodasz z listy kont albo zaprosisz kodem lub linkiem."}</p>` : ""}
      <ul class="manage__list">${k.list().map(item => itemHtml(active, item, expanded)).join("") || `<li class="muted">Jeszcze nic tu nie ma.</li>`}</ul>
      <form class="manage__add" data-add>
        <input type="color" name="color" value="${color}" aria-label="Kolor">
        <input name="name" maxlength="${active === "spaces" || active === "categories" ? 50 : 80}" placeholder="${k.placeholder}" aria-label="Nazwa" required>
        ${active === "projects" ? `<span class="select select--sm"><select name="spaceId" aria-label="Przestrzeń">${choices(store.spaces, defaultSpace)}</select>${icon("chevronDown", 16)}</span>` : ""}
        ${active === "spaces" ? '<label class="check" title="Wspólną przestrzeń widzą i edytują osoby, które do niej dodasz lub zaprosisz"><input type="checkbox" name="shared">Wspólna</label>' : ""}
        <button type="submit" class="btn btn--primary btn--sm">${icon("plus", 18)}Dodaj</button>
      </form>
      ${active === "spaces" ? `<button type="button" class="btn btn--ghost btn--sm manage__join" data-join>${icon("users", 16)}Mam kod zaproszenia</button>` : ""}
      <p class="field-error" data-error hidden></p>`;
    paint(element.querySelector(".manage"));
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
    const toggle = event.target.closest("[data-expand]");
    if (toggle) {
      const row = toggle.closest("[data-item]");
      const id = Number(row.dataset.item);
      const open = !expanded.has(id);
      if (open) expanded.add(id); else expanded.delete(id);
      row.classList.toggle("is-open", open);
      row.querySelector(".mrow__more").hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      return;
    }
    const people = event.target.closest("[data-people]");
    if (people) {
      const space = store.spaces.find(item => item.id === Number(people.dataset.people));
      return space && openSpacePeople(space, () => { if (element.open) draw(); });
    }
    if (event.target.closest("[data-join]")) return openJoin("", () => draw());
    const card = event.target.closest("[data-client-card]");
    if (card) { element.close(); return openClient(Number(card.dataset.clientCard)); }
    const intoSelf = event.target.closest("[data-into-self]");
    if (intoSelf) {
      const row = intoSelf.closest("[data-item]");
      const name = row.querySelector('[name="name"]').value;
      if (!(await confirmDialog(`„${name}” to Ty? Jego zadania zostaną przypisane do Ciebie, a ten wpis zniknie.`, "To ja"))) return;
      try {
        const { moved } = await api.assigneeIntoSelf(row.dataset.item);
        toast(`Przypisano do Ciebie zadań: ${moved}.`);
        await afterChange();
      } catch (error) { fail(error); }
      return;
    }
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
    try {
      const saved = await api.update(active, row.dataset.item, body);
      await afterChange();
      // shared now: straight on to who is in it
      if (active === "spaces" && field === "shared" && saved.shared) openSpacePeople(saved, () => { if (element.open) draw(); });
    } catch (error) { fail(error); await afterChange(); }
  });

  element.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const body = { name: form.name.value.trim(), color: form.color.value };
    if (active === "projects") body.spaceId = Number(form.spaceId.value);
    if (active === "spaces" && form.shared.checked) body.shared = true;
    try {
      const saved = await api.create(active, body);
      await afterChange();
      element.querySelector("[data-add] [name=name]").focus();
      if (active === "spaces" && saved.shared) openSpacePeople(saved, () => { if (element.open) draw(); });
    } catch (error) { fail(error); }
  });

  draw();
  element.querySelector("[data-add] [name=name]").focus();
  // The calendar rows need the connected accounts; refresh them (also right after returning from Google).
  if (active === "spaces" && !isMember()) loadCalendarAccounts().then(() => { if (element.open) draw(); });
}
