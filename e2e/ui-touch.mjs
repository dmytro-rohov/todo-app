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
await ev("scrollTo(0,0); document.querySelector('.board').scrollLeft = 0"); await sleep(300);
const q = await ev(`(() => { const r = document.querySelector('.card[data-id="${id}"] .card__title').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: q.x, y: q.y }] });
await sleep(450);
console.log((await ev("Boolean(document.querySelector('.card--ghost'))") ? "PASS" : "FAIL") + " press and hold picks the card up");
for (let i = 1; i <= 25; i++) { await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.min(350, q.x + i * 8), y: q.y }] }); await sleep(30); }
await sleep(700); // finger resting at the right edge: the board keeps scrolling
const scrolled = await ev("document.querySelector('.board').scrollLeft");
console.log((scrolled > 100 ? "PASS" : "FAIL") + ` resting at the edge scrolls the board (scrollLeft=${scrolled})`);
const over = await ev("document.querySelector('.drop-marker')?.closest('[data-drop]')?.dataset.drop || 'none'");
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(1500);
const status = (await api("/api/tasks")).find(t => t.id === id).status;
console.log((status !== "todo" ? "PASS" : "FAIL") + ` hold and drag moves the card across columns on a phone (marker in ${over}, now ${status})`);
console.log((errors.length ? "FAIL" : "PASS") + " no exceptions " + errors.join(" | "));
chrome.kill(); process.exit(0); // results are the PASS/FAIL lines
