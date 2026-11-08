// "Cele / Marzenia": a list of goals and dreams for a month or for a whole year. Each item can be ticked off (it stays,
// crossed out, so the month or the year can be looked back on), switched between goal and dream, edited and moved
// up or down. Earlier lists sit on the side with how much of each was done.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { isoDay, MONTHS } from "./logic.js";
import { render } from "./app.js";
import { confirmDialog, dialog } from "./dialogs.js";
import { toast } from "./toast.js";
import { LOCALE } from "../i18n.js";

const now = new Date();
export const goalsState = {
  mode: "month", year: now.getFullYear(), month: now.getMonth() + 1,
  items: null, key: null, periods: [], loading: false, failed: null,
  // what is being typed into the add form survives a re-render of the page
  draft: { title: "", description: "", deadline: "", kind: "goal", more: false }
};

const KINDS = { goal: "Cel", dream: "Marzenie" };
const period = () => ({ year: goalsState.year, month: goalsState.mode === "month" ? goalsState.month : null });
const keyOf = ({ year, month }) => `${year}-${month ?? "y"}`;
const periodName = ({ year, month }) => (month ? `${MONTHS[month - 1]} ${year}` : `Rok ${year}`);
const deadlineText = day => new Date(`${day}T12:00:00`).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });

export async function loadGoals() {
  const current = period();
  const key = keyOf(current);
  goalsState.loading = true;
  goalsState.failed = null;
  try {
    const [items, periods] = await Promise.all([api.goals(current.year, current.month), api.goalPeriods()]);
    // another period chosen meanwhile: the render below loads that one instead
    if (keyOf(period()) === key) Object.assign(goalsState, { items, periods, key });
  } catch (error) {
    // shown with a retry button; never retried on its own (that would loop on a server error)
    if (keyOf(period()) === key) goalsState.failed = { key, message: error.message || "Nie udało się wczytać listy." };
  } finally {
    goalsState.loading = false;
  }
  render();
}

function summary(items) {
  const count = list => `${list.filter(g => g.doneAt).length}/${list.length}`;
  const done = items.filter(g => g.doneAt).length;
  const percent = items.length ? Math.round(done / items.length * 100) : 0;
  return `<div class="goals__summary">
    <p><strong>Zrobione ${done} z ${items.length}</strong><span class="muted">Cele ${count(items.filter(g => g.kind === "goal"))} · Marzenia ${count(items.filter(g => g.kind === "dream"))}</span></p>
    <span class="goals__progress" role="progressbar" aria-label="Zrobione" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i data-w="${percent}"></i></span>
  </div>`;
}

function itemHtml(goal, index, items) {
  const late = !goal.doneAt && goal.deadline && goal.deadline < isoDay();
  return `<li class="goal goal--${goal.kind}${goal.doneAt ? " is-done" : ""}" data-goal-id="${goal.id}" draggable="true" tabindex="0"
      aria-label="${escapeHtml(goal.title)}. Alt i strzałki zmieniają kolejność.">
    <label class="goal__check"><input type="checkbox" data-goal="done"${goal.doneAt ? " checked" : ""} aria-label="Zrobione: ${escapeHtml(goal.title)}"><span></span></label>
    <div class="goal__main">
      <strong class="goal__title">${escapeHtml(goal.title)}</strong>
      ${goal.description ? `<p class="goal__desc">${escapeHtml(goal.description)}</p>` : ""}
      ${goal.deadline ? `<span class="goal__deadline${late ? " is-late" : ""}">${icon("calendar", 14)}${escapeHtml(deadlineText(goal.deadline))}</span>` : ""}
    </div>
    <div class="goal__tools">
      <button type="button" class="goal__kind" data-goal="kind" title="Zmień na: ${goal.kind === "goal" ? "Marzenie" : "Cel"}">${icon(goal.kind === "goal" ? "target" : "star", 14)}${KINDS[goal.kind]}</button>
      <span class="goal__move">
        <button type="button" class="icon-btn icon-btn--sm" data-goal="up" aria-label="Wyżej"${index === 0 ? " disabled" : ""}>${icon("chevronUp", 16)}</button>
        <button type="button" class="icon-btn icon-btn--sm" data-goal="down" aria-label="Niżej"${index === items.length - 1 ? " disabled" : ""}>${icon("chevronDown", 16)}</button>
      </span>
      <button type="button" class="icon-btn icon-btn--sm" data-goal="edit" aria-label="Edytuj" title="Edytuj">${icon("edit", 16)}</button>
    </div>
  </li>`;
}

function addFormHtml() {
  const d = goalsState.draft;
  return `<form class="goals__add" data-goal-form novalidate>
    <div class="goals__add-row">
      <span class="seg seg--sm" role="group" aria-label="Rodzaj">${Object.entries(KINDS).map(([kind, label]) =>
        `<button type="button" data-goal="draft-kind" data-kind="${kind}" aria-pressed="${d.kind === kind}">${icon(kind === "goal" ? "target" : "star", 14)}${label}</button>`).join("")}</span>
      <input name="title" maxlength="160" placeholder="${d.kind === "goal" ? "Nowy cel…" : "Nowe marzenie…"}" autocomplete="off" value="${escapeHtml(d.title)}" aria-label="Nagłówek">
      <button type="submit" class="btn btn--primary btn--sm">${icon("plus", 16)}Dodaj</button>
    </div>
    <button type="button" class="goals__more" data-goal="more" aria-expanded="${d.more}">${d.more ? "Bez opisu i terminu" : "Opis i termin"}</button>
    <div class="goals__add-more"${d.more ? "" : " hidden"}>
      <textarea class="textarea" name="description" rows="2" maxlength="2000" placeholder="Opis (opcjonalnie)">${escapeHtml(d.description)}</textarea>
      <label class="field field--inline"><span>Termin</span><input type="date" name="deadline" value="${escapeHtml(d.deadline)}"></label>
    </div>
  </form>`;
}

function historyHtml() {
  const current = keyOf(period());
  const rows = goalsState.periods.filter(p => keyOf(p) !== current);
  if (!rows.length) return "";
  return `<aside class="goals__history"><h2>${icon("history", 18)}Inne listy</h2><ul>${rows.map(p => `
    <li><button type="button" data-goal="open-period" data-year="${p.year}" data-month="${p.month ?? ""}">
      <span>${escapeHtml(periodName(p))}</span><small class="muted">${p.done}/${p.total}</small>
      <span class="goals__progress goals__progress--sm"><i data-w="${p.total ? Math.round(p.done / p.total * 100) : 0}"></i></span></button></li>`).join("")}</ul></aside>`;
}

export function renderGoals() {
  const current = period();
  const failed = goalsState.failed?.key === keyOf(current) ? goalsState.failed : null;
  if (goalsState.key !== keyOf(current) && !goalsState.loading && !failed) queueMicrotask(loadGoals);
  const items = goalsState.key === keyOf(current) ? goalsState.items : null;
  const years = [...new Set([...Array.from({ length: 8 }, (_, i) => now.getFullYear() - 2 + i), goalsState.year, ...goalsState.periods.map(p => p.year)])]
    .sort((a, b) => a - b);
  return `<div class="goals">
    <div class="goals__bar">
      <span class="seg" role="group" aria-label="Okres">
        <button type="button" data-goal="mode" data-mode="month" aria-pressed="${goalsState.mode === "month"}">Miesiąc</button>
        <button type="button" data-goal="mode" data-mode="year" aria-pressed="${goalsState.mode === "year"}">Rok</button></span>
      <span class="goals__nav">
        <button type="button" class="icon-btn icon-btn--box" data-goal="prev" aria-label="Poprzedni okres">${icon("chevronLeft")}</button>
        ${goalsState.mode === "month" ? `<label class="select"><span class="visually-hidden">Miesiąc</span><select data-goal-pick="month">${MONTHS.map((name, i) =>
          `<option value="${i + 1}"${i + 1 === goalsState.month ? " selected" : ""}>${name}</option>`).join("")}</select>${icon("chevronDown", 18)}</label>` : ""}
        <label class="select select--year"><span class="visually-hidden">Rok</span><select data-goal-pick="year">${years.map(y =>
          `<option value="${y}"${y === goalsState.year ? " selected" : ""}>${y}</option>`).join("")}</select>${icon("chevronDown", 18)}</label>
        <button type="button" class="icon-btn icon-btn--box" data-goal="next" aria-label="Następny okres">${icon("chevronRight")}</button>
      </span>
    </div>
    <div class="goals__layout">
      <section class="goals__list" aria-label="${escapeHtml(periodName(current))}">
        <header class="goals__head"><h2>${icon(current.month ? "calendar" : "calendarRange", 22)}${escapeHtml(periodName(current))}</h2>${items ? summary(items) : ""}</header>
        ${failed ? `<p class="field-error">${escapeHtml(failed.message)} <button type="button" class="btn btn--ghost btn--sm" data-goal="retry">Spróbuj ponownie</button></p>`
          : items === null ? '<p class="empty">Wczytuję…</p>' : items.length
          ? `<ol class="goals__items" data-goal-list>${items.map(itemHtml).join("")}</ol>`
          : '<p class="goals__empty muted">Pusta lista. Dodaj pierwszy cel albo marzenie na ten okres.</p>'}
        ${items === null ? "" : addFormHtml()}
      </section>
      ${historyHtml()}
    </div>
  </div>`;
}

