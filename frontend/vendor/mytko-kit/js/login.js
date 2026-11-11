// Login screen, the same in every Mytko app and as Mytko Workflow's: the brand on the left (the app's logo, name, lead
// and three features); on the right "Zaloguj kontem Mytko" (the session of Mytko Workflow, shared by the Mytko apps) and
// the login form. Accounts are created by the administrator; there is no sign-up.
import { request, ApiError } from "./http.js";
import { markWelcome } from "./startup.js";
import { escapeHtml } from "./helpers.js";
import { LANG, t, useLang } from "./i18n.js";
import { iconPx as icon } from "./icons.js";
import { appInfo } from "./config.js";

const MYTKO_ACCOUNT = new URL("../assets/mytko-account.png", import.meta.url).href;
const LOGO = "./icons/icon-192.png"; // every app's own logo tile, next to its index.html

export function getSession() {
  return request("/api/auth/session");
}

export function loginErrorMessage(error) {
  if (!(error instanceof ApiError)) return t("login.error.failed");
  if (error.status === 401) return t("login.error.invalid");
  if (error.status === 429) return t("login.error.locked");
  if (error.status === 400) return t("login.error.empty");
  if (error.status === 0) return error.message;
  return t("login.error.failed");
}

// How long a session lasts, in words: whole days from two days up, else hours.
export function duration(seconds) {
  const hours = Math.round(seconds / 3600);
  if (hours % 24 === 0 && hours >= 48) return t("duration.days", { count: hours / 24 });
  return t("duration.hours", { count: hours });
}

// Notices after "Zaloguj kontem Mytko" came back without a session (/?sso=<reason>, backend routes/sso.js).
const SSO_REASONS = ["login_required", "denied", "failed", "unavailable"];

export function ssoNotice(search) {
  const code = new URLSearchParams(search).get("sso");
  return SSO_REASONS.includes(code) ? t(`sso.${code}`) : null;
}

// Storage keys of the automatic "Zaloguj kontem Mytko" ("mytko-<app>-sso-…"):
//   tried  sessionStorage: this tab tried it already (never twice, so a failure or a logout never loops)
//   used   localStorage: this browser has been signed in with it (only such a browser tries it on its own: a member
//          account, which never signs in through Workflow, is not sent there)
//   off    localStorage: set on logout, so no tab of this browser signs back in automatically until someone signs in
//          again on purpose (password or the Mytko button)
export function ssoKeys() {
  const prefix = `mytko-${appInfo().id}-sso`;
  return { tried: `${prefix}-tried`, used: `${prefix}-used`, off: `${prefix}-off` };
}

// Signed in here with Mytko before? Then the app tries "Zaloguj kontem Mytko" without a click, once per tab and never
// after a logout or a failed attempt (?sso=…).
export function shouldTryMytko(state, search, storage, shared = null) {
  const keys = ssoKeys();
  let tried = true;
  try {
    tried = storage.getItem(keys.tried) === "1" || shared?.getItem(keys.off) === "1" || shared?.getItem(keys.used) !== "1";
  } catch { /* storage blocked: never auto-redirect */ }
  return Boolean(state.mytkoAvailable) && !new URLSearchParams(search).has("sso") && !tried;
}

export function markLoggedOut() {
  const keys = ssoKeys();
  try { sessionStorage.setItem(keys.tried, "1"); localStorage.setItem(keys.off, "1"); localStorage.removeItem(keys.used); } catch { /* ignore */ }
}

// After a session that came from "Zaloguj kontem Mytko" (boot.js).
export function markMytkoUsed() {
  try { localStorage.setItem(ssoKeys().used, "1"); } catch { /* no automatic Mytko sign-in on this device then */ }
}

function markSignedInOnPurpose() {
  try { localStorage.removeItem(ssoKeys().off); } catch { /* ignore */ }
}

export function renderLogin(root, state, { onAuthenticated, notice = null }) {
  const app = appInfo();
  const mytkoOff = state.mytkoLogin ? t("login.mytkoDown") : t("login.mytkoUnset");
  root.innerHTML = `
  <div class="auth">
    <section class="auth-hero" aria-label="${escapeHtml(app.name)}">
      <div class="orbits orbits--login" aria-hidden="true">
        <span class="orbits__sphere orbits__sphere--a"></span>
        <span class="orbits__ring orbits__ring--outer"><i></i><i></i></span>
        <span class="orbits__ring orbits__ring--inner"><i></i><i></i></span>
      </div>
      <div class="auth-brand">
        <img class="auth-brand__tile" src="${LOGO}" alt="" width="86" height="86">
        <span><strong>Mytko</strong><span>${escapeHtml(app.short)}</span></span>
      </div>
      <div class="auth-hero__copy">
        <p class="auth-hero__title">${escapeHtml(t("hero.title"))} <span>${escapeHtml(t("hero.titleAccent"))}</span></p>
        <p class="auth-hero__lead">${escapeHtml(t("hero.lead"))}</p>
        <ul class="auth-features">
          ${app.features.map(f => `<li><span class="auth-features__icon">${icon(f.icon)}</span><span><strong>${escapeHtml(t(`${f.key}.title`))}</strong><span>${escapeHtml(t(`${f.key}.text`))}</span></span></li>`).join("")}
        </ul>
      </div>
    </section>
    <main class="auth-panel">
      <div class="auth-card">
        <h1>${escapeHtml(t("login.title"))}</h1>
        <p class="auth-card__lead">${escapeHtml(t(state.mytkoLogin ? "login.leadMytko" : "login.lead", { duration: duration(state.ttlSeconds) }))}</p>
        ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}
        <button type="button" class="auth-quick" data-quick ${state.mytkoAvailable ? "" : `disabled title="${escapeHtml(mytkoOff)}" aria-describedby="auth-quick-off"`}>
          <img src="${escapeHtml(MYTKO_ACCOUNT)}" alt="" width="26" height="26"><span>${escapeHtml(t("login.mytko"))} <strong>Mytko</strong></span>
        </button>
        ${state.mytkoAvailable ? "" : `<span id="auth-quick-off" class="visually-hidden">${escapeHtml(t("login.mytkoOff", { reason: mytkoOff }))}</span>`}
        <p class="auth-divider"><span>${escapeHtml(t("login.divider"))}</span></p>
        <form class="auth-form" novalidate>
          <label for="auth-login">${escapeHtml(t("login.login"))}</label>
          <input id="auth-login" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="auth-login-hint">
          <p id="auth-login-hint" class="auth-form__hint">${escapeHtml(t("login.loginHint"))}</p>
          <label for="auth-password">${escapeHtml(t("login.password"))}</label>
          <div class="auth-password">
            <input id="auth-password" name="password" type="password" autocomplete="current-password">
            <button type="button" class="auth-password__toggle" aria-label="${escapeHtml(t("login.show"))}" aria-pressed="false" aria-controls="auth-password">${icon("eyeOff", 21)}</button>
          </div>
          <p class="auth-alert" role="alert" id="auth-error" hidden></p>
          <button type="submit" class="auth-submit">${escapeHtml(t("login.submit"))}</button>
        </form>
        <footer class="auth-card__foot">
          <p>${escapeHtml(t("login.needAccess"))} <button type="button" class="auth-link" aria-expanded="false" aria-controls="auth-help">${escapeHtml(t("login.helpLink"))}</button></p>
          <p id="auth-help" class="auth-card__help" hidden>${escapeHtml(t("login.help"))}${app.contact ? ` ${escapeHtml(t("login.helpMail"))}
            <a class="auth-link" href="mailto:${escapeHtml(app.contact)}?subject=${escapeHtml(encodeURIComponent(t("login.mailSubject")))}">${escapeHtml(app.contact)}</a>` : ""}</p>
          <p class="auth-lang" role="group" aria-label="${escapeHtml(t("login.language"))}">${Object.entries({ uk: "УКР", pl: "PL" }).map(([value, label]) =>
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
    toggle.setAttribute("aria-label", t(visible ? "login.hide" : "login.show"));
    toggle.innerHTML = icon(visible ? "eye" : "eyeOff", 21);
  });

  // The language of the login screen: remembered on this device; after signing in the account's own language wins.
  root.querySelector(".auth-lang").addEventListener("click", event => {
    const lang = event.target.closest("[data-lang]")?.dataset.lang;
    if (!lang || lang === LANG) return;
    const typed = loginField.value;
    useLang(lang);
    renderLogin(root, state, { onAuthenticated, notice: notice && ssoNotice(window.location.search) });
    root.querySelector("#auth-login").value = typed;
  });

  root.querySelector("[data-quick]").addEventListener("click", event => {
    markSignedInOnPurpose();
    event.currentTarget.disabled = true;
    event.currentTarget.querySelector("span").textContent = t("login.submitting");
    markWelcome();
    window.location.assign("/auth/mytko/start");
  });

  root.querySelector(".auth-link").addEventListener("click", event => {
    const help = root.querySelector("#auth-help");
    help.hidden = !help.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!help.hidden));
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const login = loginField.value.trim();
    if (!login || !passwordField.value) {
      showError(t("login.error.empty"));
      (login ? passwordField : loginField).focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = t("login.submitting");
    form.setAttribute("aria-busy", "true");
    try {
      const next = await request("/api/auth/login", { method: "POST", body: { login, password: passwordField.value } });
      markSignedInOnPurpose();
      // signed in with a password: no automatic "Zaloguj kontem Mytko" here later (it may be another person's phone)
      try { localStorage.removeItem(ssoKeys().used); } catch { /* ignore */ }
      markWelcome();
      onAuthenticated(next);
    } catch (error) {
      showError(loginErrorMessage(error));
      passwordField.value = "";
      passwordField.focus();
      submit.disabled = false;
      submit.textContent = t("login.submit");
      form.removeAttribute("aria-busy");
    }
  });
}
