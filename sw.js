// sw.js — Service Worker für PWA Installation
const CACHE_NAME = 'fiona-matt-v1';
const ASSETS = [
  '/Fiona-Matt/',
  '/Fiona-Matt/index.html',
  '/Fiona-Matt/icon-192.png',
  '/Fiona-Matt/icon-512.png',
  '/Fiona-Matt/manifest.json',
  '/Fiona-Matt/WALogo.png',
  '/Fiona-Matt/SALogo.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Network first, fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
