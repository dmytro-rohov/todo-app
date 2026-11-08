// Browser check of "Cele / Marzenia" (e2e/ui-run.sh … app TEST=e2e/ui-goals.mjs): a list for the current month, items
// with a heading, description and deadline, goal / dream switch, ticking off (stays, crossed out), order (arrows,
// Alt+arrows), the year list, earlier lists on the side, editing, and the phone layout. SHOTS=/dir saves screenshots.
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
// failing: requests to /api/goals are answered with a network error (Fetch domain), counted in `failed`
let failing = false, failed = 0;
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const api = path => fetch(BASE + path, { headers: { "sec-fetch-site": "same-origin" } }).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(700);
}
async function type(selector, text) {
  await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await send("Input.insertText", { text }); await sleep(200);
}
const key = async (key, modifiers = 0) => { for (const t of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t, key, code: key, windowsVirtualKeyCode: { ArrowUp: 38, ArrowDown: 40, Enter: 13 }[key], modifiers }); await sleep(700); };
const titles = () => ev(`[...document.querySelectorAll('.goal .goal__title')].map(t => t.textContent).join("|")`);
const shot = async name => { if (!process.env.SHOTS) return;
  const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  (await import("node:fs")).writeFileSync(`${process.env.SHOTS}/goals-${name}.png`, Buffer.from(result.data, "base64")); };
