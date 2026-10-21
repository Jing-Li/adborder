const CACHE_NAME = 'adborder-v14';
const ASSETS = [
  '/',
  '/index.html',
  '/privacy.html',
  '/about.html',
  '/terms.html',
  '/contact.html',
  '/404.html',
  '/blog.html',
  '/blog-social-media-sizes.html',
  '/blog-instagram-border.html',
  '/blog-polaroid.html',
  '/blog-photo-border-guide.html',
  '/blog-image-format.html',
  '/blog-aspect-ratio.html',
  // zh 首批(T11 i18n):与 en 同一缓存策略,缓存版本升级避免旧 en 快照残留
  '/zh/index.html',
  '/zh/404.html',
  '/zh/about.html',
  '/zh/contact.html',
  '/zh/privacy.html',
  '/zh/terms.html',
  '/zh/editorial.html',
  '/zh/blog.html',
  // zh 次批(T13 i18n):blog 14 篇 + critique 2 篇,缓存版本升级避免旧快照残留
  '/zh/blog-aspect-ratio.html',
  '/zh/blog-best-border-tools.html',
  '/zh/blog-black-border-guide.html',
  '/zh/blog-color-psychology-social-media.html',
  '/zh/blog-image-composition-tips.html',
  '/zh/blog-image-format.html',
  '/zh/blog-instagram-border.html',
  '/zh/blog-mobile-borders.html',
  '/zh/blog-photo-border-guide.html',
  '/zh/blog-polaroid.html',
  '/zh/blog-ppi-vs-dpi.html',
  '/zh/blog-resize-images.html',
  '/zh/blog-social-media-sizes.html',
  '/zh/blog-visual-storytelling.html',
  '/zh/critique/episode-1.html',
  '/zh/critique/episode-2.html',
  '/images/tool-screenshot.jpg',
  '/images/before-after-borders.jpg',
  '/images/border-styles-grid.jpg',
  '/logo.png',
  '/og-image.jpg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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
  if (event.request.method !== 'GET') return;
  // /models/ 榜单站数据每日更新,必须网络优先,不走 Service Worker 缓存
  if (new URL(event.request.url).pathname.startsWith('/models/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
