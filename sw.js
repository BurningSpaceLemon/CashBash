/* CashBash Service Worker (GitHub Pages / iOS Safari friendly)

   Goals:
   - New deployments activate quickly (skipWaiting + clients.claim)
   - Update signaling to the app (postMessage)
   - Cache versioning + cleanup to avoid iOS serving stale assets forever
   - Avoid hard-caching index.html (network-first) so UI updates show up

   Release process:
   - Bump SW_VERSION on every release (e.g. v3 -> v4)
   - Optionally bump the query param in register('./sw.js?v=...') too
*/

const SW_VERSION = 'v6';
const CACHE_STATIC = `cashbash-static-${SW_VERSION}`;
const CACHE_PAGES  = `cashbash-pages-${SW_VERSION}`;
const KEEP_CACHES = new Set([CACHE_STATIC, CACHE_PAGES]);

// App shell / core assets. Keep this list small.
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    await cache.addAll(STATIC_ASSETS);
    // Activate this SW as soon as it's finished installing.
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean up old caches.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (KEEP_CACHES.has(k) ? null : caches.delete(k))));

    // Take control of existing pages immediately.
    await self.clients.claim();

    // Notify all controlled clients that we're active.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
    }
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'SKIP_WAITING') {
    // App requested immediate activation.
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Let cross-origin requests go to network (ECB, jsdelivr, gun relay, etc.)
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations (index.html): prevents "stuck" old UI on iOS.
  // Fallback to cache for offline.
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_PAGES);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Cache-first for same-origin static assets.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_STATIC);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      // As a last resort, return index for single-page app routing.
      const html = await caches.match('./index.html');
      return html || new Response('Offline', { status: 503 });
    }
  })());
});
