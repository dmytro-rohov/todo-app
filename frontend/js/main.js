import { getSession, markMytkoUsed, renderLogin, ssoKeys, ssoNotice, shouldTryMytko } from "./auth/login.js";

function shared() {
  try { return localStorage; } catch { return null; }
}
import { startApp } from "./app/app.js";
import { rememberJoinLink } from "./app/sharing.js";
import { finishStartup, markWelcome, startupStep, applyScale } from "../vendor/mytko-kit/js/ui.js";
import { startTranslation } from "./i18n.js";

applyScale();
startTranslation();

const authRoot = document.querySelector("#auth");
const appRoot = document.querySelector("#app");

async function start() {
  rememberJoinLink(); // "#join=CODE": kept for after signing in
  let state;
  try {
    state = await getSession();
  } catch {
    finishStartup();
    authRoot.hidden = false;
    authRoot.innerHTML = '<p class="auth-offline" role="alert">Brak połączenia z serwerem. <a href="">Spróbuj ponownie</a></p>';
    return;
  }
  startupStep(1);
  if (!state.authenticated) {
    // Signed in here with Mytko before, and to Mytko Workflow in this browser? Then this signs in here without a click
    // (once per tab, so a failure or a logout never loops; auth/login.js).
    if (shouldTryMytko(state, window.location.search, sessionStorage, shared())) {
      sessionStorage.setItem(ssoKeys().tried, "1");
      markWelcome();
      return window.location.assign("/auth/mytko/start");
    }
    authRoot.hidden = false;
    renderLogin(authRoot, state, {
      notice: ssoNotice(window.location.search),
      onAuthenticated: () => { markWelcome(); window.location.replace(window.location.pathname + (/^#join=/.test(window.location.hash) ? window.location.hash : "")); }
    });
    return finishStartup();
  }
  // a session from "Zaloguj kontem Mytko": this browser may sign in with it on its own next time (auth/login.js)
  if (state.method === "mytko") markMytkoUsed();
  // Back from Google after connecting a calendar (/auth/google/callback): say how it went.
  const calendar = new URLSearchParams(window.location.search).get("calendar");
  const CALENDAR_NOTICES = {
    connected: { text: "Kalendarz Google podłączony. Spotkania pojawią się za chwilę.", tone: "info" },
    denied: { text: "Nie udzielono dostępu do kalendarza.", tone: "error" },
    failed: { text: "Podłączenie kalendarza nie powiodło się. Spróbuj ponownie.", tone: "error" },
    login: { text: "Sesja wygasła w trakcie łączenia kalendarza. Zaloguj się i spróbuj ponownie.", tone: "error" }
  };
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  window.addEventListener("mytko:session-ended", () => window.location.reload(), { once: true });
  appRoot.hidden = false;
  const app = startApp(appRoot, state, { notice: CALENDAR_NOTICES[calendar] || null });
  await app.ready;
  startupStep(2);
  finishStartup({ signedIn: true });
}

start();

// Installable app (PWA): the worker only keeps the app shell for offline / release moments, never API data.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
