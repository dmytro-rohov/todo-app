import { getSession, renderLogin, ssoNotice, shouldTryMytko, SSO_TRIED } from "./auth/login.js";

function shared() {
  try { return localStorage; } catch { return null; }
}
import { startApp } from "./app/app.js";

const authRoot = document.querySelector("#auth");
const appRoot = document.querySelector("#app");

async function start() {
  let state;
  try {
    state = await getSession();
  } catch {
    authRoot.hidden = false;
    authRoot.innerHTML = '<p class="auth-offline" role="alert">Brak połączenia z serwerem. <a href="">Spróbuj ponownie</a></p>';
    return;
  }
  if (!state.authenticated) {
    // Signed in to Mytko Workflow in this browser? Then this signs in here without a click (once per tab, so a
    // failure or a logout never loops).
    if (shouldTryMytko(state, window.location.search, sessionStorage, shared())) {
      sessionStorage.setItem(SSO_TRIED, "1");
      return window.location.assign("/auth/mytko/start");
    }
    authRoot.hidden = false;
    return renderLogin(authRoot, state, {
      notice: ssoNotice(window.location.search),
      onAuthenticated: () => window.location.replace(window.location.pathname)
    });
  }
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  window.addEventListener("mytko:session-ended", () => window.location.reload(), { once: true });
  appRoot.hidden = false;
  startApp(appRoot, state);
}

start();
