// The blocks of the Settings / Profile view that every Mytko app has: the account (how it signed in, a member's own
// password, logging out), the interface language (kept on the account) and the interface size (kept on this device).
// The app's click handling: data-password (accounts.js openPassword), data-logout; change events on name="lang"
// (PATCH /api/me, then useLang) and name="scale" (ui-scale.js saveScale).
import { escapeHtml } from "./helpers.js";
import { LANG, LANGUAGES, t } from "./i18n.js";
import { SCALES, savedScale } from "./ui-scale.js";
import { icon } from "./icons.js";
import { initialsAvatar } from "./shell.js";

const CODES = { uk: "УКР", pl: "PL" };

// The language radio cards; row: side by side (forms).
export function languageOptions(name, selected = LANG, { row = false } = {}) {
  return `<div class="scale-options${row ? " scale-options--row" : ""}" role="radiogroup" aria-label="${escapeHtml(t("settings.language"))}">${Object.entries(LANGUAGES).map(([value, label]) =>
    `<label class="check" lang="${value}"><input type="radio" name="${name}" value="${value}"${value === selected ? " checked" : ""}>${label}<span class="scale-options__code">${CODES[value]}</span></label>`).join("")}</div>`;
}

// method: how this session signed in ("password" or "mytko"). avatar: the account's badge HTML (default: initials);
// buttons: the app's own buttons, before "change password" / "log out".
export function accountBlock(user, method = "password", { avatar = null, buttons = "" } = {}) {
  return `<section class="settings-block">
        <h2 class="settings-block__title">${icon("user")}${escapeHtml(t("settings.account"))}</h2>
        <div class="account">
          ${avatar ?? initialsAvatar(user, "avatar--lime avatar--lg")}
          <div class="account__text"><strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(t("settings.login"))}: <b>${escapeHtml(user.login)}</b></span></div>
          <span class="chip chip--role">${escapeHtml(t(`role.${user.role}`))}</span>
        </div>
        <p class="settings-block__note">${escapeHtml(t(`settings.method.${method === "mytko" ? "mytko" : "password"}`))}${user.role === "admin" ? ` · ${escapeHtml(t("settings.adminPassword"))}` : ""}</p>
        <div class="settings-block__buttons">
          ${buttons}${user.role === "admin" ? "" : `<button type="button" class="btn btn--ghost" data-password>${icon("key")}<span>${escapeHtml(t("settings.changePassword"))}</span></button>`}
          <button type="button" class="btn btn--ghost" data-logout>${icon("logout")}<span>${escapeHtml(t("settings.logout"))}</span></button>
        </div>
      </section>`;
}

export function languageBlock() {
  return `<section class="settings-block">
        <h2 class="settings-block__title">${icon("globe")}${escapeHtml(t("settings.language"))}</h2>
        <p class="settings-block__note">${escapeHtml(t("settings.languageHint"))}</p>
        ${languageOptions("lang")}
      </section>`;
}

export function scaleBlock() {
  const scale = savedScale();
  const label = value => (value === "auto" ? t("settings.scale.auto") : `${Math.round(Number(value) * 100)}%`);
  return `<section class="settings-block">
        <h2 class="settings-block__title">${icon("sliders")}${escapeHtml(t("settings.scale"))}</h2>
        <p class="settings-block__note">${escapeHtml(t("settings.scaleHint"))}</p>
        <div class="scale-options" role="radiogroup" aria-label="${escapeHtml(t("settings.scale"))}">${SCALES.map(value =>
          `<label class="check"><input type="radio" name="scale" value="${value}"${value === scale ? " checked" : ""}>${escapeHtml(label(value))}</label>`).join("")}</div>
      </section>`;
}
