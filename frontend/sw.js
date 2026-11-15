/* Mytko Tasks service worker (installable app): the Mytko Kit core (vendor/mytko-kit/js/sw-core.js — API, sign-in and
 * health paths never handled, everything else network-first, the last good copy only when offline or during a
 * release) with this app's cache prefix, its release page (a page load answered by the proxy's release page during a
 * deploy shows that page; it reloads itself once the app is back) and its second page (privacy.html keeps its own cache
 * entry). It stays here, at the site root, for its scope. Bump version only when the caching logic changes (old caches
 * with the prefix are dropped on activation). push: the kit's Web Push handlers (the morning "Na dziś", a tap opens Tasks).
 */
importScripts("/vendor/mytko-kit/js/sw-core.js");
mytkoServiceWorker({ prefix: "mytko-tasks-", version: "3", releasePage: true, pages: true, push: { fallbackTitle: "Mytko Tasks" } });