// widths of progress bars (CSP: no style attributes)
export function afterGoalsRender(view) {
  for (const bar of view.querySelectorAll(".goals__progress i[data-w]")) bar.style.width = `${bar.dataset.w}%`;
}

function shift(step) {
  if (goalsState.mode === "year") goalsState.year += step;
  else {
    const index = goalsState.year * 12 + goalsState.month - 1 + step;
    goalsState.year = Math.floor(index / 12);
    goalsState.month = index % 12 + 1;
  }
  goalsState.key = null;
  render();
}

async function saveOrder(ids) {
  const current = period();
  const key = goalsState.key;
  const before = goalsState.items;
  goalsState.items = ids.map(id => before.find(g => g.id === id));
  render();
  try {
    const items = await api.orderGoals({ ...current, ids });
    if (goalsState.key === key) goalsState.items = items;
  } catch (error) {
    if (goalsState.key === key) goalsState.items = before;
    toast(error.message || "Nie udało się zmienić kolejności.", { tone: "error" });
    await loadGoals();
    return;
  }
  render();
}

function move(id, step) {
  const ids = goalsState.items.map(g => g.id);
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  saveOrder(ids).then(() => document.querySelector(`.goal[data-goal-id="${id}"]`)?.focus());
}

async function update(id, body) {
  const key = goalsState.key;
  try {
    const saved = await api.updateGoal(id, body);
    if (goalsState.key === key) goalsState.items = goalsState.items.map(g => (g.id === id ? saved : g));
    goalsState.periods = await api.goalPeriods();
  } catch (error) {
    toast(error.message || "Nie udało się zapisać.", { tone: "error" });
  }
  render();
}

