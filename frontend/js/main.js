import { getSession, logout, renderLogin, ssoNotice, shouldTryMytko, SSO_TRIED } from "./auth/login.js";
import { initBoard } from "./board.js";

const authRoot = document.querySelector("#auth");
const board = document.querySelector("#kanban");

function showLogin(state, notice) {
  board.hidden = true;
  authRoot.hidden = false;
  renderLogin(authRoot, state, { notice, onAuthenticated: () => window.location.replace(window.location.pathname) });
}

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
    if (shouldTryMytko(state, window.location.search, sessionStorage)) {
      sessionStorage.setItem(SSO_TRIED, "1");
      return window.location.assign("/auth/mytko/start");
    }
    return showLogin(state, ssoNotice(window.location.search));
  }
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname);

  window.addEventListener("mytko:session-ended", () => window.location.reload(), { once: true });
  authRoot.hidden = true;
  board.hidden = false;
  const out = document.createElement("button");
  out.type = "button";
  out.className = "session-logout";
  out.textContent = "Wyloguj";
  out.addEventListener("click", async () => {
    out.disabled = true;
    sessionStorage.setItem(SSO_TRIED, "1");
    await logout().catch(() => {});
    window.location.reload();
  });
  document.body.append(out);
  initBoard();
}

start();
