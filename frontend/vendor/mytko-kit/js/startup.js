// The start-up screen from index.html (as in Mytko Workflow; markup in the README). The bar fills by real steps; the
// screen stays at least a moment after a reload and about five and a half seconds right after signing in (a welcome),
// then fades out. Signing in marks the welcome in sessionStorage ("mytko-<app>:welcome") before the page reloads.
import { t } from "./i18n.js";
import { storageKey } from "./config.js";

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
