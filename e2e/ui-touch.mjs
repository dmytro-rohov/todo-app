// Touch drag and drop on a phone-sized viewport (Chrome touch emulation over CDP). Same setup as e2e/ui-smoke.mjs.
import { spawn } from "node:child_process";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1672,941", "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = [];
function send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); }
async function ev(e) { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; }
const api = p => fetch(BASE + p).then(r => r.json());
let target; for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: BASE + "/#board" }); await sleep(2500);
const id = (await api("/api/tasks")).find(t => t.status === "todo").id;
const p = await ev(`(() => { const r = document.querySelector('.card[data-id="${id}"] .card__title').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
// Quick swipe: must scroll, not pick the card up.
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
for (let i = 1; i <= 5; i++) await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y - i * 12 }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(500);
console.log(((await api("/api/tasks")).find(t => t.id === id).status === "todo" ? "PASS" : "FAIL") + " a quick swipe does not move the card");
// Press and hold, then drag to the right edge (next column scrolls in), drop on the In progress column.
// the swipe scrolled the column itself (long columns scroll inside); start the hold from the top again
await ev("scrollTo(0,0); document.querySelector('.board').scrollLeft = 0; document.querySelectorAll('.column__cards').forEach(c => { c.scrollTop = 0; })"); await sleep(300);
const q = await ev(`(() => { const r = document.querySelector('.card[data-id="${id}"] .card__title').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: q.x, y: q.y }] });
await sleep(450);
console.log((await ev("Boolean(document.querySelector('.card--ghost'))") ? "PASS" : "FAIL") + " press and hold picks the card up");
// to the right edge of a 390 px phone, inside the 48 px auto-scroll band whatever the interface size
for (let i = 1; i <= 30; i++) { await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.min(372, q.x + i * 9), y: q.y }] }); await sleep(30); }
await sleep(700); // finger resting at the right edge: the board keeps scrolling
const scrolled = await ev("document.querySelector('.board').scrollLeft");
console.log((scrolled > 100 ? "PASS" : "FAIL") + ` resting at the edge scrolls the board (scrollLeft=${scrolled})`);
const over = await ev("document.querySelector('.drop-marker')?.closest('[data-drop]')?.dataset.drop || 'none'");
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(1500);
const status = (await api("/api/tasks")).find(t => t.id === id).status;
console.log((status !== "todo" ? "PASS" : "FAIL") + ` hold and drag moves the card across columns on a phone (marker in ${over}, now ${status})`);
console.log((errors.length ? "FAIL" : "PASS") + " no exceptions " + errors.join(" | "));
// Phone layout: nothing scrolls sideways in any view; the FAB opens a bottom sheet; filters fold away.
for (const view of ["board", "list", "calendar", "archive"]) {
  await ev(`location.hash = "${view}"; document.querySelector('[data-view="${view}"]').click()`); await sleep(600);
  const wide = await ev("document.scrollingElement.scrollWidth - innerWidth");
  console.log((wide <= 0 ? "PASS" : "FAIL") + ` phone ${view}: no sideways page scroll (${wide})`);
}
console.log((await ev("getComputedStyle(document.querySelector('.filters')).display === 'none' && getComputedStyle(document.querySelector('.fab')).display !== 'none'") ? "PASS" : "FAIL") + " phone: filters folded, FAB shown");
await ev("document.querySelector('.fab').click()"); await sleep(500);
console.log((await ev("(() => { const d = document.querySelector('dialog[open]'); const r = d?.getBoundingClientRect(); const a = d?.querySelector('.dialog__actions')?.getBoundingClientRect(); return Boolean(d) && Math.round(r.width) === innerWidth && a.bottom <= innerHeight + 1; })()") ? "PASS" : "FAIL") + " phone: new task opens as a full-width sheet with its buttons in reach");
chrome.kill(); process.exit(0); // results are the PASS/FAIL lines
