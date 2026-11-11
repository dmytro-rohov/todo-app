/* Mytko service worker core (installable app, the same approach as Mytko Workflow's). A classic script, not a module:
 * the app's own /sw.js (it must stay at the site root for its scope) loads it and starts it:
 *
 *   importScripts("/vendor/mytko-kit/js/sw-core.js");
 *   mytkoServiceWorker({ prefix: "mytko-finance-", version: "1" });
 *
 * - /api/* and /auth/*: never handled, so data, sessions and sign-in always go to the server and nothing private
 *   is cached. The path is compared in lowercase, because the server's routes ignore letter case (/API/… is /api/…).
 * - Everything else of this origin (the app shell, /js, /dist, /icons, /vendor, the manifest): network first,
 *   revalidated (cache: "no-cache"), so a release is picked up on the next load. Only when the network is down or the
 *   server answers 5xx (e.g. during a release) the last good copy is served, so the installed app still opens and shows
 *   its own "no connection" message.
 * - version changes only when the caching logic changes; old caches with the prefix are dropped on activation.
 * - releasePage (Tasks): a page load answered by the proxy's release page (5xx with X-Mytko-Maintenance, a deploy in
 *   progress) shows that page instead of the cached shell; it tells the visitor what is happening and reloads itself.
 * - pages (Tasks): the app has more than one page (privacy.html): only loads of "/" and "/index.html" share the app
 *   shell's entry, every other page keeps its own. Without it every page load is the app shell's entry.
 */
/* exported mytkoServiceWorker */
// eslint-disable-next-line no-unused-vars
function mytkoServiceWorker({ prefix, version = "1", releasePage = false, pages = false }) {
  if (typeof prefix !== "string" || !/^mytko-[a-z][a-z0-9-]*-$/.test(prefix)) throw new Error("mytkoServiceWorker needs the cache prefix, e.g. \"mytko-finance-\"");
  const CACHE = `${prefix}shell-v${version}`;

  self.addEventListener("install", () => self.skipWaiting());

  self.addEventListener("activate", event => {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== CACHE).map(key => caches.delete(key))))
        .catch(() => undefined)
        .then(() => self.clients.claim())
    );
  });

  function cacheable(response) {
    return response.ok && response.type === "basic";
  }

  async function networkFirst(event) {
    const { request } = event;
    const path = new URL(request.url).pathname;
    const key = request.mode === "navigate" && (!pages || path === "/" || path === "/index.html") ? "/" : request;
    try {
      const response = await fetch(request, { cache: "no-cache" });
      if (response.status >= 500) {
        // the proxy's release page (a deploy in progress): shown rather than the cached shell; it reloads itself
        if (releasePage && request.mode === "navigate" && response.headers.has("X-Mytko-Maintenance")) return response;
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
    const path = url.pathname.toLowerCase();
    if (path.startsWith("/api/") || path.startsWith("/auth/") || path === "/api" || path === "/auth" || path.startsWith("/healthz") || path.startsWith("/readyz")) return;
    event.respondWith(networkFirst(event));
  });
}
