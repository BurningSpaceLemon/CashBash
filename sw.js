/* CashBash Service Worker (GitHub Pages / iOS Safari hardened)

  Goals:
  - Fast + reliable updates on iOS PWA
  - Avoid mixed-version asset issues
  - Keep index.html network-first, but offline-capable
  - Cache versioning + cleanup
  - Small, predictable cache keys

  Release process:
  - Bump SW_VERSION on every release
  - Also bump the query param in register('./sw.js?v=...')
*/

const SW_VERSION = 'v5.6';

const CACHE_STATIC = `cashbash-static-${SW_VERSION}`;
const CACHE_PAGES  = `cashbash-pages-${SW_VERSION}`;
const KEEP_CACHES = new Set([CACHE_STATIC, CACHE_PAGES]);

// Core assets. Keep small and deterministic.
// NOTE: Do NOT include index.html here to avoid split-brain (static vs pages cache).
const STATIC_ASSETS = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

function log(){ /* no-op in production */ }

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // Precache core assets. If one fails, we still want install to complete on flaky networks.
    await Promise.allSettled(STATIC_ASSETS.map((u) => cache.add(u)));
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

  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});

function isSameOrigin(url){
  return url.origin === self.location.origin;
}

function isHtmlRequest(req){
  return req.mode === 'navigate' || req.destination === 'document' || (req.headers.get('accept') || '').includes('text/html');
}

function normalizePath(url){
  // GitHub Pages + relative paths: keep pathname only.
  // Ensure we treat / and /index.html as the same offline entry.
  const p = url.pathname;
  if (p.endsWith('/')) return p + 'index.html';
  return p;
}

async function networkFirstHtml(req){
  const url = new URL(req.url);
  const cache = await caches.open(CACHE_PAGES);

  // Always store the app shell under a stable key for offline boot.
  const shellKey = new Request('./index.html');

  try {
    // Avoid SW cache for HTML fetch; rely on browser HTTP cache + network.
    const fresh = await fetch(req, { cache: 'no-store' });

    // Only cache good responses.
    if (fresh && fresh.ok) {
      await cache.put(shellKey, fresh.clone());
    }

    return fresh;
  } catch {
    const cached = await cache.match(shellKey);
    if (cached) return cached;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirstStatic(req){
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const fresh = await fetch(req);
    // Cache only successful, basic responses.
    if (fresh && fresh.ok) {
      await cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    // If offline and request is for something static, try to fall back to app shell.
    const pages = await caches.open(CACHE_PAGES);
    const shell = await pages.match(new Request('./index.html'));
    return shell || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Let cross-origin go straight to network.
  if (!isSameOrigin(url)) return;

  // HTML/navigation: network-first + offline shell.
  if (isHtmlRequest(req)) {
    event.respondWith(networkFirstHtml(req));
    return;
  }

  // Everything else: cache-first.
  event.respondWith(cacheFirstStatic(req));
});
