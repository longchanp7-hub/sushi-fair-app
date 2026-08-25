const CACHE='sushi-fair-v20260826-readability2';
const STATIC=[
  './',
  './index.html',
  './national.js',
  './region.js',
  './styles.css',
  './region.css',
  './brand.css',
  './local-tokai.css',
  './suruga-theme.css',
  './manifest.webmanifest',
  './assets/sushi-icon-192-v2.png',
  './assets/sushi-icon-512-v2.png',
  './assets/suruga-bay-fuji-bg.webp'
];
const DATA_PATHS=['/data/fairs.json','/data/store-contexts.json'];
const isData=url=>DATA_PATHS.some(path=>url.pathname.endsWith(path));
const isSameOrigin=request=>new URL(request.url).origin===self.location.origin;

async function networkFirst(request,{timeoutMs=8000}={}){
  const cache=await caches.open(CACHE);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(request,{cache:'no-store',signal:controller.signal});
    if(response.ok&&isSameOrigin(request))await cache.put(request,response.clone());
    return response;
  }catch(error){
    const cached=await cache.match(request,{ignoreSearch:true});
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
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
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
