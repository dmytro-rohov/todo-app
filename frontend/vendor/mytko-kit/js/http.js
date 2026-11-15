// Every HTTP call of a Mytko app goes through request(): JSON in and out, a deadline, the server's English messages
// shown in the interface language, and "not signed in" anywhere returning to the login screen.
import { appMessages, t } from "./core.js";

export const API_BASE = globalThis.MYTKO_API_BASE ?? "";
// Server messages (English, stable) shown in the interface language: the kit's (sign-in, accounts, the shared server
// errors) and the app's own (addMessages in core.js, called once by the app's setup; an app entry wins over the kit's).
const MESSAGES = {
  "Authentication required": "error.session",
  "Not available for this account": "error.forbidden",
  "Too many requests": "error.tooMany",
  "Too many failed login attempts": "login.error.locked",
  "Invalid login or password": "login.error.invalid",
  "Login and password are required": "login.error.empty",
  "Unsupported language": "error.language",
  "This login is taken": "error.loginTaken",
  "Password: at least 12 characters": "error.passwordShort",
  "Login: 3–40 lowercase letters, digits, dot, dash or underscore": "error.loginFormat",
  "Name is required": "error.nameRequired",
  "Too many accounts": "error.tooManyAccounts",
  "The current password is wrong": "error.currentPassword",
  "The administrator is configured on the server": "error.adminServer",
  "The administrator's password is set on the server": "error.adminServer",
  "Account not found": "error.accountNotFound",
  "Request body too large": "error.tooLarge",
  "Busy, try again": "error.busy",
  "Invalid request": "error.refresh",
  "Push notifications are not configured": "push.unavailable",
  "This push service is not supported": "push.unsupported",
  "This device is not subscribed": "push.gone",
  "The notification could not be sent": "push.sendFailed"
};

// The app's server messages: { "Plan not found": "error.refresh", … } — kept in core.js (setupKit does not load this
// module); this name still works.
export { addMessages } from "./core.js";

// The translation key of a server message, or null (tests: every mapped key exists).
export function messageKey(message) {
  const app = appMessages();
  return Object.hasOwn(app, message) ? app[message] : Object.hasOwn(MESSAGES, message) ? MESSAGES[message] : null;
}

export function messageKeys() {
  return [...new Set(Object.values({ ...MESSAGES, ...appMessages() }))];
}

// Headers every change carries (any request with a method other than GET/HEAD), e.g. Finance's X-Mytko-Currency: the
// currency the app shows its money in. A null value removes one.
const changeHeaders = {};
export function setChangeHeader(name, value) {
  if (value === null || value === undefined || value === "") delete changeHeaders[name];
  else changeHeaders[name] = String(value);
}

// Events dispatched on window for particular server answers: { "Currency changed": "mytko:currency-changed" } (the app
// catches up when another window or device changed something it shows).
const ANSWER_EVENTS = {};
export function addAnswerEvents(events = {}) {
  Object.assign(ANSWER_EVENTS, events);
}

// reason: the server's own (English, stable) message, for code that acts on a particular answer.
export class ApiError extends Error {
  constructor(message, status, reason = null) { super(message); this.name = "ApiError"; this.status = status; this.reason = reason; }
}

// A signal aborted after `ms` or with `outer`: a plain controller, so also older iPhones without AbortSignal.timeout/any.
function deadlineSignal(ms, outer) {
  const controller = new AbortController();
  const deadline = { signal: controller.signal, timedOut: false };
  const timer = setTimeout(() => { deadline.timedOut = true; controller.abort(); }, ms);
  deadline.end = () => clearTimeout(timer);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  return deadline;
}

// as: "json" (the answer parsed), or "blob" (a file, e.g. a photo to save); errors are handled the same way.
export async function request(path, options = {}) {
  const { timeoutMs = 15000, as = "json", ...init } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new TypeError("Invalid HTTP timeout");
  const deadline = deadlineSignal(timeoutMs, init.signal);
  init.signal = deadline.signal;
  if (init.body !== undefined) { init.headers = { "Content-Type": "application/json", ...init.headers }; init.body = JSON.stringify(init.body); }
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && Object.keys(changeHeaders).length) init.headers = { ...init.headers, ...changeHeaders };
  try {
    const response = await fetch(API_BASE + path, init);
    if (response.ok && as === "blob") return await response.blob();
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { /* not JSON */ } }
    // Any API call answered "not signed in" (session ended, expired or logged out elsewhere) returns to the login screen.
    if (response.status === 401 && !path.startsWith("/api/auth/")) globalThis.dispatchEvent?.(new Event("mytko:session-ended"));
    if (!response.ok && typeof data?.message === "string" && Object.hasOwn(ANSWER_EVENTS, data.message)) globalThis.dispatchEvent?.(new Event(ANSWER_EVENTS[data.message]));
    if (!response.ok) {
      const known = data && typeof data.message === "string" ? messageKey(data.message) : null;
      throw new ApiError(known ? t(known) : t("error.server", { status: response.status }), response.status, data?.message ?? null);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(deadline.timedOut ? t("error.timeout") : t("error.offline"), 0);
  } finally {
    deadline.end();
  }
}

// The kit's own API calls (the login screen, the profile, the accounts list).
export const authApi = {
  session: () => request("/api/auth/session"),
  logout: () => request("/api/auth/logout", { method: "POST", body: {} }),
  me: () => request("/api/me"),
  setLanguage: lang => request("/api/me", { method: "PATCH", body: { lang } }),
  changePassword: (current, next) => request("/api/auth/password", { method: "POST", body: { current, next } }),
  users: () => request("/api/users"),
  createUser: body => request("/api/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/api/users/${Number(id)}`, { method: "PATCH", body }),
  deleteUser: id => request(`/api/users/${Number(id)}`, { method: "DELETE" })
};
