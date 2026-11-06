// Archive view: finished tasks the retention job moved off the board, with when each will be deleted.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { inScope } from "./logic.js";
import { context, reload, render, store } from "./app.js";
import { chipsHtml } from "./board.js";
import { confirmDialog } from "./dialogs.js";
import { toast } from "./toast.js";

const DAY_MS = 86400000;

function day(value) {
  return new Date(value).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

function deletionText(task) {
  if (!task.deleteAt) return '<span class="muted">Zostaje w archiwum</span>';
  const days = Math.max(0, Math.ceil((new Date(task.deleteAt) - Date.now()) / DAY_MS));
  return `<span class="${days <= 2 ? "due due--overdue" : "due"}">${icon("trash", 16)}${days ? `za ${days} ${days === 1 ? "dzień" : "dni"}` : "dziś"}</span>`;
}

function rowHtml(task) {
  return `<li class="row row--archived" data-id="${task.id}">
    <span class="row__status">${icon("checkCircle", 22)}</span>
    <span class="row__main"><span class="row__title">${escapeHtml(task.title)}</span>${chipsHtml(task)}</span>
    <span class="row__when muted">${task.completedAt ? `Zakończone ${day(task.completedAt)}` : `Archiwum od ${day(task.archivedAt)}`}</span>
    <span class="row__due">${deletionText(task)}</span>
    <span class="row__actions">
      <button type="button" class="btn btn--ghost btn--sm" data-arch="restore">${icon("undo", 16)}Przywróć</button>
      <button type="button" class="icon-btn" data-arch="delete" aria-label="Usuń teraz: ${escapeHtml(task.title)}" title="Usuń teraz">${icon("trash", 18)}</button>
    </span>
  </li>`;
}

export function retentionNote() {
  const s = store.archive?.settings;
  if (!s || !s.archiveDays) return "";
  return `Zakończone dłużej niż ${s.archiveDays} dni trafiają do Archiwum.`;
}

export function renderArchive() {
  if (!store.archive) return '<p class="empty">Wczytywanie archiwum…</p>';
  const { settings } = store.archive;
  const ctx = context();
  const tasks = store.archive.tasks.filter(task => inScope(task, store.filters, ctx));
  const isPrivate = task => (task.spaceId ?? ctx.privateSpaceId) === ctx.privateSpaceId;
  const groups = [
    ["Prywatne", tasks.filter(isPrivate), settings.deletePrivateDays],
    ["Praca i klienci", tasks.filter(t => !isPrivate(t)), settings.deleteWorkDays]
  ].filter(([, list]) => list.length);
  const rule = days => days ? `usuwane na zawsze po ${days} dniach w archiwum` : "nie są usuwane";
  return `<div class="list archive">
    <p class="archive__rules">${icon("history", 18)}<span>Zakończone zadania trafiają tu po ${settings.archiveDays || "—"} dniach.
      Prywatne są ${rule(settings.deletePrivateDays)}, praca i projekty klientów ${rule(settings.deleteWorkDays)} — razem z notatkami, podzadaniami i historią.</span></p>
    ${groups.length ? groups.map(([title, list, days]) => `
      <section class="list__group list__group--archive">
        <h2>${icon(title === "Prywatne" ? "user" : "folder", 20)}${title}<span class="count">${list.length}</span><small class="muted">${rule(days)}</small></h2>
        <ul>${list.map(rowHtml).join("")}</ul>
      </section>`).join("") : '<p class="empty">Archiwum jest puste.</p>'}
  </div>`;
}

export async function loadArchive() {
  try {
    store.archive = await api.archive();
    render();
  } catch { /* the board works without it */ }
}

export function bindArchive(root) {
  const view = root.querySelector(".view");
  view.addEventListener("click", async event => {
    if (view.dataset.view !== "archive") return;
    const button = event.target.closest("[data-arch]");
    if (!button) return;
    const id = Number(button.closest("[data-id]").dataset.id);
    const task = store.archive.tasks.find(t => t.id === id);
    try {
      if (button.dataset.arch === "restore") {
        await api.restore(id);
        toast(`„${task.title}” wraca do ToDo.`);
      } else {
        if (!(await confirmDialog(`Usunąć na zawsze „${task.title}” razem z notatkami i historią?`, "Usuń"))) return;
        await api.deleteTask(id);
        toast("Zadanie usunięte na zawsze.");
      }
    } catch (error) {
      toast(error.message || "Nie udało się.", { tone: "error" });
    }
    await Promise.all([loadArchive(), reload({ quiet: true })]);
  });
}
