// Screenshot helper: opens #calendar in week mode (and optional #link), writes PNGs. Used by e2e/ui-run.sh TEST=…
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const OUT = process.env.SHOT_OUT || "/tmp/shot";
const [w, h] = (process.env.SHOT_SIZE || "1672x941").split("x").map(Number);
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9333", `--window-size=${w},${h}`,
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
if (w < 700) await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true });
await send("Page.navigate", { url: `${BASE}/#calendar` }); await sleep(2500);
for (const step of (process.env.SHOT_STEPS || "").split(",").filter(Boolean)) {
  await send("Runtime.evaluate", { expression: step, awaitPromise: true }); await sleep(900);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}.png`, Buffer.from(shot.result.data, "base64"));
chrome.kill(); process.exit(0);
