// Meeting brief: what was said (Gemini's notes from Poczta, or pasted notes) and the AI's brief: summary, decisions,
// open questions, the client's site brief (Website Factory's brief.json terms), proposed tasks and the next meeting.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { addDays, isoDay, STATUS_LABELS } from "./logic.js";
import { lookup, reload, store, upsertTask, workflowReady } from "./app.js";
import { dialog } from "./dialogs.js";
import { openDrawer } from "./drawer.js";
import { eventDay, eventTime, openMeeting } from "./meetings.js";
import { toast } from "./toast.js";

const items = list => (list?.length ? `<ul>${list.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p class="muted">—</p>');

function siteBriefHtml(site) {
  if (!site || !Object.keys(site).length) return "";
  const rows = [
    ["Firma", [site.business?.name, site.business?.industry, site.business?.city].filter(Boolean).join(" · ")],
    ["Kontakt", [site.business?.phone, site.business?.email].filter(Boolean).join(" · ")],
    ["Cel strony", site.goal], ["O firmie", site.about], ["Odbiorcy", site.audience],
    ["Oferta", (site.offer || []).map(o => [o.name, o.price].filter(Boolean).join(" — ")).join("; ")],
    ["Ton", (site.tone || []).join(", ")], ["Lubi", site.style?.likes], ["Nie lubi", site.style?.dislikes], ["Uwagi", site.notes]
  ].filter(([, value]) => value);
  return `<section class="brief__section"><h3>${icon("layers", 18)}Brief strony<button type="button" class="btn btn--ghost btn--sm" data-brief="copy">Kopiuj JSON (Website Factory)</button></h3>
    <dl class="brief__facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl></section>`;
}

function bodyHtml(brief) {
  const r = brief.result;
  const event = brief.event;
  const head = `<p class="brief__meta muted">${event ? `${escapeHtml(event.title)} · ${escapeHtml(eventDay(event))} ${escapeHtml(eventTime(event))}` : "Bez przypisanego spotkania"}
    · ${brief.source === "gemini-mail" ? "notatki Gemini z Poczty" : "wklejone notatki"}${brief.clientId && lookup.client(brief.clientId) ? ` · ${escapeHtml(lookup.client(brief.clientId).name)}` : ""}</p>`;
  const error = brief.error ? `<p class="field-error">${escapeHtml(brief.error)} ${brief.ai ? '<button type="button" class="btn btn--ghost btn--sm" data-brief="run">Spróbuj ponownie</button>' : ""}</p>` : "";
  const notes = `<details class="brief__notes"><summary>Notatki ze spotkania</summary><pre>${escapeHtml(brief.notes)}</pre></details>`;
  if (!r) {
    return `${head}${error}${brief.ai ? (brief.error ? "" : '<p class="muted">AI przygotowuje brief…</p>') : '<p class="muted">AI jest wyłączone albo nie jest skonfigurowane: zapisano same notatki.</p>'}${notes}`;
  }
  const next = r.nextMeeting?.needed ? `<section class="brief__section brief__next"><h3>${icon("calendar", 18)}Kolejne spotkanie</h3>
    <p><strong>${escapeHtml(r.nextMeeting.title)}</strong>${r.nextMeeting.date ? ` · ${escapeHtml(r.nextMeeting.date)}` : ""} · ${r.nextMeeting.durationMinutes} min</p>
    ${r.nextMeeting.agenda ? `<p class="muted">${escapeHtml(r.nextMeeting.agenda)}</p>` : ""}
    <button type="button" class="btn btn--primary btn--sm" data-brief="schedule">${icon("plus", 15)}Zaplanuj spotkanie</button></section>` : "";
  return `${head}${error}
    <section class="brief__section"><h3>${icon("note", 18)}Podsumowanie</h3><p>${escapeHtml(r.summary)}</p></section>
    <div class="brief__cols">
      <section class="brief__section"><h3>${icon("check", 18)}Ustalenia</h3>${items(r.decisions)}</section>
      <section class="brief__section"><h3>${icon("warning", 18)}Do dopytania</h3>${items(r.openQuestions)}</section>
    </div>
    ${siteBriefHtml(r.siteBrief)}
    <section class="brief__section"><h3>${icon("checkSquare", 18)}Proponowane zadania${r.tasks.length > 1 ? '<button type="button" class="btn btn--ghost btn--sm" data-brief="add-all">Dodaj wszystkie</button>' : ""}</h3>
      ${r.tasks.length ? `<ul class="mail-proposals">${r.tasks.map((t, i) => `<li><span><strong>${escapeHtml(t.title)}</strong>${t.description ? `<small class="muted">${escapeHtml(t.description)}</small>` : ""}
        <small class="muted">${t.priority}${t.dueDate ? ` · termin ${escapeHtml(t.dueDate)}` : ""}${t.coding ? ' · <span class="badge">kod → Workflow</span>' : ""}</small></span>
        <button type="button" class="btn btn--ghost btn--sm" data-brief-add="${i}">${icon("plus", 15)}Dodaj</button></li>`).join("")}</ul>` : '<p class="muted">Bez nowych zadań.</p>'}
      ${brief.tasks.length ? `<p class="muted brief__done">Zadania tego spotkania:</p><ul class="mail__tasks">${brief.tasks.map(t => `<li><button type="button" class="client-row" data-brief-task="${t.id}"><span>${escapeHtml(t.title)}</span><small class="muted">${STATUS_LABELS[t.status] || ""}</small></button></li>`).join("")}</ul>` : ""}
    </section>
    ${next}
    ${notes}
    ${brief.ai ? '<button type="button" class="btn btn--ghost btn--sm brief__rerun" data-brief="run">Przygotuj brief jeszcze raz</button>' : ""}`;
}

