// Accounts, the same in every Mytko app. The administrator creates accounts for other people, e.g. a partner: a login,
// a start password and the interface language; later a new password, blocking and deleting. A member changes their own
// password here too. The administrator's own account is configured on the server.
//
// An app with more account fields (e.g. Finance: a label, the "Praca" module, photos) passes options to bindAccounts:
//   avatar(user, isAdmin)   the badge HTML (default: initials)
//   label(user)             the name in titles and notices (default: user.name; Finance: "Anna (mama)")
//   nameExtra(user)         HTML after the name in the list
//   chips(user)             HTML after the role and language chips, before "blocked" (Finance: the "Praca" chip)
//   fields.afterIdentity(user | null), fields.afterLanguage(user | null)
//                           HTML of more form fields (null: the new-account form)
//   read(form, user | null) those fields' values, merged into the request body
//   bind(form, user | null) wires those fields once the form is open (Finance: the "Praca" switch follows the currency)
import { authApi as api } from "./http.js";
import { escapeHtml, initials } from "./helpers.js";
import { LANG, LOCALE, t } from "./i18n.js";
import { icon } from "./icons.js";
import { busy, confirmDialog, dialog, dialogHead as head, formError } from "./dialogs.js";
import { toast } from "./toast.js";
import { languageOptions as languageCards } from "./settings.js";

export const PASSWORD_MIN = 12;

// A readable random password (no look-alike characters): 16 characters in groups of four.
export function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}

const when = iso => (iso ? new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("accounts.never"));

const languageOptions = (name, selected) => languageCards(name, selected, { row: true });

const NO_OPTIONS = {};
function hooks(options = NO_OPTIONS) {
  return {
    avatar: options.avatar ?? ((user, isAdmin) => `<span class="avatar${isAdmin ? " avatar--lime" : ""}">${escapeHtml(initials(user.name))}</span>`),
    label: options.label ?? (user => user.name),
    nameExtra: options.nameExtra ?? (() => ""),
    chips: options.chips ?? (() => ""),
    afterIdentity: options.fields?.afterIdentity ?? (() => ""),
    afterLanguage: options.fields?.afterLanguage ?? (() => ""),
    read: options.read ?? (() => ({})),
    bind: options.bind ?? (() => {})
  };
}

function passwordField(label, hint) {
  return `<label class="field"><span>${escapeHtml(label)}</span>
    <span class="password-row">
      <input name="password" type="password" maxlength="200" required autocomplete="new-password" spellcheck="false" autocapitalize="none">
      <button type="button" class="icon-btn icon-btn--box" data-toggle-password aria-label="${escapeHtml(t("login.show"))}" aria-pressed="false">${icon("eye")}</button>
      <button type="button" class="btn btn--ghost" data-generate>${icon("sparkles", 18)}<span>${escapeHtml(t("accounts.form.generate"))}</span></button>
    </span>
    <small class="field__hint">${escapeHtml(hint)}</small></label>`;
}

// The password field's eye and "generate" buttons; a generated password stays visible so it can be passed on.
function bindPassword(form) {
  const input = form.elements.password;
  const toggle = form.querySelector("[data-toggle-password]");
  const show = visible => {
    input.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", t(visible ? "login.hide" : "login.show"));
    toggle.innerHTML = icon(visible ? "eyeOff" : "eye");
  };
  toggle.addEventListener("click", () => show(input.type === "password"));
  form.querySelector("[data-generate]").addEventListener("click", () => {
    input.value = generatePassword();
    show(true);
    input.select();
  });
}

// ---- the list in Settings (administrator) ------------------------------------------------------------------------
export function accountsBlock() {
  return `<section class="settings-block" data-accounts>
    <div class="settings-block__head">
      <h2 class="settings-block__title">${icon("users")}${escapeHtml(t("settings.accounts"))}</h2>
      <button type="button" class="btn btn--primary btn--sm" data-account-new>${icon("plus", 18)}<span>${escapeHtml(t("accounts.add"))}</span></button>
    </div>
    <p class="settings-block__note">${escapeHtml(t("accounts.hint"))}</p>
    <ul class="accounts" data-account-list><li class="muted">${escapeHtml(t("accounts.loading"))}</li></ul>
  </section>`;
}

// One account in the list (exported for tests: accountRow(user, me, options)).
export function accountRow(user, me, options = NO_OPTIONS) {
  const app = hooks(options);
  const isAdmin = user.role === "admin";
  const meta = [t("accounts.login", { login: user.login }), t("accounts.lastLogin", { when: when(user.lastLoginAt) })];
  return `<li class="account-row${user.disabledAt ? " is-disabled" : ""}" data-account="${user.id}">
    ${app.avatar(user, isAdmin)}
    <span class="account-row__text">
      <strong>${escapeHtml(user.name)}${app.nameExtra(user)}${user.id === me.id ? ` <span class="account-row__me">(${escapeHtml(t("accounts.you"))})</span>` : ""}</strong>
      <small>${meta.map(escapeHtml).join(" · ")}</small>
      <span class="account-row__chips">
        <span class="chip${isAdmin ? " chip--role" : ""}">${escapeHtml(t(`role.${user.role}`))}</span>
        <span class="chip" lang="${user.lang}">${user.lang === "uk" ? "УКР" : "PL"}</span>
        ${app.chips(user)}
        ${user.disabledAt ? `<span class="chip chip--danger">${escapeHtml(t("accounts.blocked"))}</span>` : ""}
      </span>
    </span>
    ${isAdmin ? "" : `<span class="account-row__actions">
      <button type="button" class="btn btn--ghost btn--sm" data-account-act="edit">${escapeHtml(t("accounts.edit"))}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-account-act="password">${escapeHtml(t("accounts.newPassword"))}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-account-act="toggle">${escapeHtml(t(user.disabledAt ? "accounts.unblock" : "accounts.block"))}</button>
      <button type="button" class="icon-btn icon-btn--danger" data-account-act="delete" aria-label="${escapeHtml(t("accounts.delete", { name: app.label(user) }))}"
        title="${escapeHtml(t("accounts.delete", { name: app.label(user) }))}">${icon("trash", 18)}</button>
    </span>`}
  </li>`;
}

// Loads and draws the list inside the Settings block and handles its buttons. `me`: the signed-in administrator.
export function bindAccounts(block, me, options = NO_OPTIONS) {
  if (!block) return;
  const app = hooks(options);
  let users = [];
  const list = block.querySelector("[data-account-list]");

  async function load() {
    try {
      users = await api.users();
      const others = users.filter(user => user.role !== "admin");
      list.innerHTML = users.map(user => accountRow(user, me, options)).join("") +
        (others.length ? "" : `<li class="accounts__empty muted">${escapeHtml(t("accounts.empty"))}</li>`);
    } catch (error) {
      list.innerHTML = `<li class="field-error">${escapeHtml(error.message)}</li>`;
    }
  }

  block.addEventListener("click", async event => {
    if (event.target.closest("[data-account-new]")) return openNewAccount(load, options);
    const act = event.target.closest("[data-account-act]")?.dataset.accountAct;
    const user = users.find(u => u.id === Number(event.target.closest("[data-account]")?.dataset.account));
    if (!act || !user) return;
    try {
      if (act === "edit") return openEditAccount(user, load, options);
      if (act === "password") return openUserPassword(user, load, options);
      if (act === "toggle") {
        await api.updateUser(user.id, { disabled: !user.disabledAt });
        toast(t(user.disabledAt ? "accounts.unblockedToast" : "accounts.blockedToast", { name: app.label(user) }));
      }
      if (act === "delete") {
        if (!(await confirmDialog(t("accounts.deleteConfirm", { name: app.label(user) }), t("accounts.deleteOk")))) return;
        await api.deleteUser(user.id);
        toast(t("accounts.deleted"));
      }
      await load();
    } catch (error) {
      toast(error.message, { tone: "error" });
    }
  });

  load();
}

// ---- dialogs -------------------------------------------------------------------------------------------------
export function openNewAccount(onDone, options = NO_OPTIONS) {
  const app = hooks(options);
  const element = dialog("dialog--form", `<form class="dialog__body" novalidate>
    ${head(t("accounts.add"))}
    <div class="field-row">
      <label class="field"><span>${escapeHtml(t("accounts.form.name"))}</span>
        <input name="name" maxlength="80" required autocomplete="off" placeholder="${escapeHtml(t("accounts.form.namePlaceholder"))}"></label>
      <label class="field"><span>${escapeHtml(t("accounts.form.login"))}</span>
        <input name="login" maxlength="40" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHtml(t("accounts.form.loginPlaceholder"))}">
        <small class="field__hint">${escapeHtml(t("accounts.form.loginHint"))}</small></label>
    </div>
    ${app.afterIdentity(null)}
    ${passwordField(t("accounts.form.password"), t("accounts.form.passwordHint"))}
    <div class="field"><span>${escapeHtml(t("settings.language"))}</span>${languageOptions("lang", LANG)}</div>
    ${app.afterLanguage(null)}
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>${escapeHtml(t("common.cancel"))}</button>
      <button type="submit" class="btn btn--primary">${icon("plus", 18)}<span>${escapeHtml(t("accounts.form.create"))}</span></button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  const error = formError(form);
  bindPassword(form);
  app.bind(form, null);
  form.elements.name.focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.hide();
    const { name, login, password } = form.elements;
    if (!name.value.trim()) return error.show(t("error.nameRequired"));
    if (!/^[a-z0-9._-]{3,40}$/.test(login.value.trim().toLowerCase())) return error.show(t("error.loginFormat"));
    if (password.value.length < PASSWORD_MIN) return error.show(t("error.passwordShort"));
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const created = await api.createUser({ name: name.value.trim(), login: login.value.trim(), password: password.value,
        lang: form.elements.lang.value, ...app.read(form, null) });
      element.close();
      toast(t("accounts.created", { name: created.name, login: created.login }), { timeout: 12000 });
      onDone?.();
    } catch (failure) {
      error.show(failure.message || t("error.saveFailed"));
      submit.disabled = false;
    }
  });
}

export function openEditAccount(user, onDone, options = NO_OPTIONS) {
  const app = hooks(options);
  const element = dialog("dialog--form", `<form class="dialog__body" novalidate>
    ${head(t("accounts.editTitle", { name: app.label(user) }))}
    <label class="field"><span>${escapeHtml(t("accounts.form.name"))}</span>
      <input name="name" maxlength="80" required autocomplete="off" value="${escapeHtml(user.name)}"></label>
    ${app.afterIdentity(user)}
    <div class="field"><span>${escapeHtml(t("settings.language"))}</span>${languageOptions("lang", user.lang)}</div>
    ${app.afterLanguage(user)}
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>${escapeHtml(t("common.cancel"))}</button>
      <button type="submit" class="btn btn--primary">${escapeHtml(t("accounts.form.save"))}</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  app.bind(form, user);
  const error = formError(form);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.hide();
    if (!form.elements.name.value.trim()) return error.show(t("error.nameRequired"));
    await busy(form, async () => {
      try {
        await api.updateUser(user.id, { name: form.elements.name.value.trim(), lang: form.elements.lang.value, ...app.read(form, user) });
        element.close();
        toast(t("settings.saved"));
        onDone?.();
      } catch (failure) {
        error.show(failure.message || t("error.saveFailed"));
      }
    });
  });
}

// A new password set by the administrator (typed or generated); the account is signed out everywhere.
export function openUserPassword(user, onDone, options = NO_OPTIONS) {
  const app = hooks(options);
  const element = dialog("dialog--form", `<form class="dialog__body" novalidate>
    ${head(t("accounts.passwordTitle", { name: app.label(user) }))}
    ${passwordField(t("accounts.newPassword"), t("accounts.passwordHint"))}
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>${escapeHtml(t("common.cancel"))}</button>
      <button type="submit" class="btn btn--primary">${escapeHtml(t("accounts.form.save"))}</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  const error = formError(form);
  bindPassword(form);
  form.elements.password.focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.hide();
    if (form.elements.password.value.length < PASSWORD_MIN) return error.show(t("error.passwordShort"));
    await busy(form, async () => {
      try {
        await api.updateUser(user.id, { password: form.elements.password.value });
        element.close();
        toast(t("accounts.passwordSet", { name: app.label(user) }));
        onDone?.();
      } catch (failure) {
        error.show(failure.message || t("error.saveFailed"));
      }
    });
  });
}

// A member's own password (the administrator's is set on the server).
export function openPassword() {
  const element = dialog("dialog--form dialog--narrow", `<form class="dialog__body" novalidate>
    ${head(t("password.title"))}
    <label class="field"><span>${escapeHtml(t("password.current"))}</span><input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field"><span>${escapeHtml(t("password.next"))}</span><input type="password" name="next" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>
    <label class="field"><span>${escapeHtml(t("password.repeat"))}</span><input type="password" name="repeat" autocomplete="new-password" required></label>
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>${escapeHtml(t("common.cancel"))}</button>
      <button type="submit" class="btn btn--primary">${escapeHtml(t("password.title"))}</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  const error = formError(form);
  form.elements.current.focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.hide();
    const { current, next, repeat } = form.elements;
    if (next.value.length < PASSWORD_MIN) return error.show(t("error.passwordShort"));
    if (next.value !== repeat.value) return error.show(t("password.mismatch"));
    await busy(form, async () => {
      try {
        await api.changePassword(current.value, next.value);
        element.close();
        toast(t("password.changed"));
      } catch (failure) {
        error.show(failure.message || t("error.saveFailed"));
      }
    });
  });
}
