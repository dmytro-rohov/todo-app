// Browser check of the Mytko Workflow ToDo link (e2e/ui-run.sh … TEST=e2e/ui-workflow.mjs): a task is sent from its
// panel, Workflow (here: calls with the test token) takes it and reports progress, the board follows; withdrawing;
// a private task cannot be sent.
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
const workflow = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body: body && JSON.stringify(body) }).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(500);
}
try {
  const spaces = await api("/api/spaces");
  const task = await api("/api/tasks", "POST", { title: "Wdrożyć formularz rezerwacji na mytko.dev", date: new Date().toISOString().slice(0, 10), spaceId: spaces.find(s => s.key === "work").id });
  const own = await api("/api/tasks", "POST", { title: "Kupić prezent", date: new Date().toISOString().slice(0, 10), spaceId: spaces.find(s => s.key === "private").id });
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
  await send("Page.navigate", { url: `${BASE}/#task-${own.id}` }); await sleep(3500);
  check("a private task cannot be sent", await ev("document.querySelector('.workflow-cell')?.textContent.includes('nie jest widoczna dla agentów') && !document.querySelector('[data-d=\"workflow-on\"]')"));
  await send("Page.navigate", { url: `${BASE}/#task-${task.id}` }); await sleep(3500);
  await click('[data-d="workflow-on"]'); await sleep(1200);
  check("the panel sends the task and says it waits for Workflow", await ev("document.querySelector('.workflow-cell').textContent.includes('Czeka na Workflow') && Boolean(document.querySelector('[data-d=\"workflow-off\"]'))"));
  check("the card carries the Workflow chip", await ev(`document.querySelector('.card[data-id="${task.id}"] .chip--workflow')?.textContent === 'Czeka na Workflow'`));
  const queue = (await workflow("/api/agent/workflow/tasks")).tasks;
  check("Workflow's queue has it", queue.some(t => t.id === task.id && t.requested && t.space === "Praca"));
  // Workflow takes the task (only links it), then reports progress, which moves the card
  await workflow(`/api/agent/workflow/tasks/${task.id}`, "POST", { status: "todo", ref: "todo-42", url: "https://workflow.example/todos/todo-42" });
  await workflow(`/api/agent/workflow/tasks/${task.id}`, "POST", { status: "in_progress" });
  await ev("document.dispatchEvent(new Event('visibilitychange'))"); await sleep(1500);
  await send("Page.navigate", { url: `${BASE}/#task-${task.id}` }); await sleep(3500);
  check("Workflow's progress moves the card", await ev(`document.querySelector('[data-drop="in_progress"] .card[data-id="${task.id}"] .chip--workflow')?.textContent === 'Workflow: w realizacji'`));
  check("the panel links to the item in Workflow", await ev("document.querySelector('.workflow-cell a')?.href === 'https://workflow.example/todos/todo-42'"));
  await click('[data-d="workflow-off"]'); await sleep(1200);
  check("withdrawing is shown and passed to Workflow", await ev("document.querySelector('.workflow-cell').textContent.includes('Wycofane z Workflow')")
    && (await workflow("/api/agent/workflow/tasks")).tasks.find(t => t.id === task.id)?.requested === false);
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
