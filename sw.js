const CACHE_NAME = 'builder-v1';
const TILE_CACHE = 'builder-tiles-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Кэшируем тайлы карты
  if (url.hostname === 'tiles.openfreemap.org') {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
        });
      })
    );
    return;
  }

  // Остальное — из сети
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
