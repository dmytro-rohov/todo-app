// Browser check of Poczta (CALENDAR=1 MAIL=1 e2e/ui-run.sh … TEST=e2e/ui-mail.mjs): the inbox syncs from IMAP, a client's
// message is matched, opening marks it read, Claude's proposals become tasks, "Utwórz zadanie" handles the e-mail,
// a stranger becomes a lead, an invitation goes into the Praca calendar. SHOT=prefix saves screenshots.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async name => process.env.SHOT && writeFileSync(`${process.env.SHOT}-${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const headers = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const api = (path, method = "GET", body) => fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) }).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(500);
}
const openFrom = async name => { await ev(`[...document.querySelectorAll("[data-mail-open]")].find(b => b.textContent.includes(${JSON.stringify(name)}))?.setAttribute("data-test", "pick")`);
  await click('[data-test="pick"]'); await ev(`document.querySelector('[data-test="pick"]')?.removeAttribute("data-test")`); await sleep(1200); };
try {
  await api("/api/clients", "POST", { name: "Kwiaciarnia Róża", email: "anna@kwiaciarnia.pl" });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/#mail" }); await sleep(3500);
  check("the Poczta tab is shown to the owner", await ev("!document.querySelector('[data-view=\"mail\"]').hidden"));
  await click('[data-mail="sync"]'); await sleep(3000);
  check("the inbox syncs from IMAP", await ev("document.querySelectorAll('[data-mail-open]').length") === 3);
  check("unread messages are counted on the tab", await ev("document.querySelector('[data-view=\"mail\"] .count').textContent") === "3");
  check("the client's message carries the client chip", await ev("[...document.querySelectorAll('.mail-row')].find(r => r.textContent.includes('Anna Róża'))?.querySelector('.chip--client')?.textContent.includes('Kwiaciarnia')"));
  await openFrom("Anna Róża");
  check("the reader shows the text with a clickable link", await ev("document.querySelector('.mail__body')?.textContent.includes('do piątku') && document.querySelector('.mail__body a')?.href === 'https://kwiaciarnia.pl/oferta'"));
  check("opening marks it read", await ev("!document.querySelector('.mail-row.is-open').classList.contains('is-unread')"));
  await shot("reader");
  await click('[data-mail="suggest"]'); await sleep(2000);
  check("Claude's proposals are shown", await ev("document.querySelectorAll('.mail-proposals li').length") === 2);
  check("a coding task is marked for Workflow", await ev("document.querySelector('.mail-proposals').textContent.includes('kod → Workflow')"));
  await click("[data-mail-accept='0']"); await sleep(1500);
  check("an accepted proposal becomes a task linked to the e-mail", await ev("[...document.querySelectorAll('.mail__tasks [data-mail-task]')].some(b => b.textContent.includes('Przygotować wycenę sklepu'))"));
  await shot("proposals");
  await click('[data-mail="task"]'); await sleep(600);
  check("a task from the e-mail is prefilled", await ev("(() => { const f = document.querySelector('dialog[open] form'); return f.title.value === 'Wycena sklepu internetowego' && f.description.value.startsWith('E-mail od Anna Róża') && f.clientId.value !== ''; })()"));
  await click('dialog[open] button[type="submit"]'); await sleep(2000);
  check("creating it handles the e-mail", await ev("![...document.querySelectorAll('.mail-row')].some(r => r.textContent.includes('Anna Róża'))"));
  const tasks = (await api("/api/tasks")).filter(t => t.mailId);
  check("both tasks point to the e-mail", tasks.length === 2, String(tasks.length));
  await openFrom("Jan Nowak");
  await click('[data-mail="lead"]'); await sleep(1500);
  check("a stranger becomes a lead", await ev("document.querySelector('.mail__client .chip--client')?.textContent.includes('Jan Nowak')"));
  await openFrom("Agencja Partner");
  check("an invitation is recognised", await ev("document.querySelector('.mail-card--invite')?.textContent.includes('Warsztat UX')"));
  await click('[data-mail="invite"]'); await sleep(1500);
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  check("the invitation is in the Praca calendar", (await api(`/api/calendar/events?from=${from}&to=${to}`)).some(e => e.title === "Warsztat UX"));
  await click('[data-mail-view="handled"]'); await sleep(1200);
  check("handled messages have their own view", await ev("[...document.querySelectorAll('.mail-row')].some(r => r.textContent.includes('Anna Róża'))"));
  // Gemini's notes were handled by the sync and became the brief of today's meeting with the lead
  await openFrom("Gemini");
  check("Gemini's notes point to the brief", await ev("document.querySelector('[data-mail=\"brief\"]') && document.querySelector('.mail__reader').textContent.includes('przypisał je do spotkania')"));
  await click('[data-mail="brief"]'); await sleep(1500);
  check("the brief shows the summary, decisions and the site brief", await ev("(() => { const d = document.querySelector('dialog[open] .brief'); return d && d.textContent.includes('Kwiaciarnia chce sklepu') && d.textContent.includes('Płatności BLIK') && d.textContent.includes('Zamówienia bukietów online'); })()"));
  await shot("brief");
  await click('dialog[open] [data-brief="add-all"]'); await sleep(2000);
  check("all proposed tasks are added to the meeting", await ev("[...document.querySelectorAll('dialog[open] [data-brief-task]')].length") === 2);
  const meetingTasks = (await api("/api/tasks")).filter(t => t.meetingId && ["Przygotować makietę sklepu", "Wysłać wycenę"].includes(t.title));
  check("…linked to the meeting and its client", meetingTasks.length === 2 && meetingTasks.every(t => t.clientId), JSON.stringify(meetingTasks.map(t => [t.meetingId, t.clientId])));
  await click('dialog[open] [data-brief="schedule"]'); await sleep(800);
  check("the next meeting opens prefilled", await ev("(() => { const f = document.querySelector('dialog[open] form'); return f?.title.value === 'Prezentacja makiety sklepu' && f.attendees.value.includes('roza@kwiaciarnia.pl'); })()"));
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(300);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(1000);
  await ev(`document.querySelector('[data-mail="back"]')?.click()`); await sleep(400); // the phone shows the list or the reader
  await click('[data-mail-view="inbox"]'); await sleep(1200);
  check("phone: the five view tabs fit one row", await ev("new Set([...document.querySelectorAll('.tabs .tab:not([hidden])')].map(t => Math.round(t.getBoundingClientRect().top))).size") === 1);
  check("Poczta has its own head, without task filters", await ev("document.querySelector('.page-head h1').textContent === 'Poczta' && getComputedStyle(document.querySelector('.filters-toggle')).display === 'none'"));
  check("phone: the list fills the screen", await ev("document.querySelector('.mail__list').getBoundingClientRect().width > 300 && document.documentElement.scrollWidth <= 391"));
  await shot("phone-list");
  await openFrom("Jan Nowak");
  check("phone: the reader replaces the list, with a way back", await ev("getComputedStyle(document.querySelector('.mail__list')).display === 'none' && getComputedStyle(document.querySelector('.mail__back')).display !== 'none'"));
  await shot("phone-reader");
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
