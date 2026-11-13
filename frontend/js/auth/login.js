// Login screen: the Mytko Kit's (vendor/mytko-kit/js/login.js), the same in every Mytko app and as Mytko Workflow's —
// password login plus "Zaloguj kontem Mytko", Tasks' lead and features from js/i18n.js (KIT_TEXTS). Its requests go
// through the kit's http.js; the rest of Tasks keeps js/api/http.js (its server messages, read by the translator).
//
// "Zaloguj kontem Mytko" without a click (shouldTryMytko): only in a browser that signed in here with it before
// (localStorage "mytko-tasks-sso-used", set by main.js whenever the session came from Mytko), once per tab
// ("mytko-tasks-sso-tried") and never after a logout ("mytko-tasks-sso-off") — the same keys as before plus "used".
import { request } from "../api/http.js";

export { getSession, markLoggedOut, markMytkoUsed, renderLogin, shouldTryMytko, ssoKeys, ssoNotice } from "../../vendor/mytko-kit/js/login.js";

export function logout() {
  return request("/api/auth/logout", { method: "POST", body: {} });
}
