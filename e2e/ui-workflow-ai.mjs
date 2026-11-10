// Browser check of sending tasks to the Mytko Workflow ToDo and of Porządek → "AI i Workflow"
// (e2e/ui-run.sh … app with AI=1 TEST=e2e/ui-workflow-ai.mjs; SHOTS=/dir saves screenshots):
// the send button on cards in Praca (never Prywatne), the connection state and switch, AI on/off and its modes
// (suggest: the button lights up with Claude's reason; auto: Claude sends coding work itself).
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const TOKEN = "workflow-test-token-0123456789";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const api = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: body && JSON.stringify(body) }).then(r => r.json());
const poll = () => fetch(`${BASE}/api/agent/workflow/tasks`, { headers: { authorization: `Bearer ${TOKEN}` } }).then(r => r.status);
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(700);
}
const shot = async name => { if (!process.env.SHOTS) return;
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  (await import("node:fs")).writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(result.data, "base64")); };
const card = id => `.card[data-id="${id}"]`;
const pill = n => ev(`document.querySelectorAll('dialog[open] .status-pill')[${n}]?.textContent.trim()`);
const openSettings = async () => { await click('[data-action="ai-settings"]'); await sleep(800); };
const closeSettings = () => ev(`document.querySelector('dialog[open]')?.close()`);
try {
  const today = new Date().toISOString().slice(0, 10);
  const spaces = await api("/api/spaces");
  const work = spaces.find(s => s.key === "work"), priv = spaces.find(s => s.key === "private");
  const code = await api("/api/tasks", "POST", { title: "Poprawić formularz kontaktowy na stronie", date: today, spaceId: work.id });
  const phone = await api("/api/tasks", "POST", { title: "Zadzwonić do księgowej", date: today, spaceId: work.id });
  const home = await api("/api/tasks", "POST", { title: "Kupić prezent dla mamy", date: today, spaceId: priv.id });
  const created = Date.now();
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.enable");
  // e2e checks the Polish texts: a fresh test profile starts in Polish (Ukrainian is the default on a new device)
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { if (localStorage.getItem('mytko-tasks:lang') === null) localStorage.setItem('mytko-tasks:lang', 'pl'); } catch {}" });
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);

  // manual: the button on cards in Praca only
  check("a task in Praca has the “to Workflow” button", Boolean(await ev(`document.querySelector('${card(phone.id)} [data-card="workflow"]')`)));
  check("a private task has none", !(await ev(`document.querySelector('${card(home.id)} [data-card="workflow"]')`)));
  await shot("workflow-cards");
  await click(`${card(phone.id)} [data-card="workflow"]`); await sleep(500);
  const sent = (await api("/api/tasks")).find(t => t.id === phone.id);
  check("one click sends it to the Workflow ToDo", Boolean(sent.workflowRequestedAt) && sent.workflowRequestedBy === "owner", sent.workflowStatus);
  check("…the card shows it waits for Workflow and the button is gone",
    (await ev(`document.querySelector('${card(phone.id)} .chip--workflow')?.textContent.trim()`)) === "Czeka na Workflow"
    && !(await ev(`document.querySelector('${card(phone.id)} [data-card="workflow"]')`)));
  check("…with “Cofnij” in the message", /Cofnij/.test(await ev(`document.querySelector('.toasts')?.textContent || ""`)));
  await api(`/api/tasks/${phone.id}`, "PATCH", { workflow: false });

  // the connection: state and switch
  await openSettings();
  check("before Workflow asks: no contact", await pill(0) === "Brak kontaktu", await pill(0));
  await closeSettings();
  check("Workflow's poll is accepted", await poll() === 200);
  await openSettings();
  check("after its poll: active, with the time of the last contact", await pill(0) === "Aktywne"
    && /przed chwilą/.test(await ev(`document.querySelector('dialog[open] .settings-block')?.textContent`)), await pill(0));
  check("AI is configured and on", await pill(1) === "Włączone", await pill(1));
  const provider = await ev(`document.querySelectorAll('dialog[open] .settings-block')[1]?.textContent.replace(/\\s+/g, " ")`);
  check("…with its provider and model", provider.includes(process.env.AI_PROVIDER === "openai" ? "Dostawca: OpenAI, model fake-model" : "Dostawca: Claude (Anthropic), model claude-sonnet-5-5"), provider.slice(0, 140));
  await shot("workflow-settings");
  await click('dialog[open] [data-set="workflowEnabled"] + .switch__track'); await sleep(600);
  check("turning the connection off: shown as off", await pill(0) === "Wyłączone", await pill(0));
  check("…Workflow is refused", await poll() === 503);
  await closeSettings(); await sleep(300);
  check("…and the send buttons disappear", !(await ev(`document.querySelector('[data-card="workflow"]')`)));
  await openSettings();
  await click('dialog[open] [data-set="workflowEnabled"] + .switch__track'); await sleep(600);
  check("turning it back on", await pill(0) !== "Wyłączone" && await poll() === 200);

  // AI suggests: the routing looks only at tasks untouched for 20 s
  await click('dialog[open] [name="workflowMode"][value="suggest"]'); await sleep(600);
  await sleep(Math.max(0, created + 21000 - Date.now()));
  await click('dialog[open] [data-set="scan"]'); await sleep(1500);
  await closeSettings(); await sleep(500);
  check("AI suggests: the coding task's button is lit with Claude's reason",
    await ev(`(() => { const b = document.querySelector('${card(code.id)} [data-card="workflow"]'); return !!b && b.classList.contains('is-suggested') && /Zmiana w kodzie strony/.test(b.title); })()`));
  check("…the phone call is not marked", !(await ev(`document.querySelector('${card(phone.id)} [data-card="workflow"]')?.classList.contains('is-suggested')`)));
  check("…and nothing was sent", !(await api("/api/tasks")).find(t => t.id === code.id).workflowRequestedAt);
  await shot("workflow-suggested");

  // AI sends by itself
  const deploy = await api("/api/tasks", "POST", { title: "Wdrożyć nową stronę główną", date: today, spaceId: work.id });
  const deployAt = Date.now();
  await openSettings();
  await click('dialog[open] [name="workflowMode"][value="auto"]'); await sleep(600);
  await sleep(Math.max(0, deployAt + 21000 - Date.now()));
  await click('dialog[open] [data-set="scan"]'); await sleep(1500);
  await closeSettings(); await sleep(500);
  const auto = (await api("/api/tasks")).find(t => t.id === deploy.id);
  check("AI sends coding work itself, marked as sent by AI", Boolean(auto.workflowRequestedAt) && auto.workflowRequestedBy === "ai", JSON.stringify([auto.workflowStatus, auto.workflowRequestedBy]));
  check("…the card says “AI → Workflow”", (await ev(`document.querySelector('${card(deploy.id)} .chip--workflow')?.textContent.trim()`)) === "AI → Workflow");
  await click(card(deploy.id) + " .card__title"); await sleep(900);
  check("…the task panel shows why", /Wysłane przez AI · Zmiana w kodzie strony/.test(await ev(`document.querySelector('.workflow-cell')?.textContent || ""`)));
  await shot("workflow-ai-drawer");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(500);

  // AI off: nothing to choose, nothing sent to Claude
  await openSettings();
  await click('dialog[open] [data-set="aiEnabled"] + .switch__track'); await sleep(600);
  check("AI off: shown as off, the modes are disabled and there is no analysis", await pill(1) === "Wyłączone"
    && await ev(`[...document.querySelectorAll('dialog[open] [name="workflowMode"]')].every(i => i.disabled)`) && !(await ev(`document.querySelector('dialog[open] [data-set="scan"]')`)));
  check("…the API refuses to analyse", (await fetch(`${BASE}/api/settings/ai/scan`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: "{}" })).status === 409);
  await click('dialog[open] [data-set="aiEnabled"] + .switch__track'); await sleep(600);
  await click('dialog[open] [name="workflowMode"][value="manual"]'); await sleep(600);
  await closeSettings();

  // phone: the dialog fits
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload"); await sleep(3500);
  await ev(`document.querySelector('[data-action="ai-settings"]').click()`); await sleep(1000);
  const fit = await ev(`({ page: document.documentElement.scrollWidth, dialog: document.querySelector('dialog[open]')?.getBoundingClientRect().right, view: innerWidth })`);
  check("on a phone the dialog fits the screen", fit.page <= fit.view && fit.dialog <= fit.view, JSON.stringify(fit));
  await shot("workflow-settings-phone");
  check("no script errors", errors.length === 0, errors.join(" | "));
} catch (error) { check("run", false, error.stack); } finally { chrome.kill(); }
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
