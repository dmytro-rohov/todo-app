/* Mytko Tasks service worker (installable app, same approach as Mytko Workflow's).
 *
 * - /api/* and /auth/*: never handled, so tasks, sessions and sign-in always go to the server and nothing private
 *   is cached.
 * - Everything else of this origin (the app shell, /js, /dist, /icons, the manifest): network first, revalidated
 *   (cache: "no-cache"), so a release is picked up on the next load. Only when the network is down or the server
 *   answers 5xx the last good copy is served, so the installed app still opens and shows its own "no connection"
 *   message.
 * - Exception: a page load answered by the proxy's release page (5xx with X-Mytko-Maintenance, a deploy in progress)
 *   shows that page. It tells the visitor what is happening and reloads itself once the app is back.
 * - VERSION changes only when this file's logic changes; old caches with the PREFIX are dropped on activation.
 */
const VERSION = "3";
const PREFIX = "mytko-tasks-";
const CACHE = `${PREFIX}shell-v${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .catch(() => undefined)
      .then(() => self.clients.claim())
  );
});

function cacheable(response) {
  return response.ok && response.type === "basic";
}

async function networkFirst(event) {
  const { request } = event;
  // the app is one page: its navigations share the "/" entry; another page (privacy.html) keeps its own
  const path = new URL(request.url).pathname;
  const key = request.mode === "navigate" && (path === "/" || path === "/index.html") ? "/" : request;
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.status >= 500) {
      // the proxy's release page (deploy in progress): show it rather than the cached shell; it reloads itself
      if (request.mode === "navigate" && response.headers.has("X-Mytko-Maintenance")) return response;
      throw new Error("server unavailable");
    }
    if (cacheable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const hit = await caches.open(CACHE).then(cache => cache.match(key)).catch(() => undefined);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/healthz" || url.pathname === "/readyz") return;
  event.respondWith(networkFirst(event));
});
