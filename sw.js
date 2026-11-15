// SkyWeave service worker: oyunu internetsiz açar, harita karolarını önbelleğe alır.
const VERSION = 'v1.1.0';
const APP = 'skyweave-app-' + VERSION;
const LIB = 'skyweave-lib-v1';
const TILES = 'skyweave-tiles-v1';
const MAX_TILES = 2500;
let puts = 0;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css?v=14',
  'js/main.js?v=14', 'js/traffic3d.js?v=14', 'js/globe.js', 'js/data.js', 'js/sim.js', 'js/rivals.js', 'js/events.js',
  'js/progress.js', 'js/depth.js', 'js/settings.js', 'js/audio.js', 'js/fx.js', 'js/charts.js', 'js/tutorial.js', 'js/game.js', 'js/extra.js', 'js/scenarios.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.css',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(SHELL);
    const lib = await caches.open(LIB);
    await Promise.all(LIBS.map(u => lib.match(u).then(hit => hit || lib.add(u)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('skyweave-app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Oyun dosyaları: önce ağ (güncellemeler hemen gelsin), yoksa önbellek
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(APP);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
      }
    })());
    return;
  }

  // Sürümlü kütüphaneler: önce önbellek
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(LIB).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }

  // Harita stili, karolar, yazı tipleri: önbellekteki hemen, arkada yenile
  if (url.hostname.endsWith('openfreemap.org')) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) { c.put(req, r.clone()); if (++puts % 100 === 0) trim(c, MAX_TILES); } return r; }).catch(() => hit || Response.error());
      return hit || net;
    })());
  }
});
