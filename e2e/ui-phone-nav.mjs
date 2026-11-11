// Phone navigation (the Mytko Kit's bottom tab bar, as in Finance and Fitness): Tablica, Lista, "+", Kalendarz and
// "Więcej"; every view and everything the sidebar holds on computers is reachable from it on a phone, and on a computer
// the tab bar is hidden and the view tabs above the board stay. Run by e2e/ui-run.sh (TEST=e2e/ui-phone-nav.mjs).
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function tap(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e?.getBoundingClientRect(); return r && r.width && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`nothing to tap: ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(700);
}
const shown = selector => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0; })()`);
const sheet = () => ev(`[...document.querySelectorAll('dialog[open] .sheet-nav [data-view], dialog[open] .sheet-nav [data-logout]')].map(b => b.dataset.view || "logout").join(",")`);
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { if (localStorage.getItem('mytko-tasks:lang') === null) localStorage.setItem('mytko-tasks:lang', 'pl'); } catch {}" });

  // ---- computer: no tab bar, the view tabs and the sidebar
  await send("Page.navigate", { url: BASE + "/#board" }); await sleep(3500);
  check("computer: the tab bar is hidden", !(await shown(".tabbar")));
  check("computer: the view tabs and the sidebar are there", await shown(".toolbar .tabs") && await shown(".sidebar"));
  check("computer: no floating \"+\" any more", !(await ev("!!document.querySelector('.fab')")));

  // ---- phone
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload"); await sleep(3500);
  check("phone: the tab bar is shown, the view tabs are not", await shown(".tabbar") && !(await shown(".toolbar .tabs")));
  const items = await ev(`[...document.querySelectorAll('.tabbar > *')].map(b => b.dataset.view || (b.matches('[data-add]') ? '+' : b.matches('[data-more]') ? 'more' : '?')).join(",")`);
  check("phone: Tablica, Lista, \"+\", Kalendarz, Więcej", items === "board,list,+,calendar,more", items);
  const labels = await ev(`[...document.querySelectorAll('.tabbar .tabbar__item span')].map(s => s.textContent).join(",")`);
  check("phone: the tabs are named in Polish", labels === "Tablica,Lista,Kalendarz,Więcej", labels);
  check("phone: the tab bar sits at the bottom, one row", await ev(`(() => { const r = document.querySelector('.tabbar').getBoundingClientRect(); return Math.round(r.bottom) === innerHeight && new Set([...document.querySelectorAll('.tabbar .tabbar__item')].map(t => Math.round(t.getBoundingClientRect().top))).size === 1; })()`));
  check("phone: Tablica is active", await ev(`document.querySelector('.tabbar [data-view="board"]').classList.contains('is-active') && !!document.querySelector('.view .board')`));
  check("phone: the content ends above the tab bar", await ev(`(() => { scrollTo(0, document.scrollingElement.scrollHeight); const last = [...document.querySelectorAll('.view .column')].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0); return last <= document.querySelector('.tabbar').getBoundingClientRect().top + 1; })()`));
  await ev("scrollTo(0, 0)");
  for (const [view, probe] of [["list", ".view .row"], ["calendar", ".view .day, .view .agenda"], ["board", ".view .board"]]) {
    await tap(`.tabbar [data-view="${view}"]`);
    check(`phone: the tab bar opens ${view}`, await ev(`document.querySelector('.tabbar [data-view="${view}"]').classList.contains('is-active') && !!document.querySelector(${JSON.stringify(probe)}) && location.hash.startsWith('#${view}')`));
  }
  await tap(".tabbar__add");
  check("phone: \"+\" opens a new task", await ev(`!!document.querySelector('dialog[open] form') && document.querySelector('dialog[open] .dialog__head h2')?.textContent.includes('zadanie')`));
  check("phone: the tab bar steps aside while a dialog is open", !(await shown(".tabbar")));
  await ev("document.querySelector('dialog[open]').close()"); await sleep(400);

  await tap(".tabbar [data-more]");
  const entries = await sheet();
  check("phone: \"Więcej\" lists the other views, the sidebar, accounts, AI, size, language and logout (owner)",
    entries === "goals,archive,mail,scope,accounts,ai-settings,ui-scale,language,logout", entries);
  for (const [view, probe] of [["goals", ".view-goals, .goals"], ["archive", ".view .archive, .view [data-view='archive'], .view"], ["mail", ".view-mail"]]) {
    if (!(await ev("!!document.querySelector('dialog[open] .sheet-nav')"))) await tap(".tabbar [data-more]");
    await tap(`dialog[open] .sheet-nav [data-view="${view}"]`);
    check(`phone: "Więcej" opens ${view}; "Więcej" is marked active`, await ev(`location.hash.startsWith('#${view}') && document.querySelector('.tabbar [data-more]').classList.contains('is-active') && !!document.querySelector(${JSON.stringify(probe)})`));
  }
  await tap(".tabbar [data-more]");
  await tap('dialog[open] .sheet-nav [data-view="scope"]');
  check("phone: \"Przestrzenie i projekty\" opens the sidebar drawer (spaces, projects, clients, the profile)",
    await ev(`document.querySelector('#app').classList.contains('sidebar-open') && document.querySelector('.sidebar').getBoundingClientRect().left >= 0 && document.querySelectorAll('.sidebar [data-action="scope"]').length > 2 && !!document.querySelector('.sidebar .profile')`));
  check("phone: the tab bar steps aside under the drawer", !(await shown(".tabbar")));
  await tap('.sidebar [data-action="sidebar-close"]');
  await tap(".tabbar [data-more]");
  await tap('dialog[open] .sheet-nav [data-view="accounts"]');
  check("phone: \"Konta\" opens the accounts", await ev(`!!document.querySelector('dialog[open]') && /Konta/.test(document.querySelector('dialog[open] h2')?.textContent || '')`));
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(400);
  await tap(".tabbar [data-more]");
  await tap('dialog[open] .sheet-nav [data-view="ui-scale"]');
  check("phone: \"Rozmiar interfejsu\" opens its dialog", await ev(`!!document.querySelector('dialog[open] [name="scale"]')`));
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(400);
  await tap(".tabbar [data-more]");
  await tap('dialog[open] .sheet-nav [data-view="language"]');
  check("phone: \"Język\" opens its dialog", await ev(`!!document.querySelector('dialog[open] [name="lang"]')`));
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(400);
  check("phone: nothing scrolls sideways", await ev("document.scrollingElement.scrollWidth <= innerWidth"));
  check("no script errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run", false, String(error?.stack || error));
}
console.log(results.every(Boolean) ? "ALL PASSED" : "SOME FAILED");
chrome.kill();
process.exit(results.every(Boolean) ? 0 : 1);
