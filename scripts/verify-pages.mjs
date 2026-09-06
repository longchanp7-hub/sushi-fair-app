import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const PAGE_URL=process.argv[2];
const REPORT_PATH=process.env.SMOKE_REPORT_PATH||null;
const VERIFY_DATA_MODE=process.env.VERIFY_DATA_MODE||'strict';
const STRICT_DATA=VERIFY_DATA_MODE!=='static';
const MAX_TRANSIENT_ATTEMPTS=4;
const RETRY_DELAY_MS=4000;
if(!PAGE_URL)throw new Error('Usage: node scripts/verify-pages.mjs <page-url>');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normalize=v=>String(v).replace(/\r\n/g,'\n').trimEnd();
const BAD_HERO=/(?:shared\/img\/ogp\.png|\/img\/ogp\/|ogp[-_.]|\/img\/mark\d+\.webp|\/themes\/[^/]+\/img\/info\/(?:sp\/)?mainimg\.(?:jpe?g|png|webp)|\/recruit\/|\/staff\/|\/company\/)/i;
const transientError=message=>Object.assign(new Error(message),{transient:true});
const isTransient=error=>error?.transient===true||/(?:fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|AbortError|aborted|socket hang up)/i.test(String(error?.message||error));

function bust(url,a){const u=new URL(url);u.searchParams.set('__smoke',`${Date.now()}-${a}`);return u.href;}
async function responseOrThrow(url,a,headers){
  try{
    const r=await fetch(bust(url,a),{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{...headers,'cache-control':'no-cache',pragma:'no-cache'}});
    if(!r.ok){const e=new Error(`${url} returned HTTP ${r.status}`);e.transient=[404,408,425,429].includes(r.status)||r.status>=500;throw e;}
    return r;
  }catch(error){if(error?.transient==null&&isTransient(error))error.transient=true;throw error;}
}
async function fetchText(url,a){return (await responseOrThrow(url,a,{accept:'text/html,application/json,text/plain,*/*;q=.5'})).text();}
async function fetchBinary(url,a){const r=await responseOrThrow(url,a,{accept:'image/webp,image/*;q=.9,*/*;q=.5'});return {type:r.headers.get('content-type')||'',bytes:new Uint8Array(await r.arrayBuffer())};}
function publishedEquals(remote,local,label){if(normalize(remote)!==normalize(local))throw transientError(`${label} has not propagated to Pages yet`);}

const NATIONAL=['hamazushi','kappasushi','kurasushi','sushiro','uobei'];
const LOCAL=['musashimaru','tokubei','totomaru'];
const freshness=(remote,local,label)=>{const r=Date.parse(remote),l=Date.parse(local);assert.ok(Number.isFinite(r),`${label} remote updatedAt invalid`);assert.ok(Number.isFinite(l),`${label} local updatedAt invalid`);if(r<l)throw transientError(`${label} public data is older than this run (${remote} < ${local})`);};

function validateFairs(data){
  assert.equal(data?.schemaVersion,2);
  assert.equal(data?.timezone,'Asia/Tokyo');
  assert.ok(Date.parse(data?.updatedAt));
  assert.equal(data?.locationModel?.mode,'manual_prefecture_city');
  assert.equal(data?.locationModel?.gps,false);
  assert.ok(Array.isArray(data?.chains));
  const by=Object.fromEntries(data.chains.map(x=>[x.chain,x]));
  for(const id of [...NATIONAL,...LOCAL])assert.ok(by[id],`${id} fair data missing`);
  for(const id of LOCAL)assert.equal(by[id].group,'local_tokai',`${id} group must be local_tokai`);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const chain of data.chains){
    assert.ok(Array.isArray(chain.items));
    assert.match(chain.officialActionUrl||'',/^https:\/\//);
    assert.ok(chain.regionalModel?.strategyKey);
    if(chain.campaigns!=null)assert.ok(Array.isArray(chain.campaigns));
    if(chain.menuHighlights!=null)assert.ok(Array.isArray(chain.menuHighlights));
    if(chain.endDate&&chain.endDate<today)assert.notEqual(chain.status,'ok');
    for(const item of chain.items){
      assert.ok(item?.name);
      assert.ok(['active','ended','unknown'].includes(item.saleStatus||'active'));
      assert.ok(item.scrapeStatus);
      if(item.endDate&&item.endDate<today)assert.notEqual(item.saleStatus,'active');
    }
  }
  if(STRICT_DATA){
    const s=by.sushiro;
    assert.equal(s.nationalSourceOfTruth,true,'Sushiro national fair must be source of truth');
    assert.equal(s.referenceStoreOverlayOnly,true);
    for(const item of s.items){assert.ok('startDate' in item&&'endDate' in item,'Sushiro item dates must be retained');assert.ok(item.sourceUrl,'Sushiro item sourceUrl required');}
    const tm=by.totomaru;assert.ok(Array.isArray(tm.menuHighlights)&&tm.menuHighlights.length>=1,'Totomaru quick-menu highlights missing');
    const mm=by.musashimaru;assert.ok(Array.isArray(mm.menuHighlights)&&mm.menuHighlights.length>=2,'Musashimaru menu highlights missing');assert.equal(mm.menuHighlights[0]?.priceFrom,176,'Musashimaru verified menu price floor mismatch');
    for(const chain of data.chains){const hero=chain.representativeImageUrl||chain.imageUrl||'';assert.ok(!hero||!BAD_HERO.test(hero),`${chain.chain} published generic/store hero image: ${hero}`);}
  }
}

