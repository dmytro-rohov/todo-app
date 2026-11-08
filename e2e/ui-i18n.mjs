// Browser check of the Ukrainian interface (e2e/ui-run.sh … app with CALENDAR=1 MAIL=1 TEST=e2e/ui-i18n.mjs): the
// language switch, Ukrainian texts and dates in every view, content people wrote left as written, and back to Polish.
// LEFTOVERS=1 also lists every interface text still in Polish (for completing the dictionary).
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
// SHOTS=/dir saves screenshots of the Ukrainian views there.
const shot = async name => { if (!process.env.SHOTS) return;
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  (await import("node:fs")).writeFileSync(`${process.env.SHOTS}/uk-${name}.png`, Buffer.from(result.data, "base64")); };
const text = selector => ev(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`);
// Interface texts still in Polish: Polish letters or common Polish words, outside content people wrote.
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(i|w|z|do|na|nie|jest|się|lub|oraz|Dodaj|Usuń|Zadania|zadania|Brak|Nowy|Nowa|Nowe|Otwórz|Zamknij|Zapisz|Anuluj|Szukaj|Termin|Projekt|Klient|Spotkanie|Wszystkie)\b/;
const leftovers = new Map();
async function collect(where) {
  const found = await ev(`(() => {
    const re = ${POLISH};
    const out = [];
    const prot = el => el.closest('[translate="no"], .card__title, .row__title, .agenda__title, .subtasks span, .notes p, .event, .week__event span, .client-row > span, .chip--client, .chip--project, .chip--label, [data-action="scope"].nav-item--sub > span, [data-action="client-scope"] > span, .crumb:not(.crumb--home), .account__text strong, .mail-row__from, .mail-row__subject, .mail-row__snippet, .mail__reader h2, .mail__from strong, .mail__body, .mail-proposals, .brief__section > p, .timer-dock__text strong, .popover__item > span:last-child, textarea, option, input, .nav-item--space span, .brief__meta, .dialog__head h2 .client-dot');
    const visible = el => el.getClientRects().length > 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const s = n.data.trim(); const el = n.parentElement;
      if (s && re.test(s) && el && !["SCRIPT", "STYLE"].includes(el.tagName) && !prot(el) && visible(el)) out.push(s);
    }
    for (const el of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
      if (!visible(el) || el.closest('[translate="no"]')) continue;
      // a label that already reads in Ukrainian only carries a title as written; meetings' tooltips are their titles
      if (el.closest(".event, .week__event")) continue;
      for (const a of ["title", "aria-label", "placeholder"]) { const v = el.getAttribute(a); if (v && re.test(v) && !/[А-Яа-яІіЇїЄєҐґ]/.test(v)) out.push(a + "=" + v); }
    }
    return out;
  })()`);
  for (const s of found || []) if (!leftovers.has(s)) leftovers.set(s, where);
  return found || [];
}
try {
  const today = new Date().toISOString().slice(0, 10);
  const dom = await api("/api/tasks", "POST", { title: "Dom", date: today, priority: "P1" });
  const kept = await api("/api/tasks", "POST", { title: "Usuń stare pliki z dysku", date: today });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
  check("Polish by default", await ev(`document.documentElement.lang`) === "pl" && await text('[data-action="new-task"]') === "Nowe zadanie", await text('[data-action="new-task"]'));

  await click('[data-action="language"]');
  check("the language dialog lists Polski and Українська", await ev(`[...document.querySelectorAll('dialog[open] [name="lang"]')].map(i => i.parentElement.textContent.trim()).join("|")`) === "Polski|Українська");
  await click('dialog[open] [name="lang"][value="uk"]'); await sleep(3500);
  check("after choosing Українська the page is in Ukrainian", await ev(`document.documentElement.lang`) === "uk", await ev("document.documentElement.lang"));
  check("buttons are translated", await text('[data-action="new-task"]') === "Нове завдання", await text('[data-action="new-task"]'));
  check("board columns are translated", await ev(`[...document.querySelectorAll('.column__head h2, .column h2')].map(h => h.textContent.trim()).join("|")`).then(v => /До виконання/.test(v) && /В роботі/.test(v)),
    await ev(`[...document.querySelectorAll('.column__head h2, .column h2')].map(h => h.textContent.trim()).join("|")`));
  check("a task titled “Dom” stays as written", await text(`.card[data-id="${dom.id}"] .card__title`) === "Dom", `${dom.id} ${await text(`.card[data-id="${dom.id}"] .card__title`)}`);
  check("a task titled like a button label stays as written", await text(`.card[data-id="${kept.id}"] .card__title`) === "Usuń stare pliki z dysku");
  check("its buttons are labelled in Ukrainian, with the title as written",
    await ev(`document.querySelector('.card[data-id="${kept.id}"] [data-card="timer-start"]').getAttribute("aria-label")`) === "Почати роботу: Usuń stare pliki z dysku");
  check("priorities are translated", await text(`.card[data-id="${dom.id}"] .chip--p1`) === "Високий", await text(`.card[data-id="${dom.id}"] .chip--p1`));
  check("the setting shows УКР", await text('[data-action="language"] em') === "УКР");
  await collect("board"); await shot("board");

  for (const [hash, name] of [["list", "list"], ["calendar", "calendar"], ["archive", "archive"], ["mail", "mail"]]) {
    await send("Page.navigate", { url: `${BASE}/#${hash}` }); await sleep(2500);
    await collect(name);
  }
  await send("Page.navigate", { url: `${BASE}/#calendar` }); await sleep(2500);
  const month = await ev(`document.querySelector('.calendar h2, .calendar__head h2')?.textContent.trim()`);
  check("calendar month in Ukrainian", /^(Січень|Лютий|Березень|Квітень|Травень|Червень|Липень|Серпень|Вересень|Жовтень|Листопад|Грудень) \d{4}$/.test(month || ""), month);
  check("weekdays in Ukrainian", await ev(`[...document.querySelectorAll('.calendar__weekday')].map(d => d.textContent).join(" ")`) === "Пн Вт Ср Чт Пт Сб Нд");
  await shot("calendar"); await click('[data-mode="week"]'); await collect("calendar week");

  await send("Page.navigate", { url: `${BASE}/#mail` }); await sleep(3000);
  if (await ev(`!!document.querySelector('.mail-row')`)) { await click('.mail-row'); await sleep(1500); await collect("mail reader"); }

  await send("Page.navigate", { url: `${BASE}/#task-${dom.id}` }); await sleep(2500);
  await collect("task drawer"); await shot("drawer");
  check("drawer labels in Ukrainian", /Опис/.test(await ev(`document.querySelector('.drawer')?.textContent`) || ""));
  await send("Page.navigate", { url: `${BASE}/` }); await sleep(2500);
  await click('[data-action="new-task"]'); await collect("new task"); await shot("new-task"); await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }); await sleep(400);
  for (const tab of ["spaces", "projects", "categories", "assignees", "clients"]) {
    const has = await ev(`!!document.querySelector('[data-action="manage"][data-tab="${tab}"]')`);
    if (!has) continue;
    await click(`[data-action="manage"][data-tab="${tab}"]`); await collect(`manage ${tab}`);
    await ev(`document.querySelector('dialog[open]')?.close()`); await sleep(300);
  }
  if (await ev(`!!document.querySelector('[data-action="accounts"]')`)) { await click('[data-action="accounts"]'); await collect("accounts"); await ev(`document.querySelector('dialog[open]')?.close()`); }
  await click('[data-action="ui-scale"]'); await collect("scale"); await ev(`document.querySelector('dialog[open]')?.close()`);
  await click('[data-action="notifications"], .bell'); await collect("notifications");
  await send("Page.navigate", { url: `${BASE}/#mail` }); await sleep(3000); await shot("mail");

  await send("Page.navigate", { url: `${BASE}/` }); await sleep(2500);
  await click('[data-action="language"]'); await click('dialog[open] [name="lang"][value="pl"]'); await sleep(3500);
  check("back to Polish", await ev(`document.documentElement.lang`) === "pl" && await text('[data-action="new-task"]') === "Nowe zadanie",
    `${await ev("document.documentElement.lang")} ${await text('[data-action="new-task"]')} ${await ev("localStorage.getItem('mytko-tasks:lang')")}`);
  check("no script errors", errors.length === 0, errors.join(" | "));
  if (process.env.LEFTOVERS) for (const [s, where] of leftovers) console.log(`LEFT [${where}] ${s}`);
  else check("no interface text left in Polish", leftovers.size === 0, [...leftovers.keys()].slice(0, 12).join(" | "));
} catch (error) { check("run", false, error.stack); } finally { chrome.kill(); }
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
