// Porządek → "AI i Workflow" (owner only): is Mytko Workflow connected right now, turn the connection on/off;
// the AI on/off (any provider; off: nothing is sent to the AI, everything is done by hand) and how tasks reach the Workflow ToDo.
import { api } from "../api/client.js";
import { escapeHtml } from "../../vendor/mytko-kit/js/core.js";
import { icon } from "../../vendor/mytko-kit/js/icons.js";
import { reload, render, store } from "./app.js";
import { dialog } from "./dialogs.js";
import { toast } from "../../vendor/mytko-kit/js/ui.js";
import { LOCALE } from "../i18n.js";

const MODES = [
  ["manual", "Ręcznie", "Tylko przycisk na karcie i w szczegółach zadania."],
  ["suggest", "AI podpowiada", "AI oznacza zadania programistyczne w Praca, a Ty wysyłasz je jednym kliknięciem."],
  ["auto", "AI wysyła sama", "AI sama wysyła nowe zadania, co do których jest pewna. Każde możesz wycofać, a już podświetlone wyślesz przyciskiem."]
];

export function since(iso) {
  if (!iso) return "nigdy";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "przed chwilą";
  if (minutes < 60) return `${minutes} min temu`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} godz. temu`;
  return new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function workflowHtml(w) {
  const [tone, label] = !w.configured ? ["off", "Nie skonfigurowane"] : !w.enabled ? ["off", "Wyłączone"]
    : w.active ? ["ok", "Aktywne"] : ["idle", "Brak kontaktu"];
  return `<section class="settings-block">
    <header class="settings-block__head"><h3>${icon("layers", 20)}Mytko Workflow</h3><span class="status-pill status-pill--${tone}"><i></i>${label}</span></header>
    ${w.configured ? `<p class="muted">Workflow pyta Tasks co 2 minuty, gdy Fujitsu działa. Ostatni kontakt: <strong>${escapeHtml(since(w.lastPollAt))}</strong>.</p>
      <label class="switch"><input type="checkbox" data-set="workflowEnabled"${w.enabled ? " checked" : ""}><span class="switch__track"></span><span>Połączenie włączone</span></label>
      <p class="settings-block__note">Wyłączone: Workflow nie dostaje zadań i nie zmienia ich statusu, a przycisk wysyłania znika. Zadania w Workflow: <strong>${w.open}</strong>.</p>`
      : `<p class="muted">Na serwerze nie ustawiono tokenu Workflow (WORKFLOW_TOKEN_SHA256), więc połączenie jest niedostępne.</p>`}
  </section>`;
}

function aiHtml(a, workflowOn) {
  const [tone, label] = !a.configured ? ["off", "Brak klucza"] : !a.enabled ? ["off", "Wyłączone"] : a.pausedUntil ? ["idle", "Wstrzymane"] : ["ok", "Włączone"];
  const usable = a.configured && a.enabled;
  return `<section class="settings-block">
    <header class="settings-block__head"><h3>${icon("sparkles", 20)}AI</h3><span class="status-pill status-pill--${tone}"><i></i>${label}</span></header>
    ${a.configured ? `<p class="muted">Dostawca: <strong>${escapeHtml(a.label)}</strong>, model <span translate="no">${escapeHtml(a.model)}</span>.</p>
      <p class="muted">Wyłącz, gdy skończą się środki na API: nic nie trafi wtedy do AI (propozycje z maili, briefy, analiza zadań), a wszystko robisz ręcznie.</p>
      <label class="switch"><input type="checkbox" data-set="aiEnabled"${a.enabled ? " checked" : ""}><span class="switch__track"></span><span>AI włączone</span></label>`
      : `<p class="muted">Na serwerze nie ustawiono klucza AI (AI_API_KEY), więc funkcje AI są niedostępne.</p>`}
    <h4>Zadania do Mytko Workflow</h4>
    <div class="scale-options scale-options--described${usable && workflowOn ? "" : " is-disabled"}">${MODES.map(([value, title, text]) => `
      <label class="check"><input type="radio" name="workflowMode" value="${value}"${value === a.workflowMode ? " checked" : ""}${usable && workflowOn ? "" : " disabled"}>
        <span class="check__text"><strong>${title}</strong><small>${text}</small></span></label>`).join("")}</div>
    ${usable && workflowOn && a.workflowMode !== "manual" ? `<div class="settings-block__run">
      <p class="muted">Ostatnia analiza: ${escapeHtml(since(a.lastRunAt))} · do wysłania: ${a.suggested} · wysłane przez AI: ${a.sentByAi}</p>
      ${a.lastError ? `<p class="field-error">${escapeHtml(a.lastError)}${a.pausedUntil ? " <span>Analiza wstrzymana na 15 minut (zmiana ustawień wznawia ją od razu).</span>" : ""}</p>` : ""}
      <button type="button" class="btn btn--ghost btn--sm" data-set="scan">${icon("sparkles", 15)}Przeanalizuj teraz</button></div>` : ""}
    <p class="settings-block__note settings-block__note--icon">${icon("lock", 14)}<span>Tylko przestrzenie widoczne dla agentów (np. Praca). Prywatne zadania i konta innych osób nigdy nie trafiają do AI ani do Workflow.</span></p>
  </section>`;
}

export async function openAiSettings() {
  const element = dialog("dialog--manage dialog--settings", `<div class="dialog__body">
    <header class="dialog__head"><h2>AI i Workflow</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <div data-settings><p class="muted">Wczytuję…</p></div>
    <div class="dialog__actions"><button type="button" class="btn btn--primary" data-close>Gotowe</button></div>
  </div>`);
  const box = element.querySelector("[data-settings]");
  const show = () => {
    const s = store.settings;
    box.innerHTML = s ? workflowHtml(s.workflow) + aiHtml(s.ai, s.workflow.configured && s.workflow.enabled) : '<p class="field-error">Nie udało się wczytać ustawień.</p>';
  };
  const apply = async body => {
    try {
      store.settings = await api.updateSettings(body);
    } catch (error) {
      toast(error.message || "Nie udało się zapisać.", { tone: "error" });
    }
    show();
    render(); // the send buttons on the cards follow the settings
  };
  try { store.settings = await api.settings(); } catch { /* shown below */ }
  show();
  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    const scan = event.target.closest('[data-set="scan"]');
    if (!scan) return;
    scan.disabled = true;
    scan.textContent = "AI analizuje…";
    try {
      const result = await api.scanTasks();
      store.settings = result.settings;
      toast(`Sprawdzone zadania: ${result.checked}, wysłane do Workflow: ${result.sent}.`);
      await reload({ quiet: true }); // marks and sends show on the cards
    } catch (error) {
      toast(error.message || "Nie udało się.", { tone: "error" });
    }
    show();
  });
  element.addEventListener("change", event => {
    const input = event.target;
    if (input.dataset.set === "workflowEnabled" || input.dataset.set === "aiEnabled") apply({ [input.dataset.set]: input.checked });
    else if (input.name === "workflowMode") apply({ workflowMode: input.value });
  });
}