function findExact(catalog,chain,prefecture,municipality){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&x.municipality===municipality)||null;}
function findCity(catalog,chain,prefecture,cityPrefix){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&String(x.municipality||'').startsWith(cityPrefix))||null;}
function validateStores(data){assert.equal(data?.schemaVersion,1);assert.ok(data?.catalog&&typeof data.catalog==='object');for(const chain of [...NATIONAL,...LOCAL])assert.ok(data.catalog[chain]&&typeof data.catalog[chain]==='object',`${chain} store catalog missing`);const ss=findExact(data.catalog,'sushiro','北海道','札幌市中央区'),ts=findExact(data.catalog,'sushiro','愛知県','豊橋市');assert.equal(ss?.storeId,'2575');assert.equal(ss?.menuAreaCode,'883');assert.equal(ts?.storeId,'142');assert.equal(ts?.menuAreaCode,'179');assert.notEqual(ss.menuUrl,ts.menuUrl);const hh=findExact(data.catalog,'hamazushi','北海道','札幌市中央区'),th=findExact(data.catalog,'hamazushi','愛知県','豊橋市');assert.equal(hh?.storeId,'4460');assert.equal(hh?.regionCode,'hokkaido');assert.equal(th?.storeId,'4208');assert.equal(th?.regionCode,'tokai');const sk=findCity(data.catalog,'kurasushi','北海道','札幌市'),tk=findExact(data.catalog,'kurasushi','愛知県','豊橋市');assert.ok(sk&&tk);assert.notEqual(sk.officialUrl,tk.officialUrl);assert.ok(findExact(data.catalog,'musashimaru','愛知県','豊橋市'));assert.ok(findExact(data.catalog,'totomaru','愛知県','豊橋市'));}
function validateFallbackStores(data){assert.equal(data?.schemaVersion,1);assert.ok(data?.catalog&&typeof data.catalog==='object');for(const chain of LOCAL)assert.ok(data.catalog[chain]&&typeof data.catalog[chain]==='object',`${chain} fallback store catalog missing`);assert.ok(findExact(data.catalog,'totomaru','愛知県','豊橋市'),'Totomaru Toyohashi fallback missing');assert.ok(findExact(data.catalog,'musashimaru','愛知県','豊橋市'),'Musashimaru Toyohashi fallback missing');}
function validateIndex(index){assert.match(index,/name="app-version" content="20260906-resilience1"/);assert.match(index,/class="app-scene"/);assert.match(index,/suruga-theme\.css/);assert.match(index,/local-tokai\.css/);assert.match(index,/id="prefectureSelect"/);assert.match(index,/id="citySelect"/);assert.match(index,/id="applyRegionBtn"/);assert.match(index,/id="regionStatus"/);assert.match(index,/id="chainQuickNavNational"/);assert.match(index,/id="chainQuickNavLocal"/);assert.match(index,/id="cardsNational"/);assert.match(index,/id="cardsLocal"/);assert.match(index,/serviceWorker\.register/);assert.match(index,/20260906-resilience1/);for(const id of ['uobei','totomaru','musashimaru','tokubei'])assert.match(index,new RegExp(`data-chain="${id}"`));assert.doesNotMatch(index,/id="todayHighlights"/);}
function validateNational(source){assert.match(source,/national fair|全国フェア/i);assert.match(source,/regionalPrice/);assert.match(source,/not_listed_reference_store/);assert.match(source,/menuHighlights/);assert.match(source,/メニュー：/);assert.match(source,/availableInSelectedArea/);assert.match(source,/地域メニューを公式で確認/);assert.match(source,/fairPhase/);assert.match(source,/開始予定/);assert.match(source,/表示中データを維持/);assert.match(source,/if\(f\?\.endDate&&f\.endDate<today\)return \[\]/);}
function validateServiceWorker(source){for(const p of ['national.js','region.js','styles.css','region.css','brand.css','local-tokai.css','suruga-theme.css','manifest.webmanifest','suruga-bay-fuji-bg.webp','store-contexts-fallback.json'])assert.match(source,new RegExp(p.replace('.','\\.')));assert.match(source,/store-contexts\.json/);assert.match(source,/networkFirst/);assert.match(source,/cacheKey/);assert.match(source,/CACHE_PREFIX/);assert.match(source,/key\.startsWith\(CACHE_PREFIX\)/);assert.doesNotMatch(source,/cache\.put\(request/);assert.doesNotMatch(source,/app\.js/);}
function validateWebp(asset){assert.match(asset.type,/^image\/webp(?:;|$)/i);assert.ok(asset.bytes.length>1000);assert.equal(String.fromCharCode(...asset.bytes.slice(0,4)),'RIFF');assert.equal(String.fromCharCode(...asset.bytes.slice(8,12)),'WEBP');}

async function verifyOnce(a,local){
  const base=new URL(PAGE_URL);if(!base.pathname.endsWith('/'))base.pathname+='/';
  const remoteIndex=await fetchText(base.href,a);publishedEquals(remoteIndex,local.index,'index.html');validateIndex(remoteIndex);
  const remoteNational=await fetchText(new URL('national.js',base).href,a);publishedEquals(remoteNational,local.national,'national.js');validateNational(remoteNational);
  const remoteSw=await fetchText(new URL('sw.js',base).href,a);publishedEquals(remoteSw,local.sw,'sw.js');validateServiceWorker(remoteSw);
  const bg=await fetchBinary(new URL('assets/suruga-bay-fuji-bg.webp',base).href,a);validateWebp(bg);
  const fairs=JSON.parse(await fetchText(new URL('data/fairs.json',base).href,a));
  const stores=JSON.parse(await fetchText(new URL('data/store-contexts.json',base).href,a));
  const storeFallback=JSON.parse(await fetchText(new URL('data/store-contexts-fallback.json',base).href,a));
  freshness(fairs.updatedAt,local.fairs.updatedAt,'fairs');freshness(stores.updatedAt,local.stores.updatedAt,'store-contexts');validateFairs(fairs);validateStores(stores);validateFallbackStores(storeFallback);
  return {status:'ok',verifiedAt:new Date().toISOString(),testedCommit:process.env.GITHUB_SHA||null,pageUrl:base.href,verificationMode:VERIFY_DATA_MODE,publicStaticMatchesSource:true,publicDataAtLeastAsFresh:true,backgroundAssetOk:true,storeFallbackReady:true,fairsUpdatedAt:fairs.updatedAt,storeContextsUpdatedAt:stores.updatedAt,chainCount:fairs.chains.length,localTokaiReady:LOCAL.every(id=>fairs.chains.some(x=>x.chain===id)),chains:Object.fromEntries(fairs.chains.map(x=>[x.chain,{fairName:x.fairName,itemCount:x.items.length,menuHighlightCount:x.menuHighlights?.length||0,status:x.status,qualityState:x.qualityState||null,representativeImage:Boolean(x.representativeImageUrl||x.imageUrl),representativeImageUrl:x.representativeImageUrl||x.imageUrl||null}]))};
}
async function report(x){if(!REPORT_PATH)return;await fs.mkdir(path.dirname(REPORT_PATH),{recursive:true});await fs.writeFile(REPORT_PATH,JSON.stringify(x,null,2)+'\n');}
const local={index:await fs.readFile(path.join(ROOT,'app','index.html'),'utf8'),national:await fs.readFile(path.join(ROOT,'app','national.js'),'utf8'),sw:await fs.readFile(path.join(ROOT,'app','sw.js'),'utf8'),fairs:JSON.parse(await fs.readFile(path.join(ROOT,'app','data','fairs.json'),'utf8')),stores:JSON.parse(await fs.readFile(path.join(ROOT,'app','data','store-contexts.json'),'utf8')),storeFallback:JSON.parse(await fs.readFile(path.join(ROOT,'app','data','store-contexts-fallback.json'),'utf8'))};
let last=null;
for(let a=1;a<=MAX_TRANSIENT_ATTEMPTS;a+=1){
  try{const r=await verifyOnce(a,local);await report(r);console.log('Published sushi app smoke test passed.');console.log(JSON.stringify(r,null,2));process.exit(0);}
  catch(error){last=error;if(!isTransient(error))throw error;console.warn(`Transient smoke attempt ${a}/${MAX_TRANSIENT_ATTEMPTS} failed: ${error.message}`);if(a<MAX_TRANSIENT_ATTEMPTS)await sleep(RETRY_DELAY_MS);}
}
throw last||new Error('Published app smoke test failed');
