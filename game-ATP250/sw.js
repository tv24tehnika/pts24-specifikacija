// Service worker for the game only (scope /game-ATP250/): keeps the game playable offline.
// The page tries the network first so updates show up at once; static files and fonts come from the cache.
// The room server (game.pts24.lv) and the admin page always go to the network.
const CACHE = 'derigs-v1';
const PAGE = './';
const STATIC = ['three.min.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap';
const NETWORK_TIMEOUT_MS = 4000;

// the font stylesheet lists the actual font files; cache those too so text looks right offline
async function cacheFonts(cache) {
    const res = await fetch(FONTS_CSS);
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONTS_CSS, res);
    const files = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(files.map(url => cache.add(url).catch(() => {})));
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll([PAGE, ...STATIC]);
        await cacheFonts(cache).catch(() => {});
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('derigs-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request, url = new URL(req.url);
    if (req.method !== 'GET') return;

    // the game page itself: network first, saved copy when offline
    if (req.mode === 'navigate') {
        const scope = new URL(PAGE, self.registration.scope).pathname;
        if (url.pathname !== scope && url.pathname !== scope + 'index.html') return;
        event.respondWith((async () => {
            try {
                const res = await fetch(req, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
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
        return;
    }

    // game files and fonts: cache first, fetched and stored on a miss
    const own = url.origin === self.location.origin && STATIC.some(f => url.pathname.endsWith('/' + f));
    const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
    if (!own && !font) return;
    event.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
    })());
});
