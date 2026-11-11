// Accounts. The owner (the only administrator) creates accounts for others, e.g. a partner: they get the task app
// only, with their own data plus the shared spaces they are put in or join with a code. A member changes their own password here too.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { confirmDialog, dialog } from "./dialogs.js";
import { toast } from "./toast.js";
import { LOCALE } from "../i18n.js";
import { avatarHtml } from "./avatar.js";

const PASSWORD_MIN = 12;

// A readable random password (no look-alike characters), 16 characters.
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}

const when = iso => (iso ? new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jeszcze nie");

const MESSAGES = {
  "This login is taken": "Ten login jest już zajęty.",
  "Password: at least 12 characters": `Hasło musi mieć co najmniej ${PASSWORD_MIN} znaków.`,
  "Login: 3–40 lowercase letters, digits, dot, dash or underscore": "Login: 3–40 znaków, małe litery, cyfry, kropka, myślnik lub podkreślenie.",
  "Name is required": "Podaj imię lub nazwę.",
  "Too many accounts": "Osiągnięto limit kont.",
  "The current password is wrong": "Obecne hasło jest nieprawidłowe."
};
const say = error => MESSAGES[error.message] || error.message || "Nie udało się zapisać.";

export async function openAccounts() {
  let users = [];
  const element = dialog("dialog--manage dialog--accounts", `<div class="dialog__body">
    <header class="dialog__head"><h2>Konta</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
    <p class="manage__hint">Tylko Ty zarządzasz kontami. Osoba z kontem widzi wyłącznie swoje zadania oraz wspólne przestrzenie, do których ją dodasz albo zaprosisz (np. Dom). Nie widzi klientów, spotkań ani innych kont.</p>
    <ul class="manage__list accounts" data-list><li class="muted">Wczytuję…</li></ul>
    <form class="accounts__add" data-add novalidate>
      <h3>Nowe konto</h3>
      <div class="field-row">
        <label class="field"><span>Imię</span><input name="name" maxlength="80" required placeholder="np. Ola"></label>
        <label class="field"><span>Login</span><input name="login" maxlength="40" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="np. ola"></label>
      </div>
      <label class="field"><span>Hasło startowe (przekaż je tej osobie; może je potem zmienić)</span>
        <span class="accounts__password"><input name="password" maxlength="200" required autocomplete="new-password" spellcheck="false">
        <button type="button" class="btn btn--ghost btn--sm" data-generate>Wygeneruj</button></span></label>
      <p class="field-error" data-error hidden></p>
      <div class="dialog__actions"><button type="submit" class="btn btn--primary">${icon("plus", 18)}Utwórz konto</button></div>
    </form>
  </div>`);
  const list = element.querySelector("[data-list]");
  const form = element.querySelector("[data-add]");
  const box = element.querySelector("[data-error]");
  const fail = error => { box.textContent = say(error); box.hidden = false; };

  function draw() {
    list.innerHTML = users.map(user => `
      <li data-user="${user.id}" class="account${user.disabledAt ? " is-disabled" : ""}">
        ${avatarHtml(user)}
        <span class="account__text"><strong>${escapeHtml(user.name)}</strong>
          <small class="muted">login: ${escapeHtml(user.login)} · ostatnie logowanie: ${escapeHtml(when(user.lastLoginAt))} · otwarte zadania: ${user.openTasks}${user.disabledAt ? " · <b>zablokowane</b>" : ""}</small></span>
        <span class="account__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-act="password">Nowe hasło</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="toggle">${user.disabledAt ? "Odblokuj" : "Zablokuj"}</button>
          <button type="button" class="icon-btn" data-act="delete" aria-label="Usuń konto ${escapeHtml(user.name)}">${icon("trash", 18)}</button>
        </span>
      </li>`).join("") || '<li class="muted">Nie ma jeszcze innych kont.</li>';
  }

  async function load() {
    try { users = await api.list("users"); draw(); } catch (error) { fail(error); }
  }

  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    if (event.target.closest("[data-generate]")) {
      form.password.type = "text";
      form.password.value = generatePassword();
      return form.password.select();
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    const row = event.target.closest("[data-user]");
    if (!act || !row) return;
    const user = users.find(u => u.id === Number(row.dataset.user));
    box.hidden = true;
    try {
      if (act === "password") {
        const password = generatePassword();
        if (!(await confirmDialog(`Ustawić nowe hasło dla konta ${user.name}? To konto zostanie wylogowane na wszystkich urządzeniach. Nowe hasło: ${password}`, "Ustaw hasło"))) return;
        await api.update("users", user.id, { password });
        toast(`Nowe hasło dla ${user.name}: ${password}`, { timeout: 30000 });
      }
      if (act === "toggle") {
        await api.update("users", user.id, { disabled: !user.disabledAt });
        toast(user.disabledAt ? `${user.name} może się znowu logować.` : `Konto ${user.name} zablokowane i wylogowane.`);
      }
      if (act === "delete") {
        if (!(await confirmDialog(`Usunąć konto ${user.name} razem z jego zadaniami, przestrzeniami i etykietami? Twoje zadania z przestrzeni tego konta wrócą do Twoich Prywatnych. Tego nie da się cofnąć.`, "Usuń konto"))) return;
        await api.remove("users", user.id);
        toast("Konto usunięte.");
      }
      await load();
    } catch (error) { fail(error); }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    box.hidden = true;
    if (form.password.value.length < PASSWORD_MIN) return fail({ message: "Password: at least 12 characters" });
    try {
      const created = await api.create("users", { name: form.name.value.trim(), login: form.login.value.trim(), password: form.password.value });
      toast(`Konto ${created.name} utworzone. Login: ${created.login}`);
      form.reset();
      form.password.type = "password";
      await load();
    } catch (error) { fail(error); }
  });

  form.name.focus();
  await load();
}

// A member's own password (the owner's is set on the server).
export function openPassword() {
  const element = dialog("dialog--password", `
    <form class="dialog__body" novalidate>
      <header class="dialog__head"><h2>Zmień hasło</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>
      <label class="field"><span>Obecne hasło</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>Nowe hasło (co najmniej ${PASSWORD_MIN} znaków)</span><input type="password" name="next" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>
      <label class="field"><span>Powtórz nowe hasło</span><input type="password" name="repeat" autocomplete="new-password" required></label>
      <p class="field-error" data-error hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
        <button type="submit" class="btn btn--primary">Zmień hasło</button>
      </div>
    </form>`);
  const form = element.querySelector("form");
  const box = form.querySelector("[data-error]");
  const fail = message => { box.textContent = message; box.hidden = false; };
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
  form.current.focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (form.next.value.length < PASSWORD_MIN) return fail(`Nowe hasło musi mieć co najmniej ${PASSWORD_MIN} znaków.`);
    if (form.next.value !== form.repeat.value) return fail("Nowe hasła się różnią.");
    try {
      await api.changePassword(form.current.value, form.next.value);
      element.close();
      toast("Hasło zmienione. Inne urządzenia zostały wylogowane.");
    } catch (error) { fail(say(error)); }
  });
}
