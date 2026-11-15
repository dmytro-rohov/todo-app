// Web Push in a Mytko app (0.7.0, docs/push.md): the "Notifications" block of Settings and the calls behind it. Every
// device is switched on by itself (the browser asks for permission on that device) and chooses its own categories.
//
//   Settings: ${pushBlock()} where the block goes, then mountPushBlock(root.querySelector("[data-push-block]"))
//   Start:    listenForPushOpen() once (a tapped notification opens its page in the window that is already open)
//   /sw.js:   mytkoServiceWorker({ prefix: "mytko-<id>-", push: true })
//
// Category names are the app's texts "push.category.<id>" (the server lists the ids). An app with its own HTTP module
// (Mytko Workflow) passes { base, request }: request(path, { method, body }) → the parsed JSON answer.
import { escapeHtml, t } from "./core.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { request as kitRequest } from "./http.js";

const READY_MS = 8000;

// "ok" | "install" (an iPhone/iPad outside the Home Screen app: push only works there) | "denied" (blocked for this
// app in the browser or the system) | "unsupported" (no service worker / Push API, e.g. iOS before 16.4).
export function pushSupport(env = globalThis) {
  const nav = env.navigator;
  if (!nav) return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent || "") || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || Boolean(env.matchMedia?.("(display-mode: standalone)").matches);
  if (ios && !standalone) return "install";
  if (!("serviceWorker" in nav) || !("PushManager" in env) || !("Notification" in env)) return "unsupported";
  if (env.Notification.permission === "denied") return "denied";
  return "ok";
}

export function pushApi({ base = "/api/push", request = kitRequest } = {}) {
  return {
    info: () => request(base),
    save: (subscription, prefs = null) => request(`${base}/subscription`, { method: "PUT", body: prefs ? { subscription, prefs } : { subscription } }),
    remove: endpoint => request(`${base}/unsubscribe`, { method: "POST", body: { endpoint } }),
    test: endpoint => request(`${base}/test`, { method: "POST", body: { endpoint } })
  };
}

// The VAPID public key (base64url) as the bytes PushManager.subscribe wants.
export function keyBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

