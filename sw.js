const CACHE_NAME = 'monasa-cache-v8'; // v8: فيديوهات الشرح بتروح للسيرفر على طول — v7: إشعارات الموبايل (push) — v6: الـ service worker مبقاش يلمس طلبات المواقع التانية (درايف)
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
  // طلبات المواقع التانية (درايف، Firebase، المكتبات...) بتروح على طول من غير ما نلمسها
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;
  // الفيديوهات (طلبات Range): الآيفون بيبوّظها لو مرّت من الـ service worker، فتروح للسيرفر مباشرة
  if (reqUrl.pathname.startsWith('/videos/') || event.request.headers.has('range')) return;
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

/* ===== إشعارات الموبايل: الإدارة بتبعتها من لوحة الأدمن ← 🔔 الإشعارات (api/push.js) ===== */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'El dof3aa Btzaker';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    dir: 'rtl',
    lang: 'ar',
    tag: d.tag || 'dof3aa',
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w)).catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
