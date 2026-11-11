// Mytko Kit, frontend: the small interface parts every app shows — toasts, the start-up screen, the interface size and
// dialogs — one module, so a page load fetches one file for all of them (toast.js, startup.js, ui-scale.js and
// dialogs.js still work: each re-exports from here).
import { escapeHtml, paint, storageKey, t } from "./core.js";
import { icon } from "./icons.js";

// ---- toast.js ---------------------------------------------------------------------------------------------------------

// Short notices at the bottom, optionally with one action (e.g. undo).

let region = null;

export function toast(message, { tone = "info", action = null, onAction = null, timeout = 6000 } = {}) {
  if (!region) {
    region = document.createElement("div");
    region.className = "toasts";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  item.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action)}</button>` : ""}`;
  const close = () => item.remove();
  item.querySelector("button")?.addEventListener("click", () => { close(); onAction?.(); });
  region.append(item);
  // at most three: plain notices go first, so a burst of errors does not take away a "Cofnij" still on screen
  while (region.children.length > 3) ([...region.children].find(child => !child.querySelector("button")) || region.firstElementChild).remove();
  setTimeout(close, timeout);
}

// ---- startup.js -------------------------------------------------------------------------------------------------------

// The start-up screen from index.html (as in Mytko Workflow; markup in the README). The bar fills by real steps; the
// screen stays at least a moment after a reload and about five and a half seconds right after signing in (a welcome),
// then fades out. Signing in marks the welcome in sessionStorage ("mytko-<app>:welcome") before the page reloads.

const WELCOME_MS = 5500;
const RELOAD_MS = 1200;
const WELCOME_VALID_MS = 120000;
const FADE_MS = 450;
const READY_MS = 900; // "ready" shows for the last moment only
const LABELS = ["startup.session", "startup.loading", "startup.preparing", "startup.ready"];

// Looked up when used: the module is also imported where there is no page (unit tests of the login screen).
const startupScreen = () => (typeof document === "undefined" ? null : document.querySelector("#startup"));

export function markWelcome() {
  try { sessionStorage.setItem(storageKey("welcome"), String(Date.now())); } catch { /* no storage: a short screen */ }
}

// True once, right after signing in.
function takeWelcome() {
  try {
    const at = Number(sessionStorage.getItem(storageKey("welcome")));
    sessionStorage.removeItem(storageKey("welcome"));
    return at > 0 && Date.now() - at < WELCOME_VALID_MS;
  } catch { return false; }
}

// Marks `done` steps finished (0–3).
export function startupStep(done) {
  const screen = startupScreen();
  if (!screen) return;
  const bar = screen.querySelector(".startup__bar");
  bar.dataset.done = String(done);
  bar.setAttribute("aria-valuenow", String(done));
  screen.querySelector(".startup__status").textContent = t(LABELS[Math.min(done, LABELS.length - 1)]);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Waits out the minimum time (counted from the page load), then fades the screen out. `signedIn`: the app opens (a
// welcome after signing in lasts longer); otherwise the login screen is shown at once.
export async function finishStartup({ signedIn = false } = {}) {
  const screen = startupScreen();
  if (!screen) return;
  const minimum = signedIn ? (takeWelcome() ? WELCOME_MS : RELOAD_MS) : 0;
  if (signedIn) {
    await sleep(Math.max(0, minimum - READY_MS - performance.now()));
    startupStep(3);
  }
  await sleep(Math.max(0, minimum - performance.now()));
  screen.removeAttribute("aria-busy");
  screen.removeAttribute("role");
  screen.setAttribute("aria-hidden", "true");
  screen.classList.add("startup--leaving");
  await sleep(FADE_MS);
  screen.hidden = true;
}

// ---- ui-scale.js ------------------------------------------------------------------------------------------------------

// Interface size (Settings → interface size): every size in the stylesheet is in rem, so one number scales everything.
// "auto" keeps the stylesheet's default (75% on computers, 70% on phones); a chosen size is kept on this device only
// ("mytko-<app>:ui-scale").

const KEY = () => storageKey("ui-scale");
export const SCALES = ["auto", "0.7", "0.8", "0.9", "1"];

export function savedScale() {
  try {
    const value = localStorage.getItem(KEY());
    return SCALES.includes(value) ? value : "auto";
  } catch { return "auto"; }
}

export function applyScale(value = savedScale()) {
  const root = document.documentElement;
  if (value === "auto") root.style.removeProperty("--ui-scale");
  else root.style.setProperty("--ui-scale", value);
}

export function saveScale(value) {
  try {
    if (value === "auto") localStorage.removeItem(KEY());
    else localStorage.setItem(KEY(), value);
  } catch { /* storage unavailable: the size lasts until the page is reloaded */ }
  applyScale(value);
}

// px per rem / 16: the effective scale, for the few places that need CSS pixels (scroll positions).
export function uiScale() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}

// ---- dialogs.js -------------------------------------------------------------------------------------------------------

// Modal dialogs on the native <dialog> (bottom sheets on phones): the shared helper, confirmations and the helpers of
// the forms inside them.

let titleCount = 0;
export function dialog(className, html) {
  const element = document.createElement("dialog");
  element.className = `dialog ${className}`;
  element.innerHTML = html;
  // the title (dialogHead) is the dialog's accessible name
  const title = element.querySelector(".dialog__head h2");
  if (title && !element.hasAttribute("aria-labelledby")) {
    title.id = `dialog-title-${++titleCount}`;
    element.setAttribute("aria-labelledby", title.id);
  }
  document.body.append(element);
  element.addEventListener("close", () => element.remove());
  // The backdrop closes the dialog only when the press started there too: selecting text in a field and letting go
  // outside the dialog must not throw the typed data away.
  let pressedBackdrop = false;
  element.addEventListener("pointerdown", event => { pressedBackdrop = event.target === element; });
  element.addEventListener("click", event => {
    if ((event.target === element && pressedBackdrop) || event.target.closest("[data-close]")) element.close();
    pressedBackdrop = false;
  });
  paint(element);
  element.showModal();
  return element;
}

// Resolves true when confirmed; the cancel button has the focus, so Enter never confirms by accident. The question is
// the dialog's accessible name.
let confirmCount = 0;
export function confirmDialog(message, confirmLabel) {
  return new Promise(resolve => {
    const id = `confirm-${++confirmCount}`;
    const element = dialog("dialog--confirm", `<form method="dialog" class="dialog__body">
        <p class="dialog__message" id="${id}">${escapeHtml(message)}</p>
        <div class="dialog__actions">
          <button type="submit" value="cancel" class="btn btn--ghost">${escapeHtml(t("common.cancel"))}</button>
          <button type="submit" value="ok" class="btn btn--danger">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`);
    element.setAttribute("aria-labelledby", id);
    element.querySelector('[value="cancel"]').focus();
    // decided by the button pressed (the submit comes at once; a hidden page may hold the "close" event back), or by
    // closing the dialog any other way (Escape, the backdrop): not confirmed
    let settled = false;
    const settle = value => { if (!settled) { settled = true; resolve(value); } };
    element.querySelector("form").addEventListener("submit", event => settle(event.submitter?.value === "ok"));
    element.addEventListener("close", () => settle(element.returnValue === "ok"));
  });
}

// A dialog's title row with the close button.
export const dialogHead = title => `<header class="dialog__head"><h2>${escapeHtml(title)}</h2>
  <button type="button" class="icon-btn" data-close aria-label="${escapeHtml(t("common.close"))}">${icon("x")}</button></header>`;

// Runs one request for a form at a time: the submit button stays disabled until it ends (no double submit).
export async function busy(form, run) {
  const submit = form.querySelector("[type=submit]");
  if (submit.disabled) return;
  submit.disabled = true;
  try { await run(); } finally { submit.disabled = false; }
}

// The form's error box ([data-error]).
export function formError(form) {
  const box = form.querySelector("[data-error]");
  return {
    show(message) { box.textContent = message; box.hidden = false; },
    hide() { box.hidden = true; }
  };
}
