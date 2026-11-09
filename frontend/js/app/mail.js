// Poczta (owner only): the mailbox (hello@, IMAP) as a list and a reader. From a message: a task (linked to it), a
// lead from the sender, the AI's proposed tasks, an invitation into the Praca calendar, a reply in the mail program.
// "Załatwione" hides a message here only; opening one marks it read on the server too.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { isoDay, STATUS_LABELS } from "./logic.js";
import { isMember, lookup, reload, render, store, upsertTask, workflowReady } from "./app.js";
import { openNewTask } from "./dialogs.js";
import { openDrawer } from "./drawer.js";
import { openClient } from "./clients.js";
import { calendarState } from "./meetings.js";
import { openBrief } from "./brief.js";
import { toast } from "./toast.js";
import { LOCALE } from "../i18n.js";

export const mailState = { data: null, view: "inbox", q: "", openId: null, message: null, busy: "" };

const VIEWS = [["inbox", "Skrzynka", "open"], ["clients", "Od klientów", "clients"], ["unread", "Nieprzeczytane", "unread"], ["handled", "Załatwione", null]];
const URL = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

const when = iso => {
  const date = new Date(iso);
  const today = isoDay() === isoDay(date);
  return today ? date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(LOCALE, { day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};
const full = iso => new Date(iso).toLocaleString(LOCALE, { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
// Plain text, escaped, with web links clickable (they open outside Tasks).
const bodyHtml = text => escapeHtml(text).replace(URL, url => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`);
const clientChip = id => {
  const client = lookup.client(id);
  return client ? `<span class="chip chip--client" data-c="${escapeHtml(client.color)}">${icon("user", 14)}${escapeHtml(client.name)}</span>` : "";
};
const unreadCount = () => mailState.data?.counts?.unread || 0;
export const mailAddress = () => mailState.data?.address || "";
export const mailBadge = () => (mailState.data?.configured ? unreadCount() : 0);

export async function loadMail({ quiet = true } = {}) {
  if (isMember()) return;
  try {
    mailState.data = await api.mail(mailState.view, mailState.q);
    render();
  } catch (error) {
    if (!quiet) toast(error.message || "Nie udało się wczytać poczty.", { tone: "error" });
  }
}

async function openMessage(id) {
  mailState.openId = id;
  mailState.message = null;
  render();
  try {
    mailState.message = await api.mailMessage(id);
    if (!mailState.message.seen) {
      api.mailSeen(id).catch(() => {});
      mailState.message.seen = true;
      const row = mailState.data?.messages.find(m => m.id === id);
      if (row && !row.seen) { row.seen = true; mailState.data.counts.unread = Math.max(0, unreadCount() - 1); }
    }
  } catch (error) {
    mailState.openId = null;
    toast(error.message || "Nie udało się otworzyć wiadomości.", { tone: "error" });
  }
  render();
}

export function showMail(id) {
  store.view = "mail";
  openMessage(id);
}

function listHtml(data) {
  const statusLine = data.status?.error
    ? `<span class="mail__status is-error">${icon("warning", 15)}${escapeHtml(data.status.error)}</span>`
    : `<span class="mail__status muted">${data.status?.lastSyncAt ? `Zsynchronizowano ${when(data.status.lastSyncAt)}` : "Pierwsza synchronizacja…"}</span>`;
  return `<div class="mail__list">
    <div class="mail__bar">
      <div class="mail__views" role="group" aria-label="Widok poczty">${VIEWS.map(([key, label, count]) => `<button type="button" class="chip chip--toggle-btn${mailState.view === key ? " is-active" : ""}" data-mail-view="${key}" aria-pressed="${mailState.view === key}">${label}${count && data.counts[count] ? ` <b>${data.counts[count]}</b>` : ""}</button>`).join("")}</div>
      <label class="mail__search">${icon("search", 16)}<span class="visually-hidden">Szukaj w poczcie</span><input type="search" data-mail-q value="${escapeHtml(mailState.q)}" placeholder="Szukaj w poczcie…"></label>
      <div class="mail__sync">${statusLine}<button type="button" class="btn btn--ghost btn--sm" data-mail="sync"${mailState.busy === "sync" ? " disabled" : ""}>${icon("undo", 15)}Odśwież</button></div>
    </div>
    <ul class="mail__rows">${data.messages.map(m => `
      <li><button type="button" class="mail-row${m.seen ? "" : " is-unread"}${mailState.openId === m.id ? " is-open" : ""}" data-mail-open="${m.id}">
        <span class="mail-row__from">${escapeHtml(m.fromName || m.fromAddress)}</span>
        <span class="mail-row__when">${when(m.sentAt)}</span>
        <span class="mail-row__subject">${escapeHtml(m.subject)}</span>
        <span class="mail-row__snippet">${escapeHtml(m.snippet)}</span>
        <span class="mail-row__meta">${clientChip(m.clientId)}${m.hasInvite ? `<i title="Zaproszenie">${icon("calendar", 15)}</i>` : ""}${m.hasAttachments ? `<i title="Załączniki">${icon("note", 15)}</i>` : ""}${m.taskCount ? `<i title="Zadania z tej wiadomości">${icon("checkSquare", 15)}${m.taskCount}</i>` : ""}</span>
      </button></li>`).join("") || `<li class="empty">${mailState.view === "handled" ? "Nic tu jeszcze nie ma." : "Brak wiadomości. Wszystko załatwione."}</li>`}</ul>
  </div>`;
}

function inviteHtml(invite) {
  if (!invite) return "";
  const start = invite.start.dateTime ? full(invite.start.dateTime) : new Date(`${invite.start.date}T12:00:00`).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "long" });
  const canAdd = invite.method !== "CANCEL" && calendarState.accounts.some(a => lookup.space(a.spaceId)?.key === "work");
  return `<section class="mail-card mail-card--invite">
    <h3>${icon("calendar", 18)}${invite.method === "CANCEL" ? "Odwołanie spotkania" : "Zaproszenie"}</h3>
    <p><strong>${escapeHtml(invite.title)}</strong><br><span class="muted">${escapeHtml(start)}${invite.location ? ` · ${escapeHtml(invite.location)}` : ""}${invite.organizer ? ` · od ${escapeHtml(invite.organizer)}` : ""}</span></p>
    <div class="mail-card__actions">
      ${invite.link ? `<a class="btn btn--ghost btn--sm" href="${escapeHtml(invite.link)}" target="_blank" rel="noopener noreferrer">${icon("users", 15)}Link do spotkania</a>` : ""}
      ${canAdd ? `<button type="button" class="btn btn--primary btn--sm" data-mail="invite"${mailState.busy === "invite" ? " disabled" : ""}>${icon("plus", 15)}Dodaj do kalendarza Praca</button>` : ""}
    </div>
  </section>`;
}

function suggestionHtml(m, ai) {
  const s = m.suggestion;
  if (!ai && !s) return "";
  if (!s) return `<button type="button" class="btn btn--ghost mail__ai" data-mail="suggest"${mailState.busy === "suggest" ? " disabled" : ""}>${icon("target", 16)}${mailState.busy === "suggest" ? "AI czyta wiadomość…" : "Zaproponuj zadania (AI)"}</button>`;
  return `<section class="mail-card mail-card--ai">
    <h3>${icon("target", 18)}AI proponuje${ai ? `<button type="button" class="btn btn--ghost btn--sm" data-mail="suggest"${mailState.busy === "suggest" ? " disabled" : ""}>Jeszcze raz</button>` : ""}</h3>
    <p>${escapeHtml(s.summary)}${s.needsReply ? ' <span class="badge badge--warn">czeka na odpowiedź</span>' : ""}</p>
    ${s.tasks.length ? `<ul class="mail-proposals">${s.tasks.map((t, i) => `<li>
      <span><strong>${escapeHtml(t.title)}</strong>${t.description ? `<small class="muted">${escapeHtml(t.description)}</small>` : ""}
        <small class="muted">${t.priority}${t.dueDate ? ` · termin ${escapeHtml(t.dueDate)}` : ""}${t.coding ? ' · <span class="badge">kod → Workflow</span>' : ""}</small></span>
      <button type="button" class="btn btn--ghost btn--sm" data-mail-accept="${i}">${icon("plus", 15)}Dodaj</button></li>`).join("")}</ul>`
      : '<p class="muted">Bez zadań do zrobienia.</p>'}
  </section>`;
}

function readerHtml(data) {
  if (!mailState.openId) return `<div class="mail__reader mail__reader--empty"><p class="muted">${icon("mail", 28)}<br>Wybierz wiadomość.</p></div>`;
  const m = mailState.message;
  if (!m) return '<div class="mail__reader"><p class="muted">Wczytuję wiadomość…</p></div>';
  const reply = `mailto:${encodeURIComponent(m.fromAddress)}?subject=${encodeURIComponent(/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`)}`;
  return `<article class="mail__reader">
    <button type="button" class="btn btn--ghost btn--sm mail__back" data-mail="back">${icon("arrowLeft", 16)}Wiadomości</button>
    <h2>${escapeHtml(m.subject)}</h2>
    <p class="mail__from"><strong>${escapeHtml(m.fromName || m.fromAddress)}</strong> <span class="muted">&lt;${escapeHtml(m.fromAddress)}&gt; · ${escapeHtml(full(m.sentAt))}</span></p>
    <div class="mail__client">${m.clientId ? `${clientChip(m.clientId)}<button type="button" class="btn btn--ghost btn--sm" data-mail="client-card">Karta klienta</button>`
      : `<button type="button" class="btn btn--ghost btn--sm" data-mail="lead">${icon("user", 15)}Nowy lead z nadawcy</button>`}
      <label class="select select--sm"><span class="visually-hidden">Klient</span><select data-mail-client><option value="">${m.clientId ? "Odepnij klienta" : "Przypisz klienta…"}</option>${store.clients.filter(c => c.status !== "archived").map(c => `<option value="${c.id}"${c.id === m.clientId ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>${icon("chevronDown", 15)}</label></div>
    <div class="mail__actions">
      <button type="button" class="btn btn--primary btn--sm" data-mail="task">${icon("plus", 15)}Utwórz zadanie</button>
      <a class="btn btn--ghost btn--sm" href="${escapeHtml(reply)}">${icon("edit", 15)}Odpowiedz</a>
      <button type="button" class="btn btn--ghost btn--sm" data-mail="handled">${icon(m.handledAt ? "undo" : "check", 15)}${m.handledAt ? "Przywróć do skrzynki" : "Załatwione"}</button>
    </div>
    ${m.tasks.length ? `<ul class="mail__tasks">${m.tasks.map(t => `<li><button type="button" class="client-row" data-mail-task="${t.id}"><span>${escapeHtml(t.title)}</span><small class="muted">${STATUS_LABELS[t.status] || ""}</small></button></li>`).join("")}</ul>` : ""}
    ${m.brief ? `<section class="mail-card mail-card--ai"><h3>${icon("note", 18)}Notatki ze spotkania → brief</h3>
      <p>${m.brief.eventId ? "Tasks przypisał je do spotkania i przygotował brief." : "Nie znaleziono spotkania: brief czeka bez przypisania."}</p>
      <div class="mail-card__actions"><button type="button" class="btn btn--primary btn--sm" data-mail="brief">Otwórz brief</button></div></section>` : ""}
    ${inviteHtml(m.invite)}
    ${suggestionHtml(m, data.ai)}
    <pre class="mail__body">${bodyHtml(m.bodyText)}</pre>
    ${m.attachments.length ? `<p class="mail__files muted">${icon("note", 15)}Załączniki (otwórz w programie pocztowym): ${m.attachments.map(a => escapeHtml(a.name)).join(", ")}</p>` : ""}
  </article>`;
}

export function renderMail() {
  const data = mailState.data;
  if (!data) return '<p class="empty">Wczytywanie poczty…</p>';
  if (!data.configured) {
    return `<div class="empty mail-off"><p>${icon("mail", 28)}</p><h2>Poczta nie jest podłączona</h2>
      <p class="muted">Tasks może pokazywać skrzynkę hello@mytko.dev (IMAP na OVH Zimbra): z wiadomości robisz zadania i leady, a AI podpowiada,
      co z nich wynika. Podłączenie to kilka ustawień na serwerze (MAIL_IMAP_HOST, MAIL_IMAP_USER, MAIL_IMAP_PASSWORD).</p></div>`;
  }
  return `<div class="mail${mailState.openId ? " is-reading" : ""}">${listHtml(data)}${readerHtml(data)}</div>`;
}

const taskDescription = m => `E-mail od ${m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}, ${full(m.sentAt)}: „${m.subject}”\n\n${m.bodyText.trim().slice(0, 1500)}`;
const workSpace = () => store.spaces.find(s => s.key === "work")?.id ?? null;
// Coding proposals go to the Mytko Workflow ToDo at once (Praca is visible to agents unless switched off).
const toWorkflow = proposal => proposal.coding && workflowReady() && Boolean(store.spaces.find(s => s.key === "work")?.agentVisible);

async function markHandled(m, handled, { quiet = false } = {}) {
  await api.mailUpdate(m.id, { handled });
  m.handledAt = handled ? new Date().toISOString() : null;
  if (!quiet) toast(handled ? "Oznaczono jako załatwione." : "Wraca do skrzynki.", handled ? { action: "Cofnij", onAction: () => markHandled(m, false) } : {});
  await loadMail();
}

async function act(kind, m) {
  if (kind === "back") { mailState.openId = null; mailState.message = null; return render(); }
  if (kind === "sync") {
    mailState.busy = "sync"; render();
    try {
      const result = await api.mailSync();
      if (result.error) toast(result.error, { tone: "error" });
      else if (result.added) toast(`Nowe wiadomości: ${result.added}.`);
    } finally { mailState.busy = ""; }
    return loadMail({ quiet: false });
  }
  if (!m) return;
  if (kind === "client-card") return openClient(m.clientId);
  if (kind === "brief") return openBrief({ briefId: m.brief.id });
  if (kind === "handled") return markHandled(m, !m.handledAt);
  if (kind === "task") {
    return openNewTask({ title: m.subject.slice(0, 100), description: taskDescription(m), clientId: m.clientId, mailId: m.id, spaceId: workSpace(),
      onCreated: async () => { await markHandled(m, true, { quiet: true }); toast("Zadanie dodane, e-mail załatwiony.", { action: "Cofnij załatwienie", onAction: () => markHandled(m, false) }); openMessage(m.id); } });
  }
  mailState.busy = kind; render();
  try {
    if (kind === "lead") {
      const { clientId } = await api.mailLead(m.id);
      await reload({ quiet: true });
      toast(`Lead „${lookup.client(clientId)?.name || ""}” dodany do Klientów.`);
    }
    if (kind === "suggest") await api.mailSuggest(m.id);
    if (kind === "invite") { await api.mailInvite(m.id); toast("Spotkanie dodane do kalendarza Praca."); }
  } catch (error) {
    toast(error.message || "Nie udało się.", { tone: "error" });
  } finally { mailState.busy = ""; }
  await Promise.all([loadMail(), openMessage(m.id)]);
}

export function bindMail(root) {
  const view = root.querySelector(".view");
  let searchTimer;
  view.addEventListener("click", async event => {
    if (view.dataset.view !== "mail") return;
    const m = mailState.message;
    const pick = event.target.closest("[data-mail-view]");
    if (pick) { mailState.view = pick.dataset.mailView; mailState.openId = null; mailState.message = null; return loadMail({ quiet: false }); }
    const open = event.target.closest("[data-mail-open]");
    if (open) return openMessage(Number(open.dataset.mailOpen));
    const task = event.target.closest("[data-mail-task]");
    if (task) return openDrawer(Number(task.dataset.mailTask));
    const accept = event.target.closest("[data-mail-accept]");
    if (accept && m?.suggestion) {
      const proposal = m.suggestion.tasks[Number(accept.dataset.mailAccept)];
      accept.disabled = true;
      try {
        const created = await api.createTask({ title: proposal.title, date: isoDay(), description: proposal.description || taskDescription(m).slice(0, 2000),
          priority: proposal.priority, dueDate: proposal.dueDate, spaceId: workSpace(), clientId: m.clientId, mailId: m.id, workflow: toWorkflow(proposal) });
        upsertTask(created);
        toast(`Dodano „${created.title}”${created.workflowRequestedAt ? " i wysłano do Workflow" : ""}.`, { action: "Otwórz", onAction: () => openDrawer(created.id) });
        await openMessage(m.id);
      } catch (error) { accept.disabled = false; toast(error.message || "Nie udało się dodać zadania.", { tone: "error" }); }
      return;
    }
    const button = event.target.closest("[data-mail]");
    if (button) await act(button.dataset.mail, m);
  });
  view.addEventListener("change", async event => {
    if (view.dataset.view !== "mail" || !event.target.matches("[data-mail-client]")) return;
    const m = mailState.message;
    try {
      await api.mailUpdate(m.id, { clientId: Number(event.target.value) || null });
      await Promise.all([loadMail(), openMessage(m.id)]);
    } catch (error) { toast(error.message || "Nie udało się.", { tone: "error" }); }
  });
  view.addEventListener("input", event => {
    if (view.dataset.view !== "mail" || !event.target.matches("[data-mail-q]")) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      mailState.q = event.target.value.trim();
      await loadMail();
      const input = view.querySelector("[data-mail-q]");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 250);
  });
  // New mail arrives every few minutes on the server; the open list follows.
  setInterval(() => { if (store.view === "mail" && document.visibilityState === "visible" && !mailState.busy) loadMail(); }, 60000);
}

