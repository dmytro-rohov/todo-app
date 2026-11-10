import test from "node:test";
import assert from "node:assert/strict";

// A new device (nothing chosen yet) gets the Ukrainian interface.
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { LANG, LOCALE, t } = await import("../js/i18n.js");

test("Ukrainian is the default on a new device", () => {
  assert.equal(LANG, "uk");
  assert.equal(LOCALE, "uk-UA");
  assert.equal(t("Nowe zadanie"), "Нове завдання");
});
