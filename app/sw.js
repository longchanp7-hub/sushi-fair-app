const CACHE_PREFIX='sushi-fair-v';
const CACHE='sushi-fair-v20260907-campaign-catalog1';
const STATIC=[
  './',
  './index.html',
  './national.js',
  './campaign-catalog.js',
  './campaign-catalog.js?v=20260907',
  './region.js',
  './styles.css',
  './region.css',
  './brand.css',
  './local-tokai.css',
  './suruga-theme.css',
  './manifest.webmanifest',
  './data/store-contexts-fallback.json',
  './assets/sushi-icon-192-v2.png',
  './assets/sushi-icon-512-v2.png',
  './assets/suruga-bay-fuji-bg.webp'
];
const DATA_PATHS=['/data/fairs.json','/data/store-contexts.json','/data/store-contexts-fallback.json'];
const isData=url=>DATA_PATHS.some(path=>url.pathname.endsWith(path));
const isSameOrigin=request=>new URL(request.url).origin===self.location.origin;
const cacheKey=request=>{
  const url=new URL(request.url);
  if(isData(url))url.search='';
  return url.href;
};

async function networkFirst(request,{timeoutMs=8000}={}){
  const cache=await caches.open(CACHE);
  const key=cacheKey(request);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(request,{cache:'no-store',signal:controller.signal});
    if(response.ok){if(isSameOrigin(request))await cache.put(key,response.clone());return response;}
    const cached=await cache.match(key);
    if(cached)return cached;
    return response;
  }catch(error){
    const cached=await cache.match(key);
    if(cached)return cached;
    throw error;
  }finally{clearTimeout(timer);}
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(!isSameOrigin(event.request))return;
  if(isData(url)){event.respondWith(networkFirst(event.request,{timeoutMs:10000}));return;}
  if(event.request.mode==='navigate'){event.respondWith(networkFirst(event.request,{timeoutMs:8000}).catch(()=>caches.match('./index.html')));return;}
  if(['script','style','manifest','image','font'].includes(event.request.destination)){event.respondWith(networkFirst(event.request,{timeoutMs:8000}));}
});
