// Browser check of clients (CALENDAR=1 e2e/ui-run.sh … TEST=e2e/ui-clients.mjs): a lead whose e-mail is a meeting
// guest gets the meeting after a sync, the sidebar scopes the board to the client, the client card lists the meeting,
// a task created from the card carries the client chip, a task added in the meeting is linked to it, the lead is promoted.
// SHOT=/path/prefix also saves screenshots of the client card on desktop and phone.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const BASE = process.env.TASKS_URL || "http://127.0.0.1:3197";
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1672,941",
  "--user-data-dir=/tmp/tasks-e2e-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const errors = []; const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => pending.set(id, r)); };
const ev = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const headers = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const api = (path, method = "GET", body) => fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) }).then(r => r.json());
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(500);
}
try {
  const lead = await api("/api/clients", "POST", { name: "Kwiaciarnia Róża", status: "lead", email: "roza@kwiaciarnia.pl", company: "Kwiaciarnia Róża s.c." });
  const account = (await api("/api/calendar/accounts")).accounts[0];
  await api(`/api/calendar/accounts/${account.id}/sync`, "POST", {});
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
  check("the sidebar lists the lead with its badge", await ev(`Boolean(document.querySelector('[data-action="client-scope"][data-client="${lead.id}"] .lead-badge'))`));
  await click(`[data-action="client-scope"][data-client="${lead.id}"]`); await sleep(500);
  check("the head shows the client and its card button", await ev("document.querySelector('.page-head__title')?.textContent.includes('Kwiaciarnia Róża') && Boolean(document.querySelector('[data-action=\"client-card\"]'))"));
  await click('[data-action="client-card"]'); await sleep(500);
  check("the client card lists the matched meeting", await ev("[...document.querySelectorAll('dialog[open] [data-meeting]')].some(b => b.textContent.includes('Spotkanie z leadem'))"));
  await click('dialog[open] [data-act="task"]'); await sleep(500);
  check("a new task from the card preselects the client", await ev(`document.querySelector('dialog[open] select[name="clientId"]')?.value === "${lead.id}"`));
  await ev("(() => { const f = document.querySelector('dialog[open] form'); f.title.value = 'Przygotować ofertę dla kwiaciarni'; })()");
  await click('dialog[open] button[type="submit"]'); await sleep(1500);
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(300);
  const tasks = await api(`/api/tasks?clientId=${lead.id}`);
  const offer = (Array.isArray(tasks) ? tasks : tasks.tasks || []).find(t => t.title === "Przygotować ofertę dla kwiaciarni");
  check("the task is stored with the client", offer?.clientId === lead.id, JSON.stringify(offer && { clientId: offer.clientId }));
  check("the board card shows the client chip", await ev("[...document.querySelectorAll('.chip--client')].some(c => c.textContent.includes('Kwiaciarnia Róża'))"));
  await click('[data-action="client-card"]'); await sleep(500);
  await ev("[...document.querySelectorAll('dialog[open] [data-meeting]')].find(b => b.textContent.includes('Spotkanie z leadem')).setAttribute('data-test', 'lead')");
  await click('dialog[open] [data-test="lead"]'); await sleep(600);
  check("the meeting dialog preselects its client", await ev(`document.querySelector('dialog[open] select[name="clientId"]')?.value === "${lead.id}"`));
  await ev("(() => { const f = document.querySelector('dialog[open] form'); f.newTask.value = 'Wysłać podsumowanie spotkania'; })()");
  await click('dialog[open] [data-add-task]'); await sleep(1800);
  check("the meeting lists the task added in it", await ev("[...document.querySelectorAll('dialog[open] [data-task]')].some(b => b.textContent.includes('Wysłać podsumowanie spotkania'))"));
  const meetingTask = (await api(`/api/tasks?clientId=${lead.id}`)).find?.(t => t.title === "Wysłać podsumowanie spotkania");
  check("the meeting task is linked to the meeting and the client", Boolean(meetingTask?.meetingId) && meetingTask.clientId === lead.id, JSON.stringify(meetingTask && { m: meetingTask.meetingId, c: meetingTask.clientId }));
  await ev("document.querySelector('dialog[open]')?.close()"); await sleep(300);
  await click('[data-action="client-card"]'); await sleep(500);
  await click('dialog[open] [data-act="promote"]'); await sleep(1500);
  check("the lead is promoted to a client", (await api(`/api/clients/${lead.id}`)).status === "client");
  check("the sidebar shows the open task count instead of the badge", await ev(`(() => { const b = document.querySelector('[data-action="client-scope"][data-client="${lead.id}"]'); return b && !b.querySelector('.lead-badge') && b.querySelector('em')?.textContent === "2"; })()`));
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
  if (process.env.SHOT) {
    const shot = async name => writeFileSync(`${process.env.SHOT}-${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    await shot("board");
    await click('[data-action="client-card"]'); await sleep(800); await shot("card");
    await ev("document.querySelector('dialog[open]').close()");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(800);
    await ev("document.querySelector('[data-action=\"client-card\"]').click()"); await sleep(800); await shot("card-phone");
  }
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