const now = new Date(); const year = now.getFullYear(); const month = now.getMonth() + 1;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Fetch.requestPaused") {
      if (failing) { failed++; send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "Failed" }); }
      else send("Fetch.continueRequest", { requestId: m.params.requestId });
    } });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
  await click('[data-view="goals"]'); await sleep(800);
  check("the tab opens the current month's list", await ev(`document.querySelector('.goals__head h2')?.textContent.trim()`) === `${["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"][month - 1]} ${year}`,
    await ev(`document.querySelector('.goals__head h2')?.textContent.trim()`));
  check("task filters are hidden here", await ev(`getComputedStyle(document.querySelector('.filters')).display`) === "none");
  check("an empty list says so", Boolean(await ev(`document.querySelector('.goals__empty')`)));

  // a goal with a description and a deadline
  await click('[data-goal="more"]');
  await type('[data-goal-form] [name="title"]', "Przebiec 50 km");
  await type('[data-goal-form] [name="description"]', "Dwa razy w tygodniu po 5 km");
  await ev(`(() => { const d = document.querySelector('[data-goal-form] [name="deadline"]'); d.value = "${year}-${String(month).padStart(2, "0")}-28"; d.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await click('[data-goal-form] [type="submit"]'); await sleep(500);
  // a dream; typing survives a re-render of the page
  await click('[data-goal="draft-kind"][data-kind="dream"]');
  await type('[data-goal-form] [name="title"]', "Zobaczyć zorzę");
  await ev(`window.dispatchEvent(new Event("hashchange"))`); await sleep(400);
  check("what is typed survives a re-render", await ev(`document.querySelector('[data-goal-form] [name="title"]').value`) === "Zobaczyć zorzę");
  await click('[data-goal-form] [type="submit"]');
  await type('[data-goal-form] [name="title"]', "Przeczytać dwie książki");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await sleep(900);
  check("items are listed in the order added", await titles() === "Przebiec 50 km|Zobaczyć zorzę|Przeczytać dwie książki", await titles());
  const first = await ev(`(() => { const g = document.querySelector('.goal'); return { desc: g.querySelector('.goal__desc')?.textContent, deadline: !!g.querySelector('.goal__deadline'), kind: g.className }; })()`);
  check("heading, description and deadline are shown", first.desc === "Dwa razy w tygodniu po 5 km" && first.deadline, JSON.stringify(first));
  check("a dream looks different from a goal", await ev(`(() => { const [a, b] = document.querySelectorAll('.goal'); return a.classList.contains('goal--goal') && b.classList.contains('goal--dream')
    && getComputedStyle(a).borderLeftColor !== getComputedStyle(b).borderLeftColor; })()`));
  await shot("list");

  // tick off: stays, crossed out
  await click('.goal:nth-child(1) .goal__check');
  const ticked = await ev(`(() => { const g = document.querySelector('.goal'); return { done: g.classList.contains('is-done'), line: getComputedStyle(g.querySelector('.goal__title')).textDecorationLine, count: document.querySelectorAll('.goal').length }; })()`);
  check("a ticked item stays in the list, crossed out", ticked.done && ticked.line === "line-through" && ticked.count === 3, JSON.stringify(ticked));
  check("the summary counts it", (await ev(`document.querySelector('.goals__summary')?.textContent.replace(/\\s+/g, " ").trim()`)).startsWith("Zrobione 1 z 3"),
    await ev(`document.querySelector('.goals__summary')?.textContent.replace(/\\s+/g, " ").trim()`));
  // goal ↔ dream on the item itself
  // (the form keeps the kind chosen last, so the third item was added as a dream)
  check("the form keeps the chosen kind for the next item", await ev(`document.querySelector('.goal:nth-child(3)').classList.contains('goal--dream')`));
  await click('.goal:nth-child(3) [data-goal="kind"]');
  check("the switch next to an item turns a dream into a goal", await ev(`document.querySelector('.goal:nth-child(3)').classList.contains('goal--goal')`));

  // order: arrows and Alt+arrows
  await click('.goal:nth-child(3) [data-goal="up"]');
  check("“Wyżej” moves an item up", await titles() === "Przebiec 50 km|Przeczytać dwie książki|Zobaczyć zorzę", await titles());
  await ev(`document.querySelector('.goal:nth-child(1)').focus()`);
  await key("ArrowDown", 1);
  check("Alt+↓ moves the focused item down", await titles() === "Przeczytać dwie książki|Przebiec 50 km|Zobaczyć zorzę", await titles());
  const saved = (await api(`/api/goals?year=${year}&month=${month}`)).map(g => g.title).join("|");
  check("the order is saved", saved === "Przeczytać dwie książki|Przebiec 50 km|Zobaczyć zorzę", saved);

  // edit in a dialog
  await click('.goal:nth-child(3) [data-goal="edit"]');
  await ev(`(() => { const f = document.querySelector('dialog[open] form'); f.title.value = "Zobaczyć zorzę polarną"; return true; })()`);
  await click('dialog[open] [type="submit"]');
  check("editing changes the heading", (await titles()).endsWith("Zobaczyć zorzę polarną"), await titles());

  // the year list, and earlier lists on the side
  await click('[data-goal="mode"][data-mode="year"]'); await sleep(800);
  check("Rok opens the list for the whole year", await ev(`document.querySelector('.goals__head h2')?.textContent.trim()`) === `Rok ${year}`);
  await type('[data-goal-form] [name="title"]', "Nowa strona studia");
  await click('[data-goal-form] [type="submit"]');
  check("the year list has its own items", await titles() === "Nowa strona studia", await titles());
  const side = await ev(`[...document.querySelectorAll('.goals__history button')].map(b => b.textContent.replace(/\\s+/g, " ").trim()).join("|")`);
  check("the month's list is on the side with how much was done", /1\/3/.test(side || ""), side);
  await click('.goals__history button');
  check("…and opens from there", (await titles()).includes("Przebiec 50 km"), await titles());
  await click('[data-goal="next"]');
  check("the arrows go to the next month (an empty list)", Boolean(await ev(`document.querySelector('.goals__empty')`)));
  await click('[data-goal="prev"]');
  // two quick clicks: the list of the period finally shown is loaded, not stuck on "Wczytuję…"
  await ev(`(() => { const b = document.querySelector('[data-goal="next"]'); b.click(); document.querySelector('[data-goal="next"]').click(); return true; })()`); await sleep(1500);
  check("fast period switching ends on a loaded list", !(await ev(`/Wczytuję/.test(document.querySelector('.goals__list')?.textContent || "")`))
    && Boolean(await ev(`document.querySelector('.goals__empty, .goals__items')`)), await ev(`document.querySelector('.goals__head h2')?.textContent.trim()`));
  await ev(`(() => { document.querySelector('[data-goal="prev"]').click(); return true; })()`); await sleep(800);
  await ev(`(() => { document.querySelector('[data-goal="prev"]').click(); return true; })()`); await sleep(1200);

  // the server failing: one error with "Spróbuj ponownie", no retry loop; the button loads the list again
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/goals*" }] });
  failing = true; failed = 0;
  await ev(`(() => { document.querySelector('[data-goal="next"]').click(); return true; })()`); await sleep(2500);
  const errorShown = await ev(`!!document.querySelector('.goals__list [data-goal="retry"]')`);
  check("a failed load shows “Spróbuj ponownie” and does not retry on its own", errorShown && failed <= 2, `requests failed: ${failed}`);
  failing = false;
  await click('[data-goal="retry"]'); await sleep(1200);
  check("“Spróbuj ponownie” loads the list", Boolean(await ev(`document.querySelector('.goals__empty, .goals__items')`)));
  await ev(`(() => { document.querySelector('[data-goal="prev"]').click(); return true; })()`); await sleep(1500);
  // a failed reorder whose reload fails too: retry fetches the saved list again
  failing = true; failed = 0;
  await click('.goal:nth-child(2) [data-goal="up"]'); await sleep(1500);
  check("a failed save shows the error with a retry", await ev(`!!document.querySelector('.goals__list [data-goal="retry"]')`), `requests failed: ${failed}`);
  failing = false;
  await click('[data-goal="retry"]'); await sleep(1200);
  const afterRetry = await titles();
  const stored = (await api(`/api/goals?year=${year}&month=${month}`)).map(g => g.title).join("|");
  check("…and retry shows the list as saved on the server", afterRetry === stored, `${afterRetry} vs ${stored}`);
  await send("Fetch.disable");

  // phone
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload"); await sleep(3500);
  await click('[data-view="goals"]'); await sleep(900);
  const fit = await ev(`({ page: document.documentElement.scrollWidth, view: innerWidth, items: [...document.querySelectorAll('.goal')].every(g => g.getBoundingClientRect().right <= innerWidth + 1) })`);
  check("on a phone everything fits without sideways scrolling", fit.page <= fit.view && fit.items, JSON.stringify(fit));
  await shot("phone");
  check("no script errors", errors.length === 0, errors.join(" | "));
} catch (error) { check("run", false, error.stack); } finally { chrome.kill(); }
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
