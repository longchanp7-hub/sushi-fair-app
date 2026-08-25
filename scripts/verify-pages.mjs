import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const PAGE_URL=process.argv[2];
const REPORT_PATH=process.env.SMOKE_REPORT_PATH||null;
const MAX_ATTEMPTS=12;
const RETRY_DELAY_MS=5000;
if(!PAGE_URL)throw new Error('Usage: node scripts/verify-pages.mjs <page-url>');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normalize=v=>String(v).replace(/\r\n/g,'\n').trimEnd();
function bust(url,a){const u=new URL(url);u.searchParams.set('__smoke',`${Date.now()}-${a}`);return u.href;}
async function fetchText(url,a){const r=await fetch(bust(url,a),{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{accept:'text/html,application/json,text/plain,*/*;q=.5','cache-control':'no-cache',pragma:'no-cache'}});if(!r.ok)throw new Error(`${url} returned HTTP ${r.status}`);return r.text();}
async function fetchBinary(url,a){const r=await fetch(bust(url,a),{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{accept:'image/webp,image/*;q=.9,*/*;q=.5','cache-control':'no-cache',pragma:'no-cache'}});if(!r.ok)throw new Error(`${url} returned HTTP ${r.status}`);return {type:r.headers.get('content-type')||'',bytes:new Uint8Array(await r.arrayBuffer())};}

