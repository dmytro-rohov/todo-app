// Browser check of meetings (CALENDAR=1 e2e/ui-run.sh … TEST=e2e/ui-calendar.mjs): month and week show the fake
// Google's meetings, a meeting opens with its Meet link, a new meeting is created through the dialog.
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1672,941",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const api = path => fetch(BASE + path).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(500);
}
try {
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
  await send("Page.navigate", { url: BASE + "/#calendar" }); await sleep(3000);
  check("the month shows meetings of the connected calendar", await ev("[...document.querySelectorAll('.event--meeting')].some(e => e.textContent.includes('Spotkanie z leadem'))"));
  await click('[data-cal="mode"][data-mode="week"]'); await sleep(800);
  const week = await ev("(() => { const e = [...document.querySelectorAll('.week__event')].find(n => n.textContent.includes('Spotkanie z leadem')); return e && { top: e.style.top, h: e.style.height }; })()");
  check("the week places a 10:00–11:00 meeting at its hour", week?.top === "12rem" && week?.h === "3rem", JSON.stringify(week));
  await ev("[...document.querySelectorAll('.week__event')].find(n => n.textContent.includes('Spotkanie z leadem')).setAttribute('data-test', 'lead')");
  await click('.week__event[data-test="lead"]');
  check("a meeting opens with its Google Meet link and guests", await ev("Boolean(document.querySelector('dialog[open] .meet-join[href^=\"https://meet.google.com/\"]')) && document.querySelector('dialog[open] .guests').textContent.includes('Anna Róża')"));
  await ev("document.querySelector('dialog[open]').close()"); await sleep(300);
  const todayKey = new Date().toISOString().slice(0, 10);
  await click(`.week__slot[data-hour="16"][data-day="${todayKey}"]`); await sleep(400);
  await ev("(() => { const f = document.querySelector('dialog[open] form'); f.title.value = 'Rozmowa z nowym klientem'; f.attendees.value = 'nowy@klient.pl'; })()");
  await click('dialog[open] button[type="submit"]'); await sleep(1500);
  const today = new Date().toISOString().slice(0, 10);
  const created = (await api(`/api/calendar/events?from=${today}&to=${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}`)).find(e => e.title === "Rozmowa z nowym klientem");
  check("a meeting created from a free slot gets a Meet link and the guest", Boolean(created?.meetUrl) && created.attendees[0]?.email === "nowy@klient.pl" && new Date(created.startAt).getHours() === 16, JSON.stringify(created && { meet: created.meetUrl, h: new Date(created.startAt).getHours() }));
  check("the new meeting appears in the week", await ev("[...document.querySelectorAll('.week__event')].some(e => e.textContent.includes('Rozmowa z nowym klientem'))"));
  await click('[data-action="bell"]');
  check("today's meetings are in the notifications", await ev("document.querySelector('.popover').textContent.includes('Spotkania dziś')"));
  await ev("location.hash = 'manage-spaces'"); await sleep(1500);
  check("the Praca space shows its connected calendar", await ev("[...document.querySelectorAll('dialog[open] .cal-link')].some(r => r.textContent.includes('hello@mytko.dev'))"));
  check("the Prywatne space offers to connect one", await ev("[...document.querySelectorAll('dialog[open] [data-cal-action=connect]')].some(b => b.textContent.includes('Podłącz'))"));
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
