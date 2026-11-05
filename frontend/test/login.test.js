import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../js/api/http.js";
import { hours, loginErrorMessage, ssoNotice } from "../js/auth/login.js";

test("login errors are explained without leaking server messages", () => {
  assert.equal(loginErrorMessage(new ApiError("Invalid login or password", 401)), "Nieprawidłowy login lub hasło.");
  assert.match(loginErrorMessage(new ApiError("Too many", 429)), /Zbyt wiele/);
  assert.equal(loginErrorMessage(new ApiError("x", 400)), "Podaj login i hasło.");
  assert.match(loginErrorMessage(new Error("boom")), /nie powiodło się/);
});

test("session length reads naturally in Polish", () => {
  assert.equal(hours(3600), "1 godzinę");
  assert.equal(hours(12 * 3600), "12 godzin");
  assert.equal(hours(22 * 3600), "22 godziny");
  assert.equal(hours(168 * 3600), "7 dni");
});

test("only known Mytko sign-in outcomes become notices", () => {
  assert.match(ssoNotice("?sso=login_required"), /Mytko Workflow/);
  assert.equal(ssoNotice("?sso=<script>"), null);
  assert.equal(ssoNotice(""), null);
});
