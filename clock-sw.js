// Service worker pulksteņa lapai (/clock): saglabā lapu pārlūkā, lai tā
// ielādētos arī bez interneta. Vienmēr vispirms mēģina tīklu, lai
// atjauninājumi parādās uzreiz; kešu izmanto tikai tad, ja tīkls nav pieejams.
const CACHE = 'clock-v1';
const PAGE = '/clock';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.add(PAGE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Tikai pašas lapas ielāde; laika sinhronizācijas pieprasījumi iet tieši tīklā
    if (event.request.mode !== 'navigate') return;

    event.respondWith((async () => {
        try {
            const res = await fetch(event.request, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
            if (res.ok && !res.redirected) {
                const copy = res.clone();
                caches.open(CACHE).then(cache => cache.put(PAGE, copy));
            }
            return res;
        } catch (e) {
            const cached = await caches.match(PAGE);
            if (cached) return cached;
            throw e;
        }
    })());
});
