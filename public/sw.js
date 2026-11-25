// Ghost Interviewer service worker: makes the site installable as an app.
// Page loads go to the network first (a fresh deploy is always picked up) and
// fall back to the last cached copy only when offline. API calls, model
// downloads and CDN scripts are not touched.
const CACHE = 'ghost-shell-v1';

self.addEventListener('install', (event) => {
  // Cache the shell right away, so even the very next start works offline.
  event.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put('/', res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match('/');
      if (cached) return cached;
      throw err;
    }
  })());
});
