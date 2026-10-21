/* Service worker: de hele app werkt offline (ook in het bos zonder bereik).
   Bestanden komen direct uit de cache en worden op de achtergrond ververst, dus een nieuwe versie
   staat bij de volgende keer openen klaar. Verhoog VERSION om de cache helemaal te vernieuwen. */
const VERSION = 'tp-3.1.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css', 'img/topo.svg',
  'js/vendor/qrcode.js', 'js/engine.js', 'js/coach.js', 'js/app.js',
  'fonts/Barlow-400.woff2', 'fonts/Barlow-500.woff2', 'fonts/Barlow-600.woff2', 'fonts/Barlow-700.woff2',
  'fonts/BarlowCondensed-600.woff2', 'fonts/BarlowCondensed-700.woff2', 'fonts/BarlowCondensed-800.woff2',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch:true });
    const net = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    return r || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