function pasteHtml(event, ai) {
  return `<p class="muted">${event ? `${escapeHtml(event.title)} · ${escapeHtml(eventDay(event))}` : ""}</p>
    <p>Notatki Gemini z Google Meet trafiają tu same (przez Pocztę). Z innego spotkania (Zoom, telefon, na żywo) wklej notatki lub transkrypcję:</p>
    <textarea class="textarea" name="notes" rows="10" maxlength="100000" placeholder="Notatki ze spotkania…"></textarea>
    <div class="dialog__actions"><button type="submit" class="btn btn--primary">${ai ? `${icon("target", 16)}Przygotuj brief (AI)` : "Zapisz notatki"}</button></div>`;
}

// { event } (a meeting; the newest brief of it, or the paste form) or { briefId }
export async function openBrief({ event = null, briefId = null } = {}) {
  const element = dialog("dialog--brief", `<form class="dialog__body" novalidate>
    <header class="dialog__head"><h2>Brief ze spotkania</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <div class="brief" aria-live="polite"><p class="muted">Wczytuję…</p></div></form>`);
  const form = element.querySelector("form");
  const box = element.querySelector(".brief");
  let brief = null;
  let ai = false;

  async function load(id) {
    brief = await api.brief(id);
    ai = brief.ai;
    box.innerHTML = bodyHtml(brief);
  }
  try {
    if (briefId) await load(briefId);
    else {
      const list = await api.briefs({ eventId: event.id });
      ai = list.ai;
      if (list.briefs[0]) await load(list.briefs[0].id);
      else box.innerHTML = pasteHtml(event, ai);
    }
  } catch (error) {
    box.innerHTML = `<p class="field-error">${escapeHtml(error.message || "Nie udało się wczytać briefu.")}</p>`;
  }

  // coding proposals go to the Mytko Workflow ToDo at once (when Praca is visible to agents)
  const work = () => store.spaces.find(s => s.key === "work");
  const taskBody = proposal => ({ title: proposal.title, date: isoDay(), description: proposal.description || "", priority: proposal.priority,
    dueDate: proposal.dueDate, spaceId: work()?.id ?? null, clientId: brief.clientId, meetingId: brief.eventId,
    workflow: proposal.coding && workflowReady() && Boolean(work()?.agentVisible) });

  element.addEventListener("click", async e => {
    if (e.target.closest("[data-close]")) return element.close();
    const task = e.target.closest("[data-brief-task]");
    if (task) { element.close(); return openDrawer(Number(task.dataset.briefTask)); }
    const add = e.target.closest("[data-brief-add]");
    const kind = e.target.closest("[data-brief]")?.dataset.brief;
    if (!add && !kind) return;
    try {
      if (add) {
        add.disabled = true;
        upsertTask(await api.createTask(taskBody(brief.result.tasks[Number(add.dataset.briefAdd)])));
        toast("Zadanie dodane.");
      }
      if (kind === "add-all") {
        for (const proposal of brief.result.tasks) upsertTask(await api.createTask(taskBody(proposal)));
        toast(`Dodano zadania: ${brief.result.tasks.length}.`);
      }
      if (kind === "run") {
        box.innerHTML = '<p class="muted">AI przygotowuje brief…</p>';
        brief = await api.runBrief(brief.id);
      }
      if (kind === "copy") {
        const json = JSON.stringify({ briefVersion: 1, language: "pl", ...brief.result.siteBrief }, null, 2);
        await navigator.clipboard.writeText(json).then(() => toast("Skopiowano brief strony (JSON)."), () => toast("Nie udało się skopiować.", { tone: "error" }));
        return;
      }
      if (kind === "schedule") {
        const next = brief.result.nextMeeting;
        const guests = (brief.event?.attendees || []).filter(a => !a.self).map(a => a.email);
        const client = lookup.client(brief.clientId);
        element.close();
        return openMeeting(null, { title: next.title, day: next.date || addDays(isoDay(), 7), clientId: brief.clientId,
          attendees: guests.length ? guests : client?.email ? [client.email] : [] });
      }
      if (brief.eventId) await reload({ quiet: true });
      await load(brief.id);
    } catch (error) {
      toast(error.message || "Nie udało się.", { tone: "error" });
      if (brief) await load(brief.id).catch(() => {});
    }
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const notes = form.notes?.value.trim() || "";
    if (notes.length < 20) return toast("Wklej notatki (co najmniej kilka zdań).", { tone: "error" });
    box.innerHTML = `<p class="muted">${ai ? "AI czyta notatki i przygotowuje brief… (do minuty)" : "Zapisuję…"}</p>`;
    try {
      brief = await api.createBrief({ eventId: event?.id ?? null, notes });
      box.innerHTML = bodyHtml(brief);
    } catch (error) {
      box.innerHTML = pasteHtml(event, ai);
      form.notes.value = notes;
      toast(error.message || "Nie udało się.", { tone: "error" });
    }
  });
}
