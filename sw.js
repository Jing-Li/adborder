const CACHE_NAME = 'adborder-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/privacy.html',
  '/about.html',
  '/terms.html',
  '/contact.html',
  '/404.html',
  '/blog.html',
  '/blog-instagram-border.html',
  '/blog-polaroid.html',
  '/blog-social-media-borders.html',
  '/blog-photo-border-guide.html',
  '/instagram-size.html',
  '/twitter-size.html',
  '/facebook-size.html',
  '/pinterest-size.html',
  '/linkedin-size.html',
  '/youtube-size.html',
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
