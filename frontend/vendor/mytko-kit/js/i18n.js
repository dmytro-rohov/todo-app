// Interface language: Ukrainian (default) or Polish. Texts are looked up by key: the kit's own (../locales/uk.js, pl.js:
// login, accounts, settings, errors, …) under the app's (its js/locales, given to useTranslations), so an app's key wins
// over the kit's of the same name. A signed-in account's language (GET /api/auth/session) wins over the one remembered
// on this device ("mytko-<app>:lang"), which is used on the login screen. Plural values pick their form with
// Intl.PluralRules. Every text may use {app} (e.g. "Mytko Finance") and {appShort} ("Finance"), filled in by t().
import kitUk from "../locales/uk.js";
import kitPl from "../locales/pl.js";
import { appInfo, storageKey } from "./config.js";

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
