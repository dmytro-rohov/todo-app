// The login screen is the Mytko Kit's (js/auth/login.js re-exports it) with Tasks' texts. The automatic "Zaloguj kontem
// Mytko" keeps its rules (once per tab, never after a reported outcome or a logout, the same storage keys) and adds one:
// only in a browser that signed in here with Mytko before ("mytko-tasks-sso-used", set by main.js for such a session).
import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/i18n.js"; // Tasks' kit setup: id "tasks", its texts
import { useLang } from "../vendor/mytko-kit/js/core.js";
import { markLoggedOut, markMytkoUsed, renderLogin, shouldTryMytko, ssoKeys, ssoNotice } from "../js/auth/login.js";

const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};

test("the storage keys of the automatic Mytko sign-in: the ones Tasks had, plus the new one", () => {
  assert.deepEqual(ssoKeys(), { tried: "mytko-tasks-sso-tried", off: "mytko-tasks-sso-off", used: "mytko-tasks-sso-used" });
});

test("the automatic Mytko sign-in: only where Mytko was used, once per tab, never after a reported outcome or a logout", () => {
  const ready = { mytkoLogin: true, mytkoAvailable: true };
  const used = () => { const shared = memory(); shared.setItem("mytko-tasks-sso-used", "1"); return shared; };
  assert.equal(shouldTryMytko(ready, "", memory(), used()), true);
  // new: a browser that never signed in here with Mytko is not sent there (a member's phone, a fresh device)
  assert.equal(shouldTryMytko(ready, "", memory(), memory()), false);
  assert.equal(shouldTryMytko({ mytkoLogin: false }, "", memory(), used()), false);
  assert.equal(shouldTryMytko({ mytkoLogin: true, mytkoAvailable: false }, "", memory(), used()), false);
  assert.equal(shouldTryMytko(ready, "?sso=login_required", memory(), used()), false);
  const tab = memory(); tab.setItem("mytko-tasks-sso-tried", "1");
  assert.equal(shouldTryMytko(ready, "", tab, used()), false);
  assert.equal(shouldTryMytko(ready, "", { getItem() { throw new Error("blocked"); } }, used()), false);
  const off = used(); off.setItem("mytko-tasks-sso-off", "1");
  assert.equal(shouldTryMytko(ready, "", memory(), off), false);
});

test("a Mytko session marks the browser; a logout clears the mark and stops every tab", () => {
  const realLocal = globalThis.localStorage, realSession = globalThis.sessionStorage;
  globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
  try {
    markMytkoUsed();
    assert.equal(localStorage.getItem("mytko-tasks-sso-used"), "1");
    markLoggedOut();
    assert.equal(localStorage.getItem("mytko-tasks-sso-off"), "1");
    assert.equal(localStorage.getItem("mytko-tasks-sso-used"), null);
    assert.equal(sessionStorage.getItem("mytko-tasks-sso-tried"), "1");
  } finally {
    globalThis.localStorage = realLocal; globalThis.sessionStorage = realSession;
  }
});

test("only known Mytko sign-in outcomes become notices", () => {
  useLang("pl");
  assert.match(ssoNotice("?sso=login_required"), /Mytko Workflow/);
  assert.equal(ssoNotice("?sso=<script>"), null);
  assert.equal(ssoNotice(""), null);
});

test("the login screen shows Tasks' lead and features in both languages", () => {
  for (const [lang, words] of [["pl", ["Od pomysłu", "do zrobionego zadania", "Tablica, lista i kalendarz", "Przestrzenie i projekty", "Terminy i czas pracy"]],
    ["uk", ["Від ідеї", "до виконаного завдання", "Дошка, список і календар", "Простори й проєкти", "Терміни й час роботи"]]]) {
    useLang(lang);
    const root = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
    try { renderLogin(root, { mytkoLogin: true, mytkoAvailable: true, ttlSeconds: 604800 }, { onAuthenticated() {} }); } catch { /* no page to wire up */ }
    for (const word of words) assert.ok(root.innerHTML.includes(word), `${lang}: ${word}`);
    assert.ok(root.innerHTML.includes("Mytko Tasks"));
  }
  useLang("uk");
});
