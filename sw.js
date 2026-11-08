// オフラインでも使えるようにするための Service Worker
// アプリ本体を更新したら CACHE_VERSION を上げる
const CACHE_VERSION = 'v2';
const APP_CACHE = `large-text-app-${CACHE_VERSION}`;
const FONT_CACHE = 'large-text-fonts';

const APP_FILES = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== APP_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Google Fonts: 一度読み込んだものはキャッシュから返す
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.open(FONT_CACHE).then(async (cache) => {
                const cached = await cache.match(req);
                const network = fetch(req).then((res) => {
                    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
                    return res;
                }).catch(() => cached);
                // CSS は裏で更新、フォント本体は変わらないのでキャッシュ優先
                return cached || network;
            })
        );
        return;
    }

    // アプリ本体: ネット優先、つながらなければキャッシュ
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(APP_CACHE).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req, { ignoreSearch: true })
                    .then((res) => res || caches.match('./index.html')))
        );
    }
});
