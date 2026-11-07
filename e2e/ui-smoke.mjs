// Browser interaction smoke test for the Tasks UI (board, drag and drop, dialogs, details, search, views).
import { spawn } from "node:child_process";
// Usage: TASKS_URL=http://127.0.0.1:3197 node e2e/ui-smoke.mjs  (an AUTH_DISABLED dev instance seeded by e2e/ui-seed.sh;
// needs google-chrome). Drives a real headless Chrome over the DevTools Protocol, no extra packages.
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333",
  "--window-size=1672,941", "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = [];
const results = [];
function check(name, ok, detail = "") { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }
function send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; }
const api = path => fetch(BASE + path).then(r => r.json());
async function center(selector, scroll = true) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (${scroll}) el?.scrollIntoView({ block: "center", inline: "center" }); const r = el?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); }
async function mouse(type, x, y) { await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "mouse" }); }
async function click(selector) {
  const p = await center(selector); if (!p) throw new Error(`no ${selector}`);
  const hit = await evaluate(`(() => { const e = document.elementFromPoint(${p.x}, ${p.y}); return e ? (e.closest('[class]')?.className?.baseVal ?? e.closest('[class]')?.className) + ' @' + ${Math.round(p.y)} + ' scrollY=' + scrollY : 'none'; })()`);
  if (process.env.DEBUG) console.log(`  click ${selector} -> ${hit}`);
  await mouse("mousePressed", p.x, p.y); await mouse("mouseReleased", p.x, p.y); await sleep(400);
}
async function type(text) { await send("Input.insertText", { text }); }
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text); });
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Page.navigate", { url: BASE + "/#board" }); await sleep(2500);
  const pwa = await evaluate("(async () => { const reg = await navigator.serviceWorker.ready; const m = await fetch('/manifest.webmanifest'); return { active: Boolean(reg.active), scope: reg.scope, type: m.headers.get('content-type'), name: (await m.json()).name }; })()");
  check("installable app: manifest served and the service worker active", pwa?.active && pwa.scope === BASE + "/" && /manifest\+json/.test(pwa.type) && pwa.name === "Mytko Tasks", JSON.stringify(pwa));
  // collapsible sidebar: a rail of icons, remembered after a reload
  await click('[data-action="sidebar-collapse"]'); await sleep(400);
  check("the sidebar collapses to a rail", await evaluate("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)") === 76);
  await send("Page.reload"); await sleep(2500);
  check("the collapsed sidebar is remembered", await evaluate("document.querySelector('#app').classList.contains('sidebar-collapsed')"));
  await click('[data-action="sidebar-collapse"]'); await sleep(400);
  check("the sidebar never scrolls sideways", await evaluate("(() => { const s = document.querySelector('.sidebar'); return s.scrollWidth <= s.clientWidth; })()"));
  check("board renders 5 columns", await evaluate("document.querySelectorAll('.column').length") === 5);
  const layout = await evaluate("(() => { const b = document.querySelector('.board').getBoundingClientRect(); const cols = [...document.querySelectorAll('.column')].map(c => c.getBoundingClientRect()); return { visible: cols.filter(c => c.right <= b.right + 1).length, planLeft: Math.round(cols[4].left), boardRight: Math.round(b.right) }; })()");
  check("four columns fill the board and long-term plans wait to the right", layout.visible === 4 && layout.planLeft >= layout.boardRight, JSON.stringify(layout));
  await click("[data-card=peek]"); await sleep(900);
  check("the Plany button scrolls to the fifth column and then hides", await evaluate("(() => { const b = document.querySelector('.board').getBoundingClientRect(); const p = document.querySelector('.column--planned').getBoundingClientRect(); return p.right <= b.right + 2 && getComputedStyle(document.querySelector('[data-card=peek]')).display === 'none' && getComputedStyle(document.querySelector('[data-card=peek-back]')).display !== 'none'; })()"));
  await evaluate("document.querySelector('.board').scrollLeft = 0"); await sleep(300);

  // 1. drag a ToDo card into Needs review, before its first card
  const title = "Zoptymalizować obrazy na stronie usług";
  const id = (await api("/api/tasks")).find(t => t.title === title).id;
  const from = await center(`.card[data-id="${id}"] .card__title`, false);
  const to = await center(`.column--needs_review .card:first-child`, false);
  await mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= 12; i++) await mouse("mouseMoved", from.x + (to.x - from.x) * i / 12, from.y + (to.y - 30 - from.y) * i / 12);
  await mouse("mouseReleased", to.x, to.y - 30); await sleep(1500);
  const moved = (await api("/api/tasks")).find(t => t.id === id);
  const reviewOrder = (await api("/api/tasks")).filter(t => t.status === "needs_review").sort((a, b) => a.position - b.position).map(t => t.id);
  check("drag and drop moves the card to Needs review, at the drop position", moved.status === "needs_review" && reviewOrder[0] === id, `status=${moved.status} order=${reviewOrder}`);
  check("an undo notice is offered", await evaluate("[...document.querySelectorAll('.toast button')].some(b => b.textContent === 'Cofnij')"));
  await click(".toast button"); await sleep(1200);
  check("undo puts it back", (await api("/api/tasks")).find(t => t.id === id).status === "todo" && (await api("/api/tasks")).filter(t => t.status === "needs_review").length === 3);

  // 2. play on a ToDo card starts work
  const todo = (await api("/api/tasks")).find(t => t.status === "todo" && t.title.startsWith("Dodać metadane"));
  await click(`.card[data-id="${todo.id}"] [data-card="timer-start"]`); await sleep(800);
  const started = (await api("/api/tasks")).find(t => t.id === todo.id);
  check("play starts the timer and moves the task to W realizacji", started.status === "in_progress" && Boolean(started.timerStartedAt));

  const other = (await api("/api/tasks")).find(t => t.status === "todo" && t.id !== todo.id);
  await click(`.card[data-id="${other.id}"] [data-card="timer-start"]`); await sleep(1000);
  check("starting another timer stops the first one on the board", await evaluate(`!document.querySelector('.card[data-id="${todo.id}"] .timer.is-running') && Boolean(document.querySelector('.card[data-id="${other.id}"] .timer.is-running, .card[data-id="${other.id}"] [data-card="timer-stop"]'))`));

  // 2b. a plan created from the dialog goes to the fifth column with a goal, and "→ ToDo" brings it in
  await click('[data-action="new-task"]');
  await click('dialog input[name="title"]'); await type("Nauczyć się latać szybowcem");
  await evaluate("(() => { const s = document.querySelector('dialog select[name=status]'); s.value = 'planned'; s.dispatchEvent(new Event('change')); })()");
  await click('dialog [data-years="2"]');
  await click('dialog button[type="submit"]'); await sleep(1000);
  const plan = (await api("/api/tasks")).find(t => t.title === "Nauczyć się latać szybowcem");
  check("a long-term plan with a goal in 2 years", plan?.status === "planned" && plan.dueDate?.slice(0, 4) === String(new Date().getFullYear() + 2), JSON.stringify(plan && { s: plan.status, d: plan.dueDate }));
  check("plans do not count as open work", await evaluate("Number(document.querySelector('[data-quick=all] strong').textContent)") === (await api("/api/tasks")).filter(t => !["done", "planned"].includes(t.status)).length);
  await click(`.card[data-id="${plan.id}"] [data-card="to-todo"]`); await sleep(1200);
  check("→ ToDo moves a plan onto the board", (await api("/api/tasks")).find(t => t.id === plan.id).status === "todo");
  check("the board stays scrolled where the reader is after an update", await evaluate("document.querySelector('.board').scrollLeft") > 0);
  await evaluate("document.querySelector('.board').scrollLeft = 0"); await sleep(300);

  // 3. new task dialog
  await click('[data-action="new-task"]');
  await click('dialog input[name="title"]'); await type("Zadanie z testu przeglądarki");
  await evaluate("document.querySelector('dialog select[name=status]').value='needs_review'");
  await click('dialog button[type="submit"]'); await sleep(1000);
  const created = (await api("/api/tasks")).find(t => t.title === "Zadanie z testu przeglądarki");
  check("new task dialog creates the task in the chosen column", created?.status === "needs_review");
  check("the new card is on the board", await evaluate(`Boolean(document.querySelector('.column--needs_review .card[data-id="${created?.id}"]'))`));

  // 4. drawer: rename and add a note
  await click(`.card[data-id="${created.id}"] .card__title`); await sleep(600);
  check("clicking a card opens its details", await evaluate("!document.querySelector('.drawer').hidden"));
  await evaluate("(() => { const t = document.querySelector('.drawer__title'); t.focus(); t.select(); })()");
  await type("Zmieniony tytuł z panelu");
  await evaluate("document.querySelector('.drawer__title').blur()"); await sleep(900);
  check("title edits save on blur", (await api("/api/tasks")).find(t => t.id === created.id).title === "Zmieniony tytuł z panelu");
  await click('.drawer [data-form="note"] textarea'); await type("Notatka z testu");
  await click('.drawer [data-form="note"] button[type="submit"]'); await sleep(900);
  const notes = await api(`/api/tasks/${created.id}/notes`);
  check("notes are added from the panel", notes[0]?.body === "Notatka z testu");
  check("history lists the rename", (await api(`/api/tasks/${created.id}/history`)).some(h => h.field === "title"));
  await click('.drawer [data-form="subtask"] input'); await type("Podzadanie z testu");
  await click('.drawer [data-form="subtask"] button[type="submit"]'); await sleep(900);
  await click('.drawer [data-form="note"] textarea'); await type("Szkic, jeszcze nie zapisany");
  await click('.drawer .subtasks input[type="checkbox"]'); await sleep(1200);
  check("a note draft survives other changes in the panel", await evaluate("document.querySelector('.drawer [data-form=\"note\"] textarea').value") === "Szkic, jeszcze nie zapisany");
  check("the subtask was ticked", (await api(`/api/tasks/${created.id}/subtasks`))[0]?.done === true);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(400);
  check("Escape closes the panel", await evaluate("document.querySelector('.drawer').hidden"));

  // 5. search and quick filters
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2, windowsVirtualKeyCode: 75 }); await sleep(200);
  check("Ctrl K focuses search", await evaluate("document.activeElement.id === 'search'"));
  await type("fontów"); await sleep(600);
  check("search narrows the board", await evaluate("document.querySelectorAll('.card').length") === 1);
  await evaluate("(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); })()"); await sleep(500);
  await click('[data-quick="overdue"]');
  const overdue = await evaluate("[...document.querySelectorAll('.card__title')].map(e => e.textContent)");
  check("the overdue tile filters to overdue tasks", overdue.length === 2, overdue.join(" | "));
  await click('[data-quick="overdue"]');

  // 6. other views and management
  await click('[data-view="list"]'); check("list view", await evaluate("document.querySelectorAll('.row').length") > 5);
  await click('[data-view="calendar"]'); check("calendar view", await evaluate("document.querySelectorAll('.day').length") >= 35);
  await click('[data-view="board"]');
  await click('[data-action="manage"][data-tab="categories"]');
  await click('dialog [data-add] input[name="name"]'); await type("Pilne");
  await click('dialog [data-add] button[type="submit"]'); await sleep(900);
  check("labels can be added from Porządek", (await api("/api/categories")).some(l => l.name === "Pilne"));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(300);

  // 7. long columns scroll inside; a card can be dropped at the bottom of a long column
  const post = body => fetch(BASE + "/api/tasks", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ date: "2026-11-06", ...body }) }).then(r => r.json());
  for (let i = 1; i <= 10; i++) await post({ title: `Długa kolumna ${i}`, status: "done" });
  await send("Page.reload"); await sleep(2500);
  const box = await evaluate("(() => { const c = document.querySelector('.column--done .column__cards'); return { client: c.clientHeight, scroll: c.scrollHeight, page: document.documentElement.scrollHeight }; })()");
  check("a long column scrolls inside instead of growing the page", box.scroll > box.client && box.client <= 720, JSON.stringify(box));
  const mover = (await api("/api/tasks")).find(t => t.status === "todo");
  await evaluate("document.querySelector('.column--done .column__cards').scrollIntoView({ block: 'end' })"); await sleep(300);
  const start = await center(`.card[data-id="${mover.id}"] .card__title`, false);
  const zone = await evaluate("(() => { const r = document.querySelector('.column--done .column__cards').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 15 }; })()");
  await mouse("mousePressed", start.x, start.y);
  for (let i = 1; i <= 10; i++) await mouse("mouseMoved", start.x + (zone.x - start.x) * i / 10, start.y + (zone.y - start.y) * i / 10);
  await sleep(4000); // resting near the column's bottom edge scrolls it to the end
  if (process.env.DEBUG) console.log("  at drop:", await evaluate(`JSON.stringify((() => { try { const c = document.querySelector('.column--done .column__cards'); const m = document.querySelector('.drop-marker'); return { top: c.scrollTop, max: c.scrollHeight - c.clientHeight, marker: m ? (m.parentElement?.dataset.drop || '?') + ' next=' + (m.nextElementSibling?.dataset?.id || 'end') : 'none', ghost: !!document.querySelector('.card--ghost'), y: ${zone.y}, inner: innerHeight, bottom: c.getBoundingClientRect().bottom, sy: scrollY }; } catch (e) { return String(e); } })())`), JSON.stringify(zone));
  await mouse("mouseReleased", zone.x, zone.y); await sleep(1500);
  const done = (await api("/api/tasks")).filter(t => t.status === "done").sort((a, b) => a.position - b.position);
  check("resting at a column's edge scrolls it, so a card lands at the end of a long column", done.at(-1)?.id === mover.id, `last=${done.at(-1)?.title}`);

  // 8. archive: restore brings a task back to ToDo
  const archived = (await api("/api/archive")).tasks[0];
  const archivedTitle = archived?.title;
  if (archivedTitle) {
    await click('[data-view="archive"]'); await sleep(800);
    await click(`.row--archived[data-id="${archived.id}"] [data-arch=restore]`); await sleep(1200);
    check("restoring from the archive reopens the task", (await api("/api/tasks")).some(t => t.title === archivedTitle && t.status === "todo"));
  }
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
