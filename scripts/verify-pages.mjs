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
async function fetchBinary(url,a){const r=await fetch(bust(url,a),{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{accept:'image/png,image/*;q=.9,*/*;q=.5','cache-control':'no-cache',pragma:'no-cache'}});if(!r.ok)throw new Error(`${url} returned HTTP ${r.status}`);return {type:r.headers.get('content-type')||'',bytes:new Uint8Array(await r.arrayBuffer())};}

function validateFairs(data){
  assert.equal(data?.schemaVersion,2);
  assert.equal(data?.timezone,'Asia/Tokyo');
  assert.ok(Date.parse(data?.updatedAt));
  assert.equal(data?.locationModel?.mode,'manual_prefecture_city');
  assert.equal(data?.locationModel?.gps,false);
  assert.ok(Array.isArray(data?.chains));
  const by=Object.fromEntries(data.chains.map(x=>[x.chain,x]));
  assert.deepEqual(Object.keys(by).sort(),['hamazushi','kappasushi','kurasushi','sushiro','uobei']);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const chain of data.chains){
    assert.ok(Array.isArray(chain.items));
    assert.match(chain.officialActionUrl||'',/^https:\/\//);
    assert.ok(chain.regionalModel?.strategyKey);
    if(chain.endDate&&chain.endDate<today)assert.notEqual(chain.status,'ok');
    for(const item of chain.items){
      assert.ok(item?.name);
      assert.ok(['active','ended','unknown'].includes(item.saleStatus||'active'));
      assert.ok(item.scrapeStatus);
      if(item.endDate&&item.endDate<today)assert.notEqual(item.saleStatus,'active');
    }
  }
}

function findExact(catalog,chain,prefecture,municipality){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&x.municipality===municipality)||null;}
function findCity(catalog,chain,prefecture,cityPrefix){return Object.values(catalog?.[chain]||{}).find(x=>x.prefecture===prefecture&&String(x.municipality||'').startsWith(cityPrefix))||null;}

function validateStores(data){
  assert.equal(data?.schemaVersion,1,'store-contexts schemaVersion must be 1');
  assert.ok(data?.catalog&&typeof data.catalog==='object');
  for(const chain of ['sushiro','hamazushi','kurasushi','kappasushi','uobei'])assert.ok(data.catalog[chain]&&typeof data.catalog[chain]==='object',`${chain} store catalog missing`);
  const sapporoSushiro=findExact(data.catalog,'sushiro','北海道','札幌市中央区');
  const toyohashiSushiro=findExact(data.catalog,'sushiro','愛知県','豊橋市');
  assert.ok(sapporoSushiro,'Sushiro Sapporo representative store missing');
  assert.ok(toyohashiSushiro,'Sushiro Toyohashi representative store missing');
  assert.equal(sapporoSushiro.storeId,'2575');
  assert.equal(sapporoSushiro.menuAreaCode,'883');
  assert.ok(sapporoSushiro.officialUrl?.includes('id=2575'));
  assert.ok(toyohashiSushiro.menuAreaCode,'Sushiro Toyohashi menuAreaCode missing');
  assert.notEqual(sapporoSushiro.menuAreaCode,toyohashiSushiro.menuAreaCode,'Sushiro regional menu must change between Sapporo and Toyohashi');
  assert.notEqual(sapporoSushiro.officialUrl,toyohashiSushiro.officialUrl,'Sushiro representative store link must change by region');
  assert.notEqual(sapporoSushiro.menuUrl,toyohashiSushiro.menuUrl,'Sushiro menu URL must change by region');
  const hamaHokkaido=findExact(data.catalog,'hamazushi','北海道','札幌市中央区')||data.catalog.hamazushi?.['北海道/*'];
  assert.ok(hamaHokkaido,'Hama Hokkaido resolver missing');
  assert.equal(hamaHokkaido.regionCode,'hokkaido');
  const sapporoKura=findCity(data.catalog,'kurasushi','北海道','札幌市');
  const toyohashiKura=findExact(data.catalog,'kurasushi','愛知県','豊橋市');
  assert.ok(sapporoKura,'Kura Sapporo representative store missing');
  assert.ok(toyohashiKura,'Kura Toyohashi representative store missing');
  assert.notEqual(sapporoKura.officialUrl,toyohashiKura.officialUrl,'Kura representative store link must change by region');
}

