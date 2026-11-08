// Browser check of the interface size, priorities on cards and the timer (e2e/ui-run.sh … TEST=e2e/ui-scale-timer.mjs):
// 75% on computers, 70% on phones, "Rozmiar interfejsu" kept per device; P0/P1/P3 shown on the card; a started timer
// shows and ticks at once; a stopped or finished task keeps its time on the card.
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const api = (path, method = "GET", body) => fetch(BASE + path, { method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: body && JSON.stringify(body) }).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(500);
}
const rootPx = () => ev("parseFloat(getComputedStyle(document.documentElement).fontSize)");
try {
  const today = new Date().toISOString().slice(0, 10);
  const urgent = await api("/api/tasks", "POST", { title: "Pilne zadanie z priorytetem", date: today, priority: "P0" });
  const low = await api("/api/tasks", "POST", { title: "Kiedyś zrobić porządek", date: today, priority: "P3" });
  const plain = await api("/api/tasks", "POST", { title: "Zwykłe zadanie", date: today });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
  check("computers: the interface is at 75%", await rootPx() === 12, String(await rootPx()));
  check("P0 is shown on its card", await ev(`document.querySelector('.card[data-id="${urgent.id}"] .chip--p0')?.textContent === "Krytyczny"`));
  check("P3 is shown on its card", await ev(`document.querySelector('.card[data-id="${low.id}"] .chip--p3')?.textContent === "Niski"`));
  check("the default P2 adds no chip", await ev(`!document.querySelector('.card[data-id="${plain.id}"] .chip--priority')`));

  await click(`.card[data-id="${plain.id}"] [data-card="timer-start"]`); await sleep(1200);
  const first = await ev(`document.querySelector('.card[data-id="${plain.id}"] .timer.is-running')?.textContent.trim()`);
  check("a started timer shows at once", /^\d:\d\d$/.test(first || ""), first);
  await sleep(2200);
  const later = await ev(`document.querySelector('.card[data-id="${plain.id}"] .timer.is-running')?.textContent.trim()`);
  check("…and ticks every second", later && later !== first, `${first} → ${later}`);
  const dock = await ev(`(() => { const d = document.querySelector('.timer-dock');
    return { hidden: d.hidden, title: d.querySelector('strong')?.textContent, time: d.querySelector('.timer-dock__time')?.textContent.trim() }; })()`);
  check("the corner dock shows the task being worked on, ticking", !dock.hidden && dock.title === "Zwykłe zadanie" && /^\d:\d\d$/.test(dock.time || ""), JSON.stringify(dock));
  await click('.timer-dock__open'); await sleep(800);
  check("the dock opens the task", await ev(`document.querySelector('.drawer [data-field="title"]')?.value === "Zwykłe zadanie"`));
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(500);
  await click(`.card[data-id="${plain.id}"] [data-card="timer-stop"]`); await sleep(1200);
  const stopped = await ev(`document.querySelector('.card[data-id="${plain.id}"] .timer')?.textContent.trim()`);
  check("the dock goes away when the timer stops", await ev("document.querySelector('.timer-dock').hidden"));
  check("a stopped timer leaves its time on the card", /^\d+ s$/.test(stopped || ""), stopped);
  await api(`/api/tasks/${plain.id}`, "PATCH", { status: "done" });
  await ev("document.dispatchEvent(new Event('visibilitychange'))"); await sleep(1500);
  check("a finished task keeps its time on the card", await ev(`/\\d+ s/.test(document.querySelector('[data-drop="done"] .card[data-id="${plain.id}"] .timer')?.textContent || "")`));

  await click('[data-action="ui-scale"]');
  await ev(`(() => { const r = document.querySelector('dialog[open] input[value="1"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(300);
  check("Rozmiar interfejsu changes the size at once", await rootPx() === 16, String(await rootPx()));
  await send("Page.reload"); await sleep(3000);
  check("…and is kept on this device", await rootPx() === 16, String(await rootPx()));
  await ev("localStorage.removeItem('mytko-tasks:ui-scale')");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload"); await sleep(3000);
  check("phones: the interface is at 70%", Math.abs(await rootPx() - 11.2) < 0.01, String(await rootPx()));
  check("phones: no sideways page scroll", await ev("document.documentElement.scrollWidth <= innerWidth"), String(await ev("document.documentElement.scrollWidth")));
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
