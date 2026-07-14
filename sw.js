// Směny — service worker (v0.9.1)
// VERSION drž v synchronu s verzí appky (index.html #app-version-label).
// Změna verze = nový název cache → při aktivaci se stará cache smaže a klienti
// dostanou čerstvý build (skipWaiting + clients.claim, reload řeší registrace
// v index.html přes controllerchange) — nikdo nezůstane na zamrzlém buildu.
const VERSION = '0.9.2';
const CACHE = 'smeny-v' + VERSION;         // shell (cache-first)
const DATA_CACHE = CACHE + '-data';        // Supabase GET data (network-first, offline fallback)
const PRECACHE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase data — network-first: vždy čerstvá data, cache jen jako offline fallback
  if (url.hostname.endsWith('.supabase.co')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Ostatní cross-origin necháváme bez zásahu
  if (url.origin !== location.origin) return;

  // Shell — cache-first (novou verzi shellu přinese nová verze SW s novou cache)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
