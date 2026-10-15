// InvestIQ service worker — uygulama dosyaları için "önce ağ" stratejisi:
// yeni sürüm yayınlanınca telefonda hemen görünür, internet yoksa önbellekten açılır.
const CACHE = 'investiq-v4.1.0';
const CORE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // Fiyat API'leri vb. dış istekler: service worker karışmaz
    if (url.origin !== self.location.origin) return;

    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true })
                .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
});
