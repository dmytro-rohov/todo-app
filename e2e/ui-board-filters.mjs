// Browser check of the filter bar and project colours on the board (e2e/ui-run.sh … app TEST=e2e/ui-board-filters.mjs):
// "Wyczyść filtry" shows only while a filter is on and clears all of them; "Pokaż zakończone" off hides the whole
// Zakończone column; a task in a project gets a pale tint of the project's colour, others keep the plain card.
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
  await sleep(600);
}
const pick = (filter, value) => ev(`(() => { const s = document.querySelector('[data-filter="${filter}"]'); s.value = ${JSON.stringify(String(value))};
  s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
const clearShown = () => ev(`(() => { const b = document.querySelector('[data-action="clear-filters"]'); return !!b && !b.hidden && b.getClientRects().length > 0; })()`);
const columns = () => ev(`[...document.querySelectorAll('.board .column')].map(c => c.dataset.status).join(",")`);
try {
  const projects = await api("/api/projects");
  const project = projects.find(p => !p.archivedAt);
  const today = new Date().toISOString().slice(0, 10);
  const inProject = await api("/api/tasks", "POST", { title: "Zadanie w projekcie", date: today, spaceId: project.spaceId, projectId: project.id });
  const loose = await api("/api/tasks", "POST", { title: "Zadanie bez projektu", date: today });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);

  check("no filter: no clear button", !(await clearShown()));
  await pick("labelId", (await api("/api/categories"))[0].id); await sleep(500);
  check("a filter on: “Wyczyść filtry” shows", await clearShown(), await ev(`document.querySelector('[data-action="clear-filters"]')?.textContent.trim()`));
  await pick("projectId", project.id); await sleep(500);
  await click('[data-action="clear-filters"]');
  const f = await ev(`[...document.querySelectorAll('[data-filter]')].filter(s => s.tagName === "SELECT").map(s => s.value).join("|")`);
  check("it clears every filter, project included", /^\|+$/.test(f), f);
  check("…and hides itself again", !(await clearShown()));

  check("all five columns with “Pokaż zakończone” on", await columns() === "todo,in_progress,needs_review,done,planned", await columns());
  await click('.switch'); await sleep(600);
  check("off: the Zakończone column is gone", await columns() === "todo,in_progress,needs_review,planned", await columns());
  const width = await ev(`(() => { const b = document.querySelector('.board'); const c = b.querySelector('.column'); const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { col: c.getBoundingClientRect().width, rem, board: b.clientWidth }; })()`);
  const gap = width.col * 3 + 2 * width.rem - width.board;
  check("…and three columns fill the board", Math.abs(gap) <= 3, JSON.stringify(width));
  await send("Page.reload"); await sleep(3500);
  check("the choice is remembered", await columns() === "todo,in_progress,needs_review,planned", await columns());
  await pick("status", "done"); await sleep(500);
  check("the status filter “Zakończone” still shows that column", (await columns()).includes("done"), await columns());
  await click('[data-action="clear-filters"]'); await click('.switch'); await sleep(600);
  check("on again: the column is back", await columns() === "todo,in_progress,needs_review,done,planned", await columns());

  const look = id => ev(`(() => { const c = document.querySelector('.card[data-id="${id}"]'); const s = getComputedStyle(c);
    return { bg: s.backgroundColor, pc: s.getPropertyValue("--pc").trim(), left: s.borderLeftColor, project: c.classList.contains("card--project") }; })()`);
  const tinted = await look(inProject.id), plain = await look(loose.id);
  check("a task in a project is tinted with the project's colour", tinted.project && tinted.pc.toLowerCase() === project.color.toLowerCase() && tinted.bg !== plain.bg, JSON.stringify(tinted));
  check("a task without a project keeps the plain card", !plain.project && !plain.pc, JSON.stringify(plain));
  const [r, g, b] = tinted.bg.match(/[\d.]+/g).map(Number);
  check("the tint is pale (dark card, not the folder's strong colour)", Math.max(r, g, b) < 80, tinted.bg);
  // a new task can get its priority right away
  await click('[data-action="new-task"]');
  check("the new-task form offers the four priorities, Normalny chosen", await ev(`[...document.querySelectorAll('dialog[open] [name="priority"]')].map(i => i.value + (i.checked ? "*" : "")).join(",")`) === "P0,P1,P2*,P3");
  await ev(`(() => { const f = document.querySelector('dialog[open] form'); f.title.value = "Pilna poprawka"; return true; })()`);
  await click('dialog[open] [name="priority"][value="P0"]');
  if (process.env.SHOTS) { const { result } = await send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(`${process.env.SHOTS}/new-task-priority.png`, Buffer.from(result.data, "base64")); }
  await click('dialog[open] [type="submit"]'); await sleep(800);
  const urgent = (await api("/api/tasks")).find(t => t.title === "Pilna poprawka");
  check("…and the task is created with it", urgent?.priority === "P0", urgent?.priority);
  check("…shown on its card", await ev(`document.querySelector('.card[data-id="${urgent?.id}"] .chip--p0')?.textContent.trim()`) === "Krytyczny");
  if (process.env.SHOTS) { const { result } = await send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(`${process.env.SHOTS}/board-project-colours.png`, Buffer.from(result.data, "base64")); }
  check("no script errors", errors.length === 0, errors.join(" | "));
} catch (error) { check("run", false, error.stack); } finally { chrome.kill(); }
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
