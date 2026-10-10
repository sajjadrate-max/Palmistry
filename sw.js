/**
 * Minimal service worker — just enough for the site to qualify as an
 * installable PWA (browsers require an active service worker before
 * showing "Install App" / "Add to Home Screen"). It caches the app
 * shell (this HTML page) so it opens instantly on repeat visits;
 * it does NOT cache /api/analyze responses, since each reading must
 * always be freshly generated.
 */
const CACHE_NAME = 'palm-sense-shell-v1';
const SHELL_FILES = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always go to the network.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first for the app shell, falling back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
