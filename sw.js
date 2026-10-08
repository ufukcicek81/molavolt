/* MolaVolt 2026-10-08: network-first pages, safe offline fallback */
const CACHE_NAME = 'molavolt-20261008-ui-v3';
const CORE = ['./', './index.html', './manifest.json'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.allSettled(CORE.map(path => cache.add(new Request(path, {cache:'reload'}))));
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME && (/^molavolt-|^sarj-bul-/).test(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;
  if(request.mode === 'navigate' || url.pathname.endsWith('/index.html')){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, {cache:'no-store'});
        if(response.ok) await cache.put('./index.html', response.clone());
        return response;
      } catch(err) {
        return await cache.match('./index.html') || await cache.match('./') || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if(response.ok && /\.(css|js|png|jpg|jpeg|svg|webp|json)$/i.test(url.pathname)) cache.put(request, response.clone()).catch(()=>{});
      return response;
    } catch(err) {
      return await cache.match(request) || Response.error();
    }
  })());
});