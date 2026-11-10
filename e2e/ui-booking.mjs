// Browser check of the booking form (CALENDAR=1 e2e/ui-run.sh … TEST=e2e/ui-booking.mjs): booking-form/ is served on
// another origin (127.0.0.1:3198, listed in BOOKING_ORIGINS) and calls the Tasks API across origins; a visitor picks
// a slot and books; Tasks then has the meeting with a Meet link, the lead and the preparation task.
// SHOT=/path/prefix also saves screenshots of the form on desktop and phone.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const DIR = new URL("../booking-form/", import.meta.url);
const site = http.createServer((req, res) => {
  const name = new URL(req.url, "http://x").pathname.slice(1) || "booking-form.html";
  if (name === "favicon.ico") { res.writeHead(204); return res.end(); }
  if (!/^booking-form\.(html|js|css)$/.test(name)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(new URL(name, DIR), "utf8");
  if (name.endsWith(".html")) body = body.replace("https://tasks.mytko.dev", BASE);
  res.writeHead(200, { "content-type": { html: "text/html", js: "text/javascript", css: "text/css" }[name.split(".").pop()] + "; charset=utf-8" });
  res.end(body);
}).listen(3198, "127.0.0.1");
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1280,900",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const api = path => fetch(BASE + path).then(r => r.json());
const shot = async name => process.env.SHOT && writeFileSync(`${process.env.SHOT}-${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).result.data, "base64"));
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(300);
}
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text); });
  await send("Runtime.enable"); await send("Log.enable");
  await send("Page.enable");
  // e2e checks the Polish texts: a fresh test profile starts in Polish (Ukrainian is the default on a new device)
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { if (localStorage.getItem('mytko-tasks:lang') === null) localStorage.setItem('mytko-tasks:lang', 'pl'); } catch {}" });
  await send("Page.navigate", { url: "http://127.0.0.1:3198/" }); await sleep(2500);
  const days = await ev("document.querySelectorAll('.mb-day').length");
  check("the form on another origin loads free days across CORS", days > 0, `${days} days`);
  check("the first day lists times", await ev("document.querySelectorAll('.mb-slot').length") > 0);
  check("booking stays disabled until a time is picked", await ev("document.querySelector('.mb-submit').disabled"));
  await click(".mb-day:nth-child(2)");
  await click(".mb-slot:nth-child(2)");
  check("picking a time shows it and enables booking", await ev("document.querySelector('[data-picked]').textContent.includes('czas polski') && !document.querySelector('.mb-submit').disabled"));
  await shot("form");
  await click(".mb-submit"); await sleep(500);
  check("without name, e-mail and consent nothing is sent", await ev("Boolean(document.querySelector('.mb-form')) && !document.querySelector('.mb-done')"));
  await ev(`(() => { const f = document.querySelector('.mb-form'); f.name.value = 'Ola Testowa'; f.email.value = 'ola@salon-oli.pl'; f.company.value = 'Salon Oli';
    f.message.value = 'Sklep internetowy dla salonu.'; f.consent.checked = true; })()`);
  await click(".mb-submit"); await sleep(2500);
  check("the visitor sees the confirmation", await ev("document.querySelector('.mb-done')?.textContent.includes('Google Meet')"));
  await shot("done");
  const lead = (await api("/api/clients")).find(c => c.email === "ola@salon-oli.pl");
  check("Tasks has the lead from the booking", lead?.status === "lead" && lead.source === "booking" && lead.name === "Salon Oli", JSON.stringify(lead && { s: lead.status, src: lead.source }));
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const meeting = (await api(`/api/calendar/events?from=${from}&to=${to}&clientId=${lead?.id}`))[0];
  check("the meeting has a Meet link and the visitor as guest", Boolean(meeting?.meetUrl) && meeting.attendees.some(a => a.email === "ola@salon-oli.pl"));
  const prep = (await api(`/api/tasks?meetingId=${meeting?.id}`))[0];
  check("a preparation task is in ToDo for the meeting", prep?.title === "Przygotować się do rozmowy: Ola Testowa" && prep.status === "todo");
  if (process.env.SHOT) {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: "http://127.0.0.1:3198/" }); await sleep(2500);
    await click(".mb-slot:nth-child(1)");
    await shot("phone");
  }
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill(); site.close();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
