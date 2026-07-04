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

self.addEventListener('fetch', event => {
    // 🛡️ Ignoramos conexiones en vivo y extensiones de Chrome
    if (event.request.url.includes('/api/realtime') || event.request.url.startsWith('chrome-extension')) {
        return; 
    }

    event.respondWith(
        // 1. Intentamos ir a internet por el archivo fresco
        fetch(event.request).catch(() => {
            // 2. Si falla (no hay internet), buscamos en la caché local
            return caches.match(event.request).then(response => {
                if (response) {
                    return response;
                }
                // 3. Si no hay internet y no está en la caché, devolvemos una respuesta vacía legal
                // Esto evita el temido error "Failed to convert value to 'Response'"
                return new Response("Archivo no disponible sin conexión", { 
                    status: 503, 
                    statusText: "Service Unavailable" 
                });
            });
        })
    );
});