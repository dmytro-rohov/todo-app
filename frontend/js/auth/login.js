// Login screen, the same as Mytko Workflow's: password login plus "Zaloguj kontem Mytko".
import { request, ApiError } from "../api/http.js";
import { markWelcome } from "../startup.js";
import { escapeHtml } from "../utils/helpers.js";
import { LANG, setLang } from "../i18n.js";

const FEATURES = [
  { icon: "board", title: "Tablica, lista i kalendarz", text: "Cztery kolumny pracy, przeciąganie i kolejność jako priorytet." },
  { icon: "folder", title: "Przestrzenie i projekty", text: "Praca, prywatne i projekty klientów w osobnych folderach." },
  { icon: "clock", title: "Terminy i czas pracy", text: "Dziś, po terminie, najbliższe 7 dni i licznik czasu." }
];

const ICONS = {
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 6.7A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
};

export function icon(name, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function getSession() {
  return request("/api/auth/session");
}

export function logout() {
  return request("/api/auth/logout", { method: "POST", body: {} });
}

export function loginErrorMessage(error) {
  if (!(error instanceof ApiError)) return "Logowanie nie powiodło się. Spróbuj ponownie.";
  if (error.status === 401) return "Nieprawidłowy login lub hasło.";
  if (error.status === 429) return "Zbyt wiele nieudanych prób. Spróbuj ponownie za kilkanaście minut.";
  if (error.status === 400) return "Podaj login i hasło.";
  if (error.status === 0) return error.message;
  return "Logowanie nie powiodło się. Spróbuj ponownie.";
}

// Polish plural of hours, as on the Workflow login screen.
export function hours(seconds) {
  const value = Math.round(seconds / 3600);
  if (value % 24 === 0 && value >= 48) return `${value / 24} dni`;
  if (value === 1) return "1 godzinę";
  return `${value} ${value % 10 >= 2 && value % 10 <= 4 && (value < 10 || value > 20) ? "godziny" : "godzin"}`;
}

const SSO_NOTICES = {
  login_required: "Najpierw zaloguj się w Mytko Workflow w tej przeglądarce, potem kliknij ponownie „Zaloguj kontem Mytko”.",
  denied: "Konto Mytko nie ma dostępu do Mytko Tasks.",
  failed: "Logowanie kontem Mytko nie powiodło się. Spróbuj ponownie albo użyj loginu i hasła.",
  unavailable: "Mytko Workflow jest teraz niedostępny. Użyj loginu i hasła."
};

export const SSO_TRIED = "mytko-tasks-sso-tried";
// Set on logout in localStorage, so no tab of this browser signs back in automatically until the owner signs in
// again on purpose (password or the Mytko button).
export const SSO_OFF = "mytko-tasks-sso-off";

export function shouldTryMytko(state, search, storage, shared = null) {
  let tried = true;
  try { tried = storage.getItem(SSO_TRIED) === "1" || shared?.getItem(SSO_OFF) === "1"; } catch { /* storage blocked: never auto-redirect */ }
  return Boolean(state.mytkoAvailable) && !new URLSearchParams(search).has("sso") && !tried;
}

export function markLoggedOut() {
  try { sessionStorage.setItem(SSO_TRIED, "1"); localStorage.setItem(SSO_OFF, "1"); } catch { /* ignore */ }
}

function markSignedInOnPurpose() {
  try { localStorage.removeItem(SSO_OFF); } catch { /* ignore */ }
}

export function ssoNotice(search) {
  const code = new URLSearchParams(search).get("sso");
  return code && SSO_NOTICES[code] ? SSO_NOTICES[code] : null;
}

export function renderLogin(root, state, { notice = null, onAuthenticated }) {
  root.innerHTML = `
  <div class="auth">
    <section class="auth-hero" aria-label="Mytko Tasks">
      <div class="orbits orbits--login" aria-hidden="true">
        <span class="orbits__sphere orbits__sphere--a"></span>
        <span class="orbits__ring orbits__ring--outer"><i></i><i></i></span>
        <span class="orbits__ring orbits__ring--inner"><i></i><i></i></span>
      </div>
      <div class="auth-brand">
        <img class="auth-brand__tile" src="./icons/icon-192.png" alt="" width="86" height="86">
        <span><strong>Mytko</strong><span>Tasks</span></span>
      </div>
      <div class="auth-hero__copy">
        <p class="auth-hero__title">Od pomysłu <span>do zrobionego zadania</span></p>
        <p class="auth-hero__lead">Mytko Tasks to prywatna lista zadań: praca i sprawy prywatne, projekty klientów, terminy i czas pracy — w jednym miejscu, obok Mytko Workflow.</p>
        <ul class="auth-features">
          ${FEATURES.map(f => `<li><span class="auth-features__icon">${icon(f.icon)}</span><span><strong>${f.title}</strong><span>${f.text}</span></span></li>`).join("")}
        </ul>
      </div>
    </section>
    <main class="auth-panel">
      <div class="auth-card">
        <h1>Zaloguj się</h1>
        <p class="auth-card__lead">Masz aktywną sesję Mytko? Wejdziesz jednym kliknięciem. Sesja trwa ${hours(state.ttlSeconds)}.</p>
        ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}
        <button type="button" class="auth-quick" data-quick ${state.mytkoAvailable ? "" : `disabled title="${state.mytkoLogin ? "Mytko Workflow jest teraz niedostępny" : "Logowanie kontem Mytko nie jest skonfigurowane na serwerze"}" aria-describedby="auth-quick-off"`}>
          <img src="./icons/mytko-account.png" alt="" width="26" height="26"><span>Zaloguj kontem <strong>Mytko</strong></span>
        </button>
        ${state.mytkoAvailable ? "" : `<span id="auth-quick-off" class="visually-hidden">Niedostępne: ${state.mytkoLogin ? "Mytko Workflow nie odpowiada" : "logowanie kontem Mytko nie jest skonfigurowane"}. Użyj loginu i hasła.</span>`}
        <p class="auth-divider"><span>albo loginem i hasłem</span></p>
        <form class="auth-form" novalidate>
          <label for="auth-login">E-mail lub login</label>
          <input id="auth-login" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="auth-login-hint">
          <p id="auth-login-hint" class="auth-form__hint">Konto Mytko Tasks: login i hasło nadane przez operatora.</p>
          <label for="auth-password">Hasło</label>
          <div class="auth-password">
            <input id="auth-password" name="password" type="password" autocomplete="current-password">
            <button type="button" class="auth-password__toggle" aria-label="Pokaż hasło" aria-pressed="false" aria-controls="auth-password">${icon("eyeOff", 21)}</button>
          </div>
          <p class="auth-alert" role="alert" id="auth-error" hidden></p>
          <button type="submit" class="auth-submit">Zaloguj się</button>
        </form>
        <footer class="auth-card__foot">
          <p>Potrzebujesz dostępu? <button type="button" class="auth-link" aria-expanded="false" aria-controls="auth-help">Skontaktuj się z operatorem.</button></p>
          <p id="auth-help" class="auth-card__help" hidden>Mytko Tasks ma jedno konto właściciela, konfigurowane po stronie serwera. Nowych kont nie można tu utworzyć.</p>
          <p class="auth-lang" role="group" aria-label="Język" translate="no">${Object.entries({ pl: "PL", uk: "УКР" }).map(([value, label]) =>
            `<button type="button" data-lang="${value}" aria-pressed="${value === LANG}" lang="${value}">${label}</button>`).join("")}</p>
        </footer>
      </div>
    </main>
  </div>`;

  const form = root.querySelector(".auth-form");
  const loginField = form.querySelector("#auth-login");
  const passwordField = form.querySelector("#auth-password");
  const errorBox = form.querySelector("#auth-error");
  const submit = form.querySelector(".auth-submit");
  const toggle = form.querySelector(".auth-password__toggle");
  loginField.focus();

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    for (const field of [loginField, passwordField]) {
      if (message) field.setAttribute("aria-invalid", "true"); else field.removeAttribute("aria-invalid");
    }
  }

  toggle.addEventListener("click", () => {
    const visible = passwordField.type === "password";
    passwordField.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Ukryj hasło" : "Pokaż hasło");
    toggle.innerHTML = icon(visible ? "eye" : "eyeOff", 21);
  });

  root.querySelector(".auth-lang").addEventListener("click", event => {
    const lang = event.target.closest("[data-lang]")?.dataset.lang;
    if (lang && lang !== LANG) setLang(lang);
  });

  root.querySelector(".auth-link").addEventListener("click", event => {
    const help = root.querySelector("#auth-help");
    help.hidden = !help.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!help.hidden));
  });

  root.querySelector("[data-quick]").addEventListener("click", event => {
    markSignedInOnPurpose();
    event.currentTarget.disabled = true;
    event.currentTarget.querySelector("span").textContent = "Logowanie…";
    markWelcome();
    window.location.assign("/auth/mytko/start");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const login = loginField.value.trim();
    if (!login || !passwordField.value) {
      showError("Podaj login i hasło.");
      (login ? passwordField : loginField).focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Logowanie…";
    form.setAttribute("aria-busy", "true");
    try {
      const next = await request("/api/auth/login", { method: "POST", body: { login, password: passwordField.value } });
      markSignedInOnPurpose();
      onAuthenticated(next);
    } catch (error) {
      showError(loginErrorMessage(error));
      passwordField.value = "";
      passwordField.focus();
      submit.disabled = false;
      submit.textContent = "Zaloguj się";
      form.removeAttribute("aria-busy");
    }
  });
}
