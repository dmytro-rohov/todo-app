// Mytko Kit, frontend core: which app the kit runs in (config), the interface language and texts (i18n), the HTML
// helpers, painting colours and widths, and setupKit — one module, so a page load fetches one file for all of them.
// One call sets the kit up for an app, made by the app's js/i18n.js before anything is drawn:
//
//   import { setupKit } from "../vendor/mytko-kit/js/core.js";
//   import uk from "./locales/uk.js";
//   import pl from "./locales/pl.js";
//   setupKit({ id: "finance", name: "Mytko Finance", features: [...], locales: { uk, pl }, messages: { ... } });
//   export * from "../vendor/mytko-kit/js/core.js";
//
// Kit modules never import app code; the app imports them (../vendor/mytko-kit/js/<module>.js: core, ui, icons, http,
// shell, login, accounts) and passes what they need (views, the account, callbacks). The older module paths (config.js,
// i18n.js, helpers.js, paint.js, kit.js, …) still work: each re-exports from the module it is now part of.
import { uk as kitUk, pl as kitPl } from "../locales/texts.js";

// ---- config.js --------------------------------------------------------------------------------------------------------

// Which app the kit runs in: its id ("finance": storage keys "mytko-finance:…", cookies on the server), its name
// ("Mytko Finance": the {app} placeholder of every text) and short name ("Finance": the brand next to the logo, the
// {appShort} placeholder), and the login screen's three features. Set once by the app (js/i18n.js → setupKit) before
// anything is drawn; until then the kit runs as a neutral "Mytko" app (unit tests of single modules).
const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
let current = Object.freeze({ id: "app", name: "Mytko", short: "", features: [], contact: null });

// features: [{ icon: "<kit icon name>", key: "hero.f1" }, …] — each key has .title and .text in the app's texts.
// contact: an e-mail address the login screen's help offers to people without an account (optional).
export function configureApp({ id, name, short, features = [], contact = null }) {
  if (typeof id !== "string" || !APP_ID.test(id) || typeof name !== "string" || !name) throw new Error("configureApp needs { id, name }");
  current = Object.freeze({ id, name, short: short ?? name.replace(/^Mytko\s+/, ""), features: Object.freeze([...features]), contact });
  return current;
}

export function appInfo() {
  return current;
}

// A key in localStorage / sessionStorage of this app: "mytko-<id>:<name>" (lang, ui-scale, welcome, prefs, …).
export function storageKey(name) {
  return `mytko-${current.id}:${name}`;
}

// ---- helpers.js -------------------------------------------------------------------------------------------------------

// escape user-provided text before putting it into an HTML template
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
  "`": "&#96;"
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, char => HTML_ESCAPES[char]);
}

// only plain hex colors may reach style properties or SVG attributes
export function safeColor(value, fallback = "#cccccc") {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback;
}

// "Dmytro Rohov" -> "DR"; only words that start with a letter or digit count ("Оля (тест)" -> "ОТ").
export function initials(name) {
  return String(name || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.slice(0, 2).map(word => word[0].toLocaleUpperCase()).join("") || "?";
}

// ---- paint.js ---------------------------------------------------------------------------------------------------------

// Colours and widths never go into style attributes (CSP style-src 'self'): elements carry data-c (a hex colour) or
// data-w (a percentage) and get a CSS variable from script.

export function paint(element) {
  for (const node of element.querySelectorAll("[data-c]")) node.style.setProperty("--c", safeColor(node.dataset.c, "#7d8a80"));
  for (const node of element.querySelectorAll("[data-w]")) {
    const width = Math.max(0, Math.min(100, Number(node.dataset.w) || 0));
    node.style.setProperty("--w", `${width}%`);
  }
}

// ---- i18n.js ----------------------------------------------------------------------------------------------------------

// Interface language: Ukrainian (default) or Polish. Texts are looked up by key: the kit's own (../locales/texts.js:
// login, accounts, settings, errors, …) under the app's (its js/locales, given to useTranslations), so an app's key wins
// over the kit's of the same name. A signed-in account's language (GET /api/auth/session) wins over the one remembered
// on this device ("mytko-<app>:lang"), which is used on the login screen. Plural values pick their form with
// Intl.PluralRules. Every text may use {app} (e.g. "Mytko Finance") and {appShort} ("Finance"), filled in by t().

export const LANGUAGES = { uk: "Українська", pl: "Polski" };
const LOCALES = { uk: "uk-UA", pl: "pl-PL" };
let DICTIONARIES = { uk: kitUk, pl: kitPl };

// Keys every app must define itself (the kit's components show them, the words are the app's).
export const APP_KEYS = ["startup.preparing", "hero.title", "hero.titleAccent", "hero.lead", "accounts.hint", "accounts.deleteConfirm"];

function remembered() {
  try {
    const value = globalThis.localStorage?.getItem(storageKey("lang"));
    return DICTIONARIES[value] ? value : "uk";
  } catch { return "uk"; }
}

export let LANG = "uk";
export let LOCALE = LOCALES[LANG];

// The app's own texts ({ uk, pl }), over the kit's; then the language remembered on this device.
export function useTranslations({ uk = {}, pl = {} } = {}) {
  DICTIONARIES = { uk: { ...kitUk, ...uk }, pl: { ...kitPl, ...pl } };
  LANG = remembered();
  LOCALE = LOCALES[LANG];
}

// Switches the language for everything rendered from now on and remembers it on this device.
export function useLang(lang) {
  if (!DICTIONARIES[lang]) return;
  LANG = lang;
  LOCALE = LOCALES[lang];
  try { globalThis.localStorage?.setItem(storageKey("lang"), lang); } catch { /* the choice lasts until the page is reloaded */ }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function t(key, params = {}) {
  let value = DICTIONARIES[LANG][key] ?? DICTIONARIES.uk[key] ?? key;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = value[new Intl.PluralRules(LOCALE).select(Number(params.count))] ?? value.other;
  }
  if (typeof value !== "string") return value;
  const app = appInfo();
  const values = { app: app.name, appShort: app.short, ...params };
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

// The merged texts of one language (tests: every key the code asks for exists).
export function dictionary(lang = "uk") {
  return DICTIONARIES[lang];
}

// Fills every element marked data-i18n (text) / data-i18n-aria (aria-label) inside `root`: the static parts of
// index.html.
export function translateStatic(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t(node.dataset.i18nAria));
}

// ---- server messages -----------------------------------------------------------------------------------------------

// The app's server messages (English, stable) -> its text keys, laid over the kit's own table in http.js (an app's
// message of the same text wins). Kept here so setting the kit up does not load http.js (an app with its own HTTP
// module, e.g. Tasks, never fetches it).
const APP_MESSAGES = {};

export function addMessages(messages = {}) {
  Object.assign(APP_MESSAGES, messages);
}

export function appMessages() {
  return APP_MESSAGES;
}

// ---- kit.js -----------------------------------------------------------------------------------------------------------

export const KIT_VERSION = "0.11.1";

// id, name, short, features, contact: configureApp. locales: { uk, pl } (the app's texts). messages: the app's server
// messages -> text keys (addMessages; http.js shows them).
export function setupKit({ locales = {}, messages = {}, ...app }) {
  const info = configureApp(app);
  useTranslations(locales);
  addMessages(messages);
  return info;
}