function openEdit(goal) {
  const element = dialog("dialog--goal", `<form class="dialog__body" novalidate>
    <header class="dialog__head"><h2>${goal.kind === "goal" ? "Cel" : "Marzenie"}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <label class="field"><span>Nagłówek</span><input name="title" maxlength="160" required value="${escapeHtml(goal.title)}"></label>
    <p class="field-error" data-error hidden></p>
    <label class="field"><span>Opis</span><textarea class="textarea" name="description" rows="4" maxlength="2000">${escapeHtml(goal.description)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Termin</span><input type="date" name="deadline" value="${escapeHtml(goal.deadline || "")}"></label>
      <label class="field"><span>Rodzaj</span><span class="select"><select name="kind">${Object.entries(KINDS).map(([kind, label]) =>
        `<option value="${kind}"${kind === goal.kind ? " selected" : ""}>${label}</option>`).join("")}</select>${icon("chevronDown", 16)}</span></label>
    </div>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost btn--danger-text" data-delete>${icon("trash", 18)}Usuń</button>
      <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
      <button type="submit" class="btn btn--primary">Zapisz</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  form.title.focus();
  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) element.close();
    if (event.target.closest("[data-delete]")) {
      element.close();
      if (!(await confirmDialog(`Usunąć „${goal.title}”?`, "Usuń"))) return;
      try {
        await api.deleteGoal(goal.id);
        goalsState.items = goalsState.items.filter(g => g.id !== goal.id);
        goalsState.periods = await api.goalPeriods();
        render();
      } catch (error) {
        toast(error.message || "Nie udało się usunąć.", { tone: "error" });
      }
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = form.title.value.trim();
    const box = form.querySelector("[data-error]");
    box.hidden = Boolean(title);
    box.textContent = title ? "" : "Podaj nagłówek.";
    if (!title) return form.title.focus();
    element.close();
    await update(goal.id, { title, description: form.description.value, deadline: form.deadline.value || null, kind: form.kind.value });
  });
}

async function add(form) {
  const d = goalsState.draft;
  d.title = form.title.value;
  d.description = form.description.value;
  d.deadline = form.deadline.value;
  if (!d.title.trim()) return form.title.focus();
  const key = goalsState.key;
  try {
    const goal = await api.createGoal({ ...period(), title: d.title, description: d.description, deadline: d.deadline || null, kind: d.kind });
    if (goalsState.key === key) goalsState.items = [...goalsState.items, goal];
    goalsState.periods = await api.goalPeriods();
    Object.assign(d, { title: "", description: "", deadline: "" });
  } catch (error) {
    toast(error.message || "Nie udało się dodać.", { tone: "error" });
  }
  render();
  document.querySelector('[data-goal-form] [name="title"]')?.focus();
}

export function bindGoals(root) {
  const view = root.querySelector(".view");
  const mine = () => view.dataset.view === "goals";
  const goalOf = element => goalsState.items?.find(g => g.id === Number(element.closest("[data-goal-id]")?.dataset.goalId));

  view.addEventListener("click", event => {
    if (!mine()) return;
    const button = event.target.closest("[data-goal]");
    if (!button || button.matches("input")) return;
    const action = button.dataset.goal;
    const goal = goalOf(button);
    if (action === "mode") { goalsState.mode = button.dataset.mode; goalsState.key = null; render(); }
    else if (action === "retry") { goalsState.failed = null; render(); }
    else if (action === "prev") shift(-1);
    else if (action === "next") shift(1);
    else if (action === "open-period") {
      goalsState.year = Number(button.dataset.year);
      goalsState.mode = button.dataset.month ? "month" : "year";
      if (button.dataset.month) goalsState.month = Number(button.dataset.month);
      goalsState.key = null;
      render();
    } else if (action === "draft-kind") { goalsState.draft.kind = button.dataset.kind; keepDraft(); render(); }
    else if (action === "more") { goalsState.draft.more = !goalsState.draft.more; keepDraft(); render(); }
    else if (action === "kind" && goal) update(goal.id, { kind: goal.kind === "goal" ? "dream" : "goal" });
    else if (action === "up" && goal) move(goal.id, -1);
    else if (action === "down" && goal) move(goal.id, 1);
    else if (action === "edit" && goal) openEdit(goal);
  });
  const keepDraft = () => {
    const form = view.querySelector("[data-goal-form]");
    if (!form) return;
    Object.assign(goalsState.draft, { title: form.title.value, description: form.description.value, deadline: form.deadline.value });
  };
  view.addEventListener("input", event => { if (mine() && event.target.closest("[data-goal-form]")) keepDraft(); });
  view.addEventListener("change", event => {
    if (!mine()) return;
    const pick = event.target.dataset.goalPick;
    if (pick) { goalsState[pick] = Number(event.target.value); goalsState.key = null; render(); return; }
    if (event.target.dataset.goal === "done") {
      const goal = goalOf(event.target);
      if (goal) update(goal.id, { done: event.target.checked });
    }
  });
  view.addEventListener("submit", event => {
    if (!mine() || !event.target.matches("[data-goal-form]")) return;
    event.preventDefault();
    add(event.target);
  });
  view.addEventListener("keydown", event => {
    if (!mine()) return;
    const item = event.target.closest?.(".goal");
    if (!item || event.target !== item) return;
    const goal = goalOf(item);
    if (!goal) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); move(goal.id, event.key === "ArrowUp" ? -1 : 1); }
    else if (event.key === "Enter") { event.preventDefault(); openEdit(goal); }
  });

  // drag within the list (mouse); touch uses the arrows
  let dragged = null;
  view.addEventListener("dragstart", event => {
    const item = mine() && event.target.closest?.(".goal");
    if (!item) return;
    dragged = Number(item.dataset.goalId);
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(dragged));
  });
  view.addEventListener("dragover", event => {
    if (!dragged) return;
    const list = event.target.closest?.("[data-goal-list]");
    if (!list) return;
    event.preventDefault();
    const moving = list.querySelector(".goal.is-dragging");
    const after = [...list.querySelectorAll(".goal:not(.is-dragging)")].find(el => {
      const box = el.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (moving) list.insertBefore(moving, after || null);
  });
  view.addEventListener("drop", event => {
    if (!dragged || !event.target.closest?.("[data-goal-list]")) return;
    event.preventDefault();
    const list = view.querySelector("[data-goal-list]");
    const ids = [...list.querySelectorAll(".goal")].map(el => Number(el.dataset.goalId));
    list.querySelector(".is-dragging")?.classList.remove("is-dragging");
    dragged = null;
    if (ids.some((id, i) => id !== goalsState.items[i]?.id)) saveOrder(ids);
  });
  view.addEventListener("dragend", () => {
    if (!dragged) return;
    // released outside the list: back to the saved order
    dragged = null;
    render();
  });
}
