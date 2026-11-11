// The start of every Mytko app (its js/main.js calls bootApp): the interface size and language, the session, then the
// login screen (or "Zaloguj kontem Mytko" without a click, where it was used before) or the app; the start-up screen
// from index.html until the first picture; the installable app's service worker. Expects #startup, #auth and #app in
// index.html (markup in the README).
//
// startApp(root, session) -> { ready }: the app itself (ready settles when its first picture is drawn).
// keepOffline: true keeps the signed-in account on this device ("mytko-<app>:user"), so without a connection the app
//   still opens with it (data it keeps itself, e.g. Fitness's workout in progress); forgotten whenever the server says
//   nobody is signed in (and by the app on logout: forgetOfflineUser()).
// beforeSession(): runs first (e.g. Finance keeps "#join=…" links for after signing in).
// afterLogin(): where the page goes after a password login (default: this path, without query or hash).
import { getSession, markMytkoUsed, renderLogin, shouldTryMytko, ssoKeys, ssoNotice } from "./login.js";
import { finishStartup, markWelcome, startupStep } from "./startup.js";
import { applyScale } from "./ui-scale.js";
import { LANG, t, translateStatic, useLang } from "./i18n.js";
import { escapeHtml } from "./helpers.js";
import { toast } from "./toast.js";
import { storageKey } from "./config.js";

// Browser storage can be blocked (the getter itself throws then): the app works without it.
function shared() {
  try { return localStorage; } catch { return null; }
}
function perTab() {
  try { return sessionStorage; } catch { return null; }
}
// Only an attempt that could be remembered is made (otherwise a failed one would repeat on every load).
function remember(storage, key) {
  try { storage.setItem(key, "1"); return true; } catch { return false; }
}

export function keptUser() {
  try {
    const user = JSON.parse(shared()?.getItem(storageKey("user")) || "null");
    return user && Number.isInteger(user.id) && typeof user.name === "string" ? user : null;
  } catch { return null; }
}
function keepUser(user) {
  try { user ? shared()?.setItem(storageKey("user"), JSON.stringify(user)) : shared()?.removeItem(storageKey("user")); } catch { /* online only then */ }
}
export function forgetOfflineUser() {
  keepUser(null);
}

function message(root, key) {
  root.innerHTML = `<p class="auth-offline" role="alert">${escapeHtml(t(key))} <a href="">${escapeHtml(t("offline.retry"))}</a></p>`;
}

export async function bootApp({ startApp, keepOffline = false, beforeSession = null, afterLogin = () => window.location.pathname }) {
  applyScale();
  useLang(LANG);
  translateStatic();

  const authRoot = document.querySelector("#auth");
  const appRoot = document.querySelector("#app");

  beforeSession?.();
  let state;
  try {
    state = await getSession();
  } catch (error) {
    const user = keepOffline && error.status === 0 ? keptUser() : null;
    if (user) {
      state = { authenticated: true, user, method: "password", offline: true };
    } else {
      finishStartup();
      authRoot.hidden = false;
      message(authRoot, "offline.text");
      return;
    }
  }
  if (keepOffline && !state.offline) {
    keepUser(state.authenticated ? { id: state.user.id, name: state.user.name, login: state.user.login, role: state.user.role, lang: state.user.lang } : null);
  }
  // The account's language wins over this device's.
  if (state.authenticated && state.user.lang !== LANG) {
    useLang(state.user.lang);
    translateStatic();
  }
  startupStep(1);
  if (!state.authenticated) {
    // Signed in to Mytko Workflow in this browser? Then this signs in here without a click (once per tab, so a failure
    // or a logout never loops).
    const tab = perTab();
    if (tab && shouldTryMytko(state, window.location.search, tab, shared()) && remember(tab, ssoKeys().tried)) {
      markWelcome();
      return window.location.assign("/auth/mytko/start");
    }
    authRoot.hidden = false;
    renderLogin(authRoot, state, {
      notice: ssoNotice(window.location.search),
      onAuthenticated: () => window.location.replace(afterLogin())
    });
    return finishStartup();
  }
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  if (state.method === "mytko") markMytkoUsed();
  window.addEventListener("mytko:session-ended", () => window.location.reload(), { once: true });
  appRoot.hidden = false;
  const app = startApp(appRoot, state);
  try {
    await app.ready;
  } catch (error) {
    // never a splash that waits forever: what went wrong, and "try again"
    console.error("startup failed", error);
    appRoot.hidden = true;
    authRoot.hidden = false;
    message(authRoot, "load.errorTitle");
    return finishStartup();
  }
  startupStep(2);
  finishStartup({ signedIn: true });
}

// Installable app (PWA): the worker (the app's /sw.js on top of sw-core.js) only keeps the app shell for offline /
// release moments, never API data. notifyUpdates (Fitness): a release reaches an app that stays open for days — looked
// for whenever it comes back to the front; when the new worker takes over, a toast offers to load the new version.
// notifyUpdates: false (Finance) only registers the worker.
export function registerServiceWorker(path = "/sw.js", { notifyUpdates = true } = {}) {
  if (!("serviceWorker" in navigator)) return;
  if (!notifyUpdates) {
    window.addEventListener("load", () => navigator.serviceWorker.register(path).catch(() => {}));
    return;
  }
  window.addEventListener("load", () => {
    const hadWorker = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register(path).then(registration => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });
    }, () => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadWorker) toast(t("app.updated"), { action: t("app.reload"), onAction: () => window.location.reload(), timeout: 60000 });
    });
  });
}