// What the server keeps of a browser's subscription.
export function subscriptionJson(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// The categories as this device has them: its own choice, else the category's default.
export function effectivePrefs(categories, prefs = {}) {
  return Object.fromEntries(categories.map(category => [category.id, typeof prefs[category.id] === "boolean" ? prefs[category.id] : category.default]));
}

// A path of this app (as the worker and the server check it): one leading "/", no control characters or backslash, the
// app's origin once parsed.
function appPath(url, origin = "https://app.invalid") {
  if (typeof url !== "string" || !url.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(url)) return false;
  try { return new URL(url, origin).origin === new URL(origin).origin; } catch { return false; }
}

// A tapped notification while the app is open: the worker sends { type: "mytko:open", url } (sw-core.js). open: the
// app's own navigation (default: load that address).
export function listenForPushOpen(open = url => window.location.assign(url), env = globalThis) {
  const worker = env.navigator?.serviceWorker;
  if (!worker) return;
  worker.addEventListener("message", event => {
    const url = event.data?.type === "mytko:open" ? event.data.url : null;
    if (appPath(url, env.location?.origin)) open(url);
  });
}

// The block's frame: Settings renders it, mountPushBlock fills it.
export function pushBlock() {
  return `<section class="settings-block push-block" data-push-block>${head()}<p class="settings-block__note">${escapeHtml(t("push.loading"))}</p></section>`;
}

function head() {
  return `<h2 class="settings-block__title">${icon("bell")}${escapeHtml(t("push.title"))}</h2>`;
}

function categoryLabel(id) {
  const key = `push.category.${id}`;
  const text = t(key);
  return text === key ? id : text;
}

// state: { support, available, subscribed, categories, prefs }
export function pushBlockBody(state) {
  const note = key => `<p class="settings-block__note">${escapeHtml(t(key))}</p>`;
  if (state.support === "install") return `${note("push.lead")}${note("push.install")}`;
  if (state.support === "unsupported") return note("push.unsupported");
  if (!state.available) return note("push.unavailable");
  if (state.support === "denied") return `${note("push.lead")}${note("push.denied")}`;
  if (!state.subscribed) {
    return `${note("push.lead")}${note("push.off")}
      <div class="settings-block__buttons"><button type="button" class="btn btn--primary" data-push-on>${icon("bell")}<span>${escapeHtml(t("push.enable"))}</span></button></div>`;
  }
  const prefs = effectivePrefs(state.categories, state.prefs);
  const rows = state.categories.map(category => `<label class="switch">
      <input type="checkbox" name="push-category" value="${escapeHtml(category.id)}"${prefs[category.id] ? " checked" : ""}>
      <span class="switch__track"></span><span>${escapeHtml(categoryLabel(category.id))}</span></label>`).join("");
  return `${note("push.on")}
    ${rows ? `<div class="push-block__list">${rows}</div>` : ""}
    <div class="settings-block__buttons">
      <button type="button" class="btn btn--ghost" data-push-test>${icon("send")}<span>${escapeHtml(t("push.test"))}</span></button>
      <button type="button" class="btn btn--ghost" data-push-off>${icon("x")}<span>${escapeHtml(t("push.disable"))}</span></button>
    </div>`;
}

// Fills the block and handles it. options: { base, request } (pushApi), env (tests).
export async function mountPushBlock(element, options = {}) {
  if (!element) return;
  const env = options.env ?? globalThis;
  const api = pushApi(options);
  const state = { support: pushSupport(env), available: false, subscribed: false, categories: [], prefs: {}, publicKey: null };
  let subscription = null;
  const render = () => { element.innerHTML = head() + pushBlockBody(state); };
  const fail = error => toast(error?.message || t("push.failed"), { tone: "error" });
  // the app's worker (a worker that never became ready must not leave the block waiting)
  const ready = () => {
    let timer;
    const late = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(t("push.failed"))), READY_MS); });
    return Promise.race([env.navigator.serviceWorker.ready, late]).finally(() => clearTimeout(timer));
  };

  try {
    if (state.support !== "unsupported" && state.support !== "install") {
      const info = await api.info();
      Object.assign(state, { available: Boolean(info?.available), categories: info?.categories || [], publicKey: info?.publicKey || null });
      if (state.available && state.support === "ok") {
        subscription = await (await ready()).pushManager.getSubscription();
        // the server keeps this device (again, if it forgot it) and says what it chose
        if (subscription) Object.assign(state, { subscribed: true, prefs: (await api.save(subscriptionJson(subscription))).prefs || {} });
      }
    }
  } catch (error) {
    fail(error);
  }
  render();

  element.addEventListener("click", async event => {
    const button = event.target.closest("[data-push-on], [data-push-off], [data-push-test]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.hasAttribute("data-push-on")) {
        // first, still inside the tap: Safari asks for permission only in answer to one
        const permission = await env.Notification.requestPermission();
        if (permission !== "granted") {
          state.support = permission === "denied" ? "denied" : state.support;
          return render();
        }
        subscription = await (await ready()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
        const prefs = effectivePrefs(state.categories);
        Object.assign(state, { subscribed: true, prefs: (await api.save(subscriptionJson(subscription), prefs)).prefs || prefs });
        confirmed = effectivePrefs(state.categories, state.prefs);
        render();
      } else if (button.hasAttribute("data-push-off")) {
        const endpoint = subscription?.endpoint;
        await subscription?.unsubscribe().catch(() => undefined);
        if (endpoint) await api.remove(endpoint);
        subscription = null;
        Object.assign(state, { subscribed: false, prefs: {} });
        render();
      } else {
        await api.test(subscription.endpoint);
        toast(t("push.testSent"));
      }
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  });

  // Choices are saved one after another, each with every choice made so far (a quick second tap never sends the first
  // one's old value); a refused save puts its own switch back.
  let saving = Promise.resolve();
  // Each category's newest choice wins: a save started earlier is skipped once a newer choice of that category exists,
  // and a failed save puts back what the server last confirmed — only when no newer choice came meanwhile.
  const latest = {};
  let confirmed = effectivePrefs(state.categories, state.prefs);
  element.addEventListener("change", event => {
    const input = event.target.closest('input[name="push-category"]');
    if (!input || !subscription) return;
    const id = input.value;
    const sequence = (latest[id] || 0) + 1;
    latest[id] = sequence;
    state.prefs = { ...effectivePrefs(state.categories, state.prefs), [id]: input.checked };
    saving = saving.then(async () => {
      if (latest[id] !== sequence) return;
      try {
        const saved = (await api.save(subscriptionJson(subscription), state.prefs)).prefs;
        confirmed = effectivePrefs(state.categories, saved || state.prefs);
        if (saved) state.prefs = { ...saved, ...state.prefs };
        toast(t("settings.saved"));
      } catch (error) {
        if (latest[id] === sequence) {
          state.prefs = { ...state.prefs, [id]: confirmed[id] };
          input.checked = confirmed[id];
        }
        fail(error);
      }
    });
  });
}
