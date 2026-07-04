const CACHE_NAME = 'pos-cache-v1';
const urlsToCache = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

// Instalar y guardar archivos localmente
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(urlsToCache);
        })
    );
});

// Cuando no haya internet, usar la copia guardada
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        }).catch(() => {
            console.log("Sin internet y sin caché para:", event.request.url);
        })
    );
});