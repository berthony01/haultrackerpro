// Self-destroying service worker.
// If a stale PWA service worker from a previous build is still installed in a
// user's browser and tries to update, it will fetch this file. This script
// immediately skips waiting, clears every cache, and unregisters itself,
// freeing the page from any further interception. Safe to leave in place
// permanently — it never caches anything and never claims clients beyond the
// one-time forced refresh.

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) {}
    try {
      await self.registration.unregister();
    } catch (e) {}
    try {
      var clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(function (client) {
        try { client.navigate(client.url); } catch (e) {}
      });
    } catch (e) {}
  })());
});

// Pass every fetch straight through to the network — never cache, never serve.
self.addEventListener('fetch', function () {
  // Intentionally empty: default browser behavior applies.
});
