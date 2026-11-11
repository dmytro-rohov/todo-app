// Browser check of accounts (e2e/ui-run.sh <image> accounts … TEST=e2e/ui-accounts.mjs): the owner signs in, creates
// an account in "Konta", a shared space "Dom" with that account ticked in, and a profile picture; the member signs in
// and gets the plain task app: own tasks plus the shared space, no clients, no accounts; the member changes their
// password, makes a shared space and an invitation code; the owner opens the code's link, signs in and joins.
// SHOT=/path/prefix also saves screenshots (owner's Konta, people, picture editor, invitation, member's board).
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
// API calls from the page, with its session cookie
const call = (path, method = "GET", body) => ev(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" },
  ${body ? `body: ${JSON.stringify(JSON.stringify(body))}` : ""} }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`);
async function click(selector) {
  const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "center" }); const r = e?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`no ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await sleep(400);
}
const startupVisible = () => ev("(() => { const s = document.querySelector('#startup'); return Boolean(s && !s.hidden && !s.classList.contains('startup--leaving')); })()");
// Signs in through the login form; returns how long the welcome start-up screen stayed (ms).
async function signIn(login, password, path = "/") {
  await send("Page.navigate", { url: "about:blank" }); await sleep(200); // a fresh load, as from a link (not a #hash change)
  await send("Page.navigate", { url: BASE + path }); await sleep(2000);
  await ev(`(() => { const f = document.querySelector("#auth form"); f.querySelector('#auth-login').value = ${JSON.stringify(login)};
    f.querySelector('[type="password"]').value = ${JSON.stringify(password)}; f.requestSubmit(); })()`);
  const started = Date.now();
  await sleep(1500);
  for (let i = 0; i < 100 && await startupVisible(); i++) await sleep(100);
  const shown = Date.now() - started;
  await sleep(600);
  return shown;
}
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.enable");
  // e2e checks the Polish texts: a fresh test profile starts in Polish (Ukrainian is the default on a new device)
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { if (localStorage.getItem('mytko-tasks:lang') === null) localStorage.setItem('mytko-tasks:lang', 'pl'); } catch {}" });

  const welcome = await signIn("owner", "owner-test-password");
  check("after signing in the start-up screen stays about five and a half seconds", welcome >= 5000 && welcome <= 8000, `${welcome} ms`);
  await send("Page.reload"); await sleep(400);
  check("after a reload the start-up screen shows", await startupVisible());
  const reloadStart = Date.now();
  for (let i = 0; i < 60 && await startupVisible(); i++) await sleep(100);
  check("…for a short moment only", Date.now() - reloadStart < 3000, `${Date.now() - reloadStart + 400} ms`);
  await sleep(600);
  check("the owner is the administrator", await ev("document.querySelector('.profile__text small')?.textContent.startsWith('Administrator')"));
  const work = (await call("/api/spaces")).body.find(s => s.key === "work");
  await call("/api/tasks", "POST", { title: "Oferta dla klienta", date: "2026-11-07", spaceId: work.id });
  await click('[data-action="accounts"]'); await sleep(800);
  await ev(`(() => { const f = document.querySelector("dialog[open] [data-add]"); f.name.value = "Ola"; f.login.value = "ola"; })()`);
  await click("dialog[open] [data-generate]");
  const password = await ev(`document.querySelector("dialog[open] [data-add]").password.value`);
  await click('dialog[open] [data-add] [type="submit"]'); await sleep(1200);
  check("the owner creates an account in Konta", await ev("[...document.querySelectorAll('dialog[open] .account')].some(a => a.textContent.includes('login: ola'))"));
  await shot("owner-accounts");
  await ev("document.querySelector('dialog[open]').close()"); await sleep(300);

  await ev(`location.hash = "manage-spaces"`); await sleep(1200);
  await ev(`(() => { const f = document.querySelector("dialog[open] [data-add]"); f.name.value = "Dom"; f.requestSubmit(); })()`); await sleep(1200);
  await ev(`(() => { const row = [...document.querySelectorAll("dialog[open] [data-item]")].find(r => r.querySelector('[name="name"]')?.value === "Dom");
    const box = row.querySelector('[name="shared"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(1200);
  const dom = (await call("/api/spaces")).body.find(s => s.name === "Dom");
  check("the owner marks Dom as shared", dom?.shared === true);
  check("…and is asked who is in it, with their accounts to tick", await ev("Boolean(document.querySelector('dialog.dialog--people[open] [data-account]'))"));
  await click("dialog.dialog--people[open] [data-account]"); await sleep(1000);
  const domPeople = (await call(`/api/spaces/${dom.id}/members`)).body;
  check("ticking Ola puts her in Dom", domPeople.some(p => p.name === "Ola"), JSON.stringify(domPeople.map(p => p.name)));
  check("the people list shows the owner and Ola", await ev("document.querySelectorAll('dialog.dialog--people[open] .person').length === 2"));
  await shot("owner-people");
  for (let i = 0; i < 3; i++) await ev("document.querySelector('dialog[open]')?.close()");

  // the owner's profile picture: a photo picked, cropped in the circle, saved small
  await send("Page.setInterceptFileChooserDialog", { enabled: true });
  await click('[data-action="avatar"]'); await sleep(400);
  check("the picture menu opens", await ev("Boolean(document.querySelector('dialog.dialog--avatar-menu[open] [data-avatar-pick]'))"));
  await click("dialog[open] [data-avatar-pick]"); await sleep(400);
  await ev(`(async () => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1000; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 1600, 1000); g.addColorStop(0, "#b7e34d"); g.addColorStop(1, "#1d4ed8"); x.fillStyle = g; x.fillRect(0, 0, 1600, 1000);
    x.fillStyle = "#fff"; x.beginPath(); x.arc(800, 500, 260, 0, Math.PI * 2); x.fill();
    const blob = await new Promise(r => c.toBlob(r, "image/png")); const input = document.querySelector('body > input[type="file"]');
    const dt = new DataTransfer(); dt.items.add(new File([blob], "me.png", { type: "image/png" })); input.files = dt.files; input.dispatchEvent(new Event("change")); })()`);
  await sleep(1200);
  check("the crop editor opens on the photo", await ev("Boolean(document.querySelector('dialog.dialog--avatar[open] canvas.avatar-crop'))"));
  await ev(`document.querySelector('dialog.dialog--avatar[open] [name="zoom"]').value = "1.6"`);
  await ev(`document.querySelector('dialog.dialog--avatar[open] [name="zoom"]').dispatchEvent(new Event("input"))`);
  await shot("avatar-editor");
  await click('dialog.dialog--avatar[open] [type="submit"]'); await sleep(1500);
  const session = (await call("/api/auth/session")).body;
  check("the picture is saved for the owner", typeof session.user.avatarAt === "number");
  check("…and shown round in the sidebar", await ev("Boolean(document.querySelector('.profile .avatar--photo img')?.complete && document.querySelector('.profile .avatar--photo img').naturalWidth === 256)"));
  const sent = await ev(`fetch("/api/avatars/owner").then(r => r.blob()).then(b => ({ type: b.type, size: b.size }))`);
  check("…as a small WebP or JPEG", ["image/webp", "image/jpeg"].includes(sent.type) && sent.size < 110 * 1024, JSON.stringify(sent));
  await call("/api/tasks", "POST", { title: "Zapłacić czynsz", date: "2026-11-07", spaceId: dom.id });
  await call("/api/auth/logout", "POST", {});

  await signIn("ola", password);
  check("the member signs in with the password from Konta", await ev("document.querySelector('.profile__text strong')?.textContent === 'Ola'"));
  const sidebar = await ev("document.querySelector('.sidebar').textContent");
  check("the member has no clients and no accounts", !sidebar.includes("Klienci") && !sidebar.includes("Konta"));
  const spaces = await ev("[...document.querySelectorAll('.nav-item--space span:not(.dot)')].map(n => n.textContent).join('|')");
  check("the member's spaces: own Prywatne and the shared Dom", spaces === "Prywatne|Dom", spaces);
  check("the shared space is marked", await ev("Boolean([...document.querySelectorAll('.nav-item--space')].find(n => n.textContent.includes('Dom'))?.querySelector('.shared-mark'))"));
  const board = await ev("document.querySelector('.board')?.textContent || ''");
  check("the board shows the shared task, not the owner's work", board.includes("Zapłacić czynsz") && !board.includes("Oferta dla klienta"));
  await click('[data-action="new-task"]'); await sleep(600);
  check("a new task has no client field", await ev("Boolean(document.querySelector('dialog[open] [name=\"title\"]')) && !document.querySelector('dialog[open] [name=\"clientId\"]')"));
  await ev(`(() => { const f = document.querySelector("dialog[open] form"); f.title.value = "Kupić kwiaty"; f.requestSubmit(); })()`); await sleep(1500);
  check("the member adds a task", await ev("document.querySelector('.board').textContent.includes('Kupić kwiaty')"));
  check("clients are refused to the member", (await call("/api/clients")).status === 403);
  await shot("member-board");
  check("the member sees the owner's picture among Dom's people", (await call(`/api/spaces/${dom.id}/members`)).body.find(p => p.creator)?.avatarAt === session.user.avatarAt
    && (await call("/api/avatars/owner")).status === 200);

  // the member's own shared space and an invitation code for the owner
  const garden = (await call("/api/spaces", "POST", { name: "Ogród", color: "#22c55e", shared: true })).body;
  await ev(`history.replaceState(null, "", "/#manage-spaces")`); await send("Page.reload"); await sleep(3000); // loaded again: the new space in the list
  await click(`dialog[open] [data-people="${garden.id}"]`); await sleep(800);
  check("the member has no list of accounts, only codes", await ev("!document.querySelector('dialog.dialog--people[open] .people__accounts') && Boolean(document.querySelector('dialog.dialog--people[open] [data-invite]'))"));
  await click("dialog.dialog--people[open] [data-invite]"); await sleep(1000);
  const code = await ev("document.querySelector('dialog.dialog--invite[open] .invite-code')?.textContent");
  check("an invitation code is shown once, XXXX-XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code || ""), code);
  check("…with its link", await ev(`document.querySelector('dialog.dialog--invite[open] .invite-link').value.endsWith("/#join=${(code || "").replace(/-/g, "")}")`));
  await shot("invite");
  for (let i = 0; i < 4; i++) await ev("document.querySelector('dialog[open]')?.close()");
  await click('[data-action="password"]'); await sleep(500);
  await ev(`(() => { const f = document.querySelector("dialog[open] form"); f.current.value = ${JSON.stringify(password)};
    f.next.value = "ola-own-password-1"; f.repeat.value = "ola-own-password-1"; f.requestSubmit(); })()`); await sleep(2000);
  check("the member changes the password", !(await ev("Boolean(document.querySelector('dialog[open]'))")) && (await call("/api/tasks")).status === 200);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.reload"); await sleep(2500);
  await shot("member-phone");
  await send("Emulation.clearDeviceMetricsOverride");
  await call("/api/auth/logout", "POST", {});

  // the owner opens the link signed out: after signing in, the code is checked and joining is one click
  await signIn("owner", "owner-test-password", `/#join=${code.replace(/-/g, "")}`);
  await sleep(1000);
  check("after signing in the link opens joining with the space shown", await ev("document.querySelector('dialog.dialog--join[open] .join-space strong')?.textContent === 'Ogród'"));
  await shot("join");
  await click("dialog.dialog--join[open] [data-join-submit]"); await sleep(1500);
  check("the owner joins the member's space", (await call("/api/spaces")).body.some(s => s.id === garden.id && !s.mine));
  check("the code is used up", (await call("/api/spaces/join/preview", "POST", { code })).status === 404);
  check("no console errors or exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
  check("test run", false, error.stack);
} finally {
  chrome.kill();
  console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
  process.exit(results.every(Boolean) ? 0 : 1);
}
