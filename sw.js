const CACHE_NAME='fiona-matt-v2-20261003-wa-team-2';
const ASSETS=[
  '/Fiona-Matt/',
  '/Fiona-Matt/index.html',
  '/Fiona-Matt/styles.css',
  '/Fiona-Matt/config.js',
  '/Fiona-Matt/app.js',
  '/Fiona-Matt/personal-ui.js',
  '/Fiona-Matt/assets/fiona-portrait.jpg',
  '/Fiona-Matt/assets/liechtenstein-flag.webp',
  '/Fiona-Matt/assets/dakar-mascot.png',
  '/Fiona-Matt/assets/senegal-flag.svg',
  '/Fiona-Matt/assets/world-athletics-logo.svg',
  '/Fiona-Matt/data-adapters.js',
  '/Fiona-Matt/extensions.js',
  '/Fiona-Matt/historical-data.js',
  '/Fiona-Matt/data-models.js',
  '/Fiona-Matt/migration-ui.js',
  '/Fiona-Matt/athlete_results.json',
  '/Fiona-Matt/manifest.webmanifest',
  '/Fiona-Matt/icon-192-fixed.png',
  '/Fiona-Matt/icon-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fiona-matt-v2-')&&k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin){
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if (!response.ok) return response;
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});