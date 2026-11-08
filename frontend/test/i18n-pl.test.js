import test from "node:test";
import assert from "node:assert/strict";
import { LANG, LOCALE, t } from "../js/i18n.js";
import { MONTHS } from "../js/app/logic.js";

test("Polish is the default and nothing is translated", () => {
  assert.equal(LANG, "pl");
  assert.equal(LOCALE, "pl-PL");
  assert.equal(t("Nowe zadanie"), "Nowe zadanie");
  assert.equal(MONTHS[10], "Listopad");
});