function validateIndex(index){
  assert.match(index,/class="app-scene"/,'mobile-safe fixed background layer must exist');
  assert.match(index,/suruga-theme\.css/,'Suruga background stylesheet must be loaded');
  assert.match(index,/id="prefectureSelect"/);
  assert.match(index,/id="citySelect"/);
  assert.match(index,/id="applyRegionBtn"/);
  assert.match(index,/id="regionStatus"/);
  assert.match(index,/id="chainQuickNav"/);
  assert.match(index,/id="cards"/);
  assert.match(index,/data-chain="uobei"/);
  assert.match(index,/\.\/national\.js/);
  assert.doesNotMatch(index,/id="todayHighlights"/,'independent TODAY overview must be removed');
  assert.doesNotMatch(index,/id="summary"/,'independent chain summary must be removed');
  assert.doesNotMatch(index,/\.\/crowd\.js/);
}

function validateNational(source){
  assert.doesNotMatch(source,/todayHighlights|todayDate|\bsummary\b/,'removed overview sections must not be rendered by JS');
  assert.match(source,/c\.store\?\.menuUrl/,'regional Sushiro menu URL must be used when available');
  assert.match(source,/地域メニューを公式で確認/);
  assert.match(source,/店舗・予約を公式で確認/);
  assert.match(source,/region-context-title/);
}

function validatePng(asset){
  assert.match(asset.type,/^image\/png(?:;|$)/i,`Suruga background must be served as image/png, got ${asset.type}`);
  assert.ok(asset.bytes.length>100000,'Suruga background asset is unexpectedly small');
  assert.deepEqual(Array.from(asset.bytes.slice(0,8)),[137,80,78,71,13,10,26,10],'Suruga background does not have a PNG signature');
}

async function verifyOnce(a,localIndex,localNational,localFairs,localStores){
  const base=new URL(PAGE_URL);if(!base.pathname.endsWith('/'))base.pathname+='/';
  const remoteIndex=await fetchText(base.href,a);
  assert.equal(normalize(remoteIndex),normalize(localIndex));
  validateIndex(remoteIndex);
  const bg=await fetchBinary(new URL('assets/suruga-bay-fuji-bg.png',base).href,a);validatePng(bg);
  const nationalText=await fetchText(new URL('national.js',base).href,a);
  assert.equal(normalize(nationalText),normalize(localNational));validateNational(nationalText);
  const fairsText=await fetchText(new URL('data/fairs.json',base).href,a);
  assert.equal(normalize(fairsText),normalize(localFairs));const fairs=JSON.parse(fairsText);validateFairs(fairs);
  const storesText=await fetchText(new URL('data/store-contexts.json',base).href,a);
  assert.equal(normalize(storesText),normalize(localStores));const stores=JSON.parse(storesText);validateStores(stores);
  return{status:'ok',verifiedAt:new Date().toISOString(),testedCommit:process.env.GITHUB_SHA||null,pageUrl:base.href,publicIndexMatchesSource:true,backgroundAssetOk:true,publicNationalMatchesSource:true,publicFairsMatchSource:true,publicStoreContextsMatchSource:true,fairsUpdatedAt:fairs.updatedAt,storeContextsUpdatedAt:stores.updatedAt,storeContextCounts:Object.fromEntries(Object.entries(stores.catalog||{}).map(([k,v])=>[k,Object.keys(v||{}).length])),chains:Object.fromEntries(fairs.chains.map(x=>[x.chain,{fairName:x.fairName,itemCount:x.items.length,status:x.status,representativeImage:Boolean(x.representativeImageUrl||x.imageUrl)}]))};
}

async function report(x){if(!REPORT_PATH)return;await fs.mkdir(path.dirname(REPORT_PATH),{recursive:true});await fs.writeFile(REPORT_PATH,JSON.stringify(x,null,2)+'\n');}
const localIndex=await fs.readFile(path.join(ROOT,'app','index.html'),'utf8');
const localNational=await fs.readFile(path.join(ROOT,'app','national.js'),'utf8');
const localFairs=await fs.readFile(path.join(ROOT,'app','data','fairs.json'),'utf8');
const localStores=await fs.readFile(path.join(ROOT,'app','data','store-contexts.json'),'utf8');
let last=null;
for(let a=1;a<=MAX_ATTEMPTS;a++){
  try{const r=await verifyOnce(a,localIndex,localNational,localFairs,localStores);await report(r);console.log('Published nationwide app smoke test passed.');console.log(JSON.stringify(r,null,2));process.exit(0);}catch(e){last=e;console.warn(`Smoke attempt ${a}/${MAX_ATTEMPTS} failed: ${e.message}`);if(a<MAX_ATTEMPTS)await sleep(RETRY_DELAY_MS);}
}
throw last||new Error('Published app smoke test failed');