const NATIONAL=['hamazushi','kappasushi','kurasushi','sushiro','uobei'];
const LOCAL=['musashimaru','tokubei','totomaru'];
function validateFairs(data){
  assert.equal(data?.schemaVersion,2);assert.equal(data?.timezone,'Asia/Tokyo');assert.ok(Date.parse(data?.updatedAt));assert.equal(data?.locationModel?.mode,'manual_prefecture_city');assert.equal(data?.locationModel?.gps,false);assert.ok(Array.isArray(data?.chains));
  const by=Object.fromEntries(data.chains.map(x=>[x.chain,x]));
  for(const id of NATIONAL)assert.ok(by[id],`${id} fair data missing`);
  const localPresent=LOCAL.filter(id=>by[id]);
  assert.ok(localPresent.length===0||localPresent.length===LOCAL.length,'local Tokai chains must be added as a complete group');
  if(localPresent.length)for(const id of LOCAL)assert.equal(by[id].group,'local_tokai',`${id} group must be local_tokai`);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const chain of data.chains){assert.ok(Array.isArray(chain.items));assert.match(chain.officialActionUrl||'',/^https:\/\//);assert.ok(chain.regionalModel?.strategyKey);if(chain.endDate&&chain.endDate<today)assert.notEqual(chain.status,'ok');for(const item of chain.items){assert.ok(item?.name);assert.ok(['active','ended','unknown'].includes(item.saleStatus||'active'));assert.ok(item.scrapeStatus);if(item.endDate&&item.endDate<today)assert.notEqual(item.saleStatus,'active');}}
}
function findExact(catalog,chain,prefecture,municipality){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&x.municipality===municipality)||null;}
function findCity(catalog,chain,prefecture,cityPrefix){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&String(x.municipality||'').startsWith(cityPrefix))||null;}
function validateStores(data){
  assert.equal(data?.schemaVersion,1,'store-contexts schemaVersion must be 1');assert.ok(data?.catalog&&typeof data.catalog==='object');for(const chain of NATIONAL)assert.ok(data.catalog[chain]&&typeof data.catalog[chain]==='object',`${chain} store catalog missing`);
  const sapporoSushiro=findExact(data.catalog,'sushiro','北海道','札幌市中央区'),toyohashiSushiro=findExact(data.catalog,'sushiro','愛知県','豊橋市');assert.ok(sapporoSushiro);assert.ok(toyohashiSushiro);assert.equal(sapporoSushiro.storeId,'2575');assert.equal(sapporoSushiro.menuAreaCode,'883');assert.ok(toyohashiSushiro.menuAreaCode);assert.notEqual(sapporoSushiro.menuAreaCode,toyohashiSushiro.menuAreaCode);assert.notEqual(sapporoSushiro.menuUrl,toyohashiSushiro.menuUrl);
  const hamaHokkaido=findExact(data.catalog,'hamazushi','北海道','札幌市中央区')||data.catalog.hamazushi?.['北海道/*'];assert.ok(hamaHokkaido);assert.equal(hamaHokkaido.regionCode,'hokkaido');
  const sapporoKura=findCity(data.catalog,'kurasushi','北海道','札幌市'),toyohashiKura=findExact(data.catalog,'kurasushi','愛知県','豊橋市');assert.ok(sapporoKura);assert.ok(toyohashiKura);assert.notEqual(sapporoKura.officialUrl,toyohashiKura.officialUrl);
  const localPresent=LOCAL.filter(id=>data.catalog[id]);assert.ok(localPresent.length===0||localPresent.length===LOCAL.length,'local Tokai store catalogs must be complete');
  if(localPresent.length){assert.ok(findExact(data.catalog,'musashimaru','愛知県','豊橋市'),'Musashimaru Toyohashi missing');assert.ok(findExact(data.catalog,'musashimaru','愛知県','豊川市'),'Musashimaru Toyokawa missing');assert.ok(findExact(data.catalog,'musashimaru','愛知県','蒲郡市'),'Musashimaru Gamagori missing');assert.ok(findExact(data.catalog,'totomaru','愛知県','豊橋市'),'Totomaru Toyohashi missing');assert.ok(findExact(data.catalog,'totomaru','愛知県','豊川市'),'Totomaru Toyokawa missing');}
}
function validateIndex(index){assert.match(index,/class="app-scene"/);assert.match(index,/suruga-theme\.css/);assert.match(index,/local-tokai\.css/);assert.match(index,/id="prefectureSelect"/);assert.match(index,/id="citySelect"/);assert.match(index,/id="applyRegionBtn"/);assert.match(index,/id="regionStatus"/);assert.match(index,/id="chainQuickNavNational"/);assert.match(index,/id="chainQuickNavLocal"/);assert.match(index,/id="cardsNational"/);assert.match(index,/id="cardsLocal"/);for(const id of ['uobei','totomaru','musashimaru','tokubei'])assert.match(index,new RegExp(`data-chain="${id}"`));assert.match(index,/\.\/national\.js/);assert.doesNotMatch(index,/id="todayHighlights"/);assert.doesNotMatch(index,/\.\/crowd\.js/);}
function validateNational(source){assert.match(source,/local_tokai/);assert.match(source,/availableInSelectedArea/);assert.match(source,/chainQuickNavLocal/);assert.match(source,/cardsLocal/);assert.match(source,/c\.store\?\.menuUrl/);assert.match(source,/地域メニューを公式で確認/);assert.match(source,/近隣店舗を公式で確認/);}
function validateWebp(asset){assert.match(asset.type,/^image\/webp(?:;|$)/i);assert.ok(asset.bytes.length>1000);assert.equal(String.fromCharCode(...asset.bytes.slice(0,4)),'RIFF');assert.equal(String.fromCharCode(...asset.bytes.slice(8,12)),'WEBP');}
async function verifyOnce(a,localIndex,localNational,localFairs,localStores){const base=new URL(PAGE_URL);if(!base.pathname.endsWith('/'))base.pathname+='/';const remoteIndex=await fetchText(base.href,a);assert.equal(normalize(remoteIndex),normalize(localIndex));validateIndex(remoteIndex);const bg=await fetchBinary(new URL('assets/suruga-bay-fuji-bg.webp',base).href,a);validateWebp(bg);const nationalText=await fetchText(new URL('national.js',base).href,a);assert.equal(normalize(nationalText),normalize(localNational));validateNational(nationalText);const fairsText=await fetchText(new URL('data/fairs.json',base).href,a);assert.equal(normalize(fairsText),normalize(localFairs));const fairs=JSON.parse(fairsText);validateFairs(fairs);const storesText=await fetchText(new URL('data/store-contexts.json',base).href,a);assert.equal(normalize(storesText),normalize(localStores));const stores=JSON.parse(storesText);validateStores(stores);return{status:'ok',verifiedAt:new Date().toISOString(),testedCommit:process.env.GITHUB_SHA||null,pageUrl:base.href,publicIndexMatchesSource:true,backgroundAssetOk:true,backgroundContentType:bg.type,backgroundBytes:bg.bytes.length,publicNationalMatchesSource:true,publicFairsMatchSource:true,publicStoreContextsMatchSource:true,fairsUpdatedAt:fairs.updatedAt,storeContextsUpdatedAt:stores.updatedAt,chainCount:fairs.chains.length,localTokaiReady:LOCAL.every(id=>fairs.chains.some(x=>x.chain===id)),storeContextCounts:Object.fromEntries(Object.entries(stores.catalog||{}).map(([k,v])=>[k,Object.keys(v||{}).length])),chains:Object.fromEntries(fairs.chains.map(x=>[x.chain,{fairName:x.fairName,itemCount:x.items.length,status:x.status,representativeImage:Boolean(x.representativeImageUrl||x.imageUrl)}]))};}
async function report(x){if(!REPORT_PATH)return;await fs.mkdir(path.dirname(REPORT_PATH),{recursive:true});await fs.writeFile(REPORT_PATH,JSON.stringify(x,null,2)+'\n');}
const localIndex=await fs.readFile(path.join(ROOT,'app','index.html'),'utf8'),localNational=await fs.readFile(path.join(ROOT,'app','national.js'),'utf8'),localFairs=await fs.readFile(path.join(ROOT,'app','data','fairs.json'),'utf8'),localStores=await fs.readFile(path.join(ROOT,'app','data','store-contexts.json'),'utf8');let last=null;for(let a=1;a<=MAX_ATTEMPTS;a++){try{const r=await verifyOnce(a,localIndex,localNational,localFairs,localStores);await report(r);console.log('Published sushi app smoke test passed.');console.log(JSON.stringify(r,null,2));process.exit(0);}catch(e){last=e;console.warn(`Smoke attempt ${a}/${MAX_ATTEMPTS} failed: ${e.message}`);if(a<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS);}}throw last||new Error('Published app smoke test failed');
