import test from "node:test";
import assert from "node:assert/strict";

// The language is read once, when the module loads: this file runs the Ukrainian interface.
globalThis.localStorage = { getItem: key => (key === "mytko-tasks:lang" ? "uk" : null), setItem() {} };
const { LANG, LOCALE, t } = await import("../js/i18n.js");
const { dueLabel, MONTHS, WEEKDAYS } = await import("../js/app/logic.js");

test("Ukrainian is picked from the device setting", () => {
  assert.equal(LANG, "uk");
  assert.equal(LOCALE, "uk-UA");
});

test("interface texts are translated, surrounding spaces kept", () => {
  assert.equal(t("Nowe zadanie"), "Нове завдання");
  assert.equal(t("  W realizacji "), "  В роботі ");
  assert.equal(t("Zaloguj się"), "Увійти");
});

test("sentences with names keep the name as written", () => {
  assert.equal(t("Dodano „Kupić mleko”."), "Додано «Kupić mleko».");
  assert.equal(t("Dodano zadania: 3."), "Додано завдань: 3.");
  assert.equal(t("„Strona” → W realizacji"), "«Strona» → В роботі");
  assert.equal(t("Konto Ola utworzone. Login: ola"), "Обліковий запис Ola створено. Логін: ola");
  assert.equal(t("Masz aktywną sesję Mytko? Wejdziesz jednym kliknięciem. Sesja trwa 12 godzin."),
    "Маєте активну сесію Mytko? Увійдете одним кліком. Сесія триває 12 год.");
});

test("text people wrote is left alone", () => {
  assert.equal(t("Dom"), "Dom");
  assert.equal(t("Kupić mleko i chleb"), "Kupić mleko i chleb");
  // "Usuń …" is a button label pattern: never applied to page text such as a task titled like that
  assert.equal(t("Usuń stare pliki"), "Usuń stare pliki");
  assert.equal(t("12:30"), "12:30");
});

test("dates use Ukrainian month and weekday names", () => {
  assert.equal(MONTHS[10], "Листопад");
  assert.equal(WEEKDAYS[0], "Пн");
  assert.equal(dueLabel("2026-03-05", "2026-11-08"), "5 бер");
  assert.equal(t(dueLabel("2026-11-08", "2026-11-08")), "Сьогодні");
});
