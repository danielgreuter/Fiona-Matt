const CACHE_NAME='fiona-matt-v2-20261005-profile-photo-19';
const ASSETS=[
  '/Fiona-Matt/team-profile-metadata.json',
  '/Fiona-Matt/',
  '/Fiona-Matt/index.html',
  '/Fiona-Matt/styles.css',
  '/Fiona-Matt/styles.css?v=20261005-19',
  '/Fiona-Matt/config.js',
  '/Fiona-Matt/app.js',
  '/Fiona-Matt/gallery.js',
  '/Fiona-Matt/profile-photo.js',
  '/Fiona-Matt/personal-ui.js',
  '/Fiona-Matt/weather.js',
  '/Fiona-Matt/assets/track-lanes.svg',
  '/Fiona-Matt/assets/header-track.svg',
  '/Fiona-Matt/assets/north-macedonia-flag.svg',
  '/Fiona-Matt/assets/italy-flag.svg',
  '/Fiona-Matt/assets/austria-flag.svg',
  '/Fiona-Matt/assets/slovenia-flag.svg',
  '/Fiona-Matt/assets/peru-flag.svg',
  '/Fiona-Matt/assets/st-gallen-coat.svg',
  '/Fiona-Matt/assets/zurich-coat.svg',
  '/Fiona-Matt/assets/zug-coat.svg',
  '/Fiona-Matt/assets/thurgau-coat.svg',
  '/Fiona-Matt/assets/ticino-coat.svg',
  '/Fiona-Matt/assets/fribourg-coat.svg',

  '/Fiona-Matt/assets/senegal-coat.png',
  '/Fiona-Matt/assets/north-macedonia-coat.png',
  '/Fiona-Matt/assets/italy-coat.png',
  '/Fiona-Matt/assets/vaud-coat.svg',
  '/Fiona-Matt/assets/bern-coat.svg',

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
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))));
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
    fetch(event.request,{cache:'no-cache'})
      .then(response=>{
        if (!response.ok) return response;
        const copy=response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});