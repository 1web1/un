const CACHE_NAME = 'monasa-cache-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // أول ما النسخة الجديدة تشتغل: نعيد تحميل الصفحات المفتوحة عشان تاخد آخر index.html
        // (بيشتغل مرة واحدة بس مع كل تغيير في CACHE_NAME)
        clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} });
      })
  );
});

self.addEventListener('fetch', (event) => {
  // Network first, fallback to cache for offline availability
  if (event.request.method !== 'GET') return;
  const isPage = event.request.mode === 'navigate';
  event.respondWith(
    // الصفحة نفسها: نتجاوز كاش المتصفح ونسأل السيرفر دايماً عشان آخر نسخة تظهر على طول
    fetch(event.request, isPage ? { cache: 'no-cache' } : undefined)
      .then((networkResponse) => {
        if (isPage && networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (isPage) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
