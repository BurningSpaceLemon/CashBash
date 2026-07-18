/* CashBash Service Worker (GitHub Pages / iOS Safari friendly)

   Goals:
   - New deployments activate quickly (skipWaiting + clients.claim)
   - Update signaling to the app (waiting -> UI banner)
   - Cache versioning + cleanup to avoid iOS serving stale assets
   - Network-first for navigations/documents (do NOT hard-cache index.html forever)

   Release process:
   - Bump SW_VERSION on every release
   - Also bump the query param in register('./sw.js?v=...')
*/

const SW_VERSION = 'v4';
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
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (KEEP_CACHES.has(k) ? null : caches.delete(k))));

    await self.clients.claim();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
    }
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstPage(req){
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_PAGES);
    // Store under a stable key so offline reload works.
    cache.put('./index.html', fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match('./index.html');
    if (cached) return cached;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirstStatic(req){
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_STATIC);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const html = await caches.match('./index.html');
    return html || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin requests: let them go to the network unmodified.
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations/documents.
  if (req.mode === 'navigate' || req.destination === 'document'){
    event.respondWith(networkFirstPage(req));
    return;
  }

  // Cache-first for everything else we can cache.
  event.respondWith(cacheFirstStatic(req));
});
