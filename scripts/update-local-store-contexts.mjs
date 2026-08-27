import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const STORE_PATH=path.join(ROOT,'app','data','store-contexts.json');
const FIXTURE_DIR=path.join(ROOT,'scripts','fixtures');
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Safari/537.36';
const SOURCES={totomaru:'https://www.comline.co.jp/shoplist/',musashimaru:'https://www.634-jp.com/musashimaru-shop.html',tokubei:'https://www.nigirinotokubei.com/shop/'};
const ADDRESS_API='https://geolonia.github.io/japanese-addresses/api/ja.json';
const PREFS=['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const MIN_ROWS={totomaru:12,musashimaru:5,tokubei:12};
const MIN_KEYS={totomaru:10,musashimaru:4,tokubei:10};
const SEEDS={
  totomaru:[['愛知県','豊橋市','魚魚丸 豊橋西岩田店','愛知県豊橋市西岩田6丁目17-2'],['愛知県','豊川市','魚魚丸 豊川店','愛知県豊川市牛久保町城下45-1'],['愛知県','額田郡幸田町','魚魚丸 三ヶ根店','愛知県額田郡幸田町大字深溝字中池田2-3'],['静岡県','浜松市中央区','魚魚丸 浜松森田店','静岡県浜松市中央区森田町101']],
  musashimaru:[['愛知県','豊橋市','武蔵丸 豊橋藤沢本店','愛知県豊橋市藤沢町114'],['愛知県','豊川市','武蔵丸 豊川本店','愛知県豊川市馬場町御堂前74'],['愛知県','蒲郡市','武蔵丸 蒲郡店','愛知県蒲郡市三谷北通4-84-4'],['静岡県','湖西市','武蔵丸 湖西店','静岡県湖西市新居町中之郷4007-1']],
  tokubei:[['愛知県','岡崎市','にぎりの徳兵衛 岡崎欠町店','愛知県岡崎市欠町字石ケ崎下夕通3-1'],['愛知県','豊田市','にぎりの徳兵衛 豊田挙母店','愛知県豊田市挙母町4丁目54-1'],['愛知県','知多郡東浦町','にぎりの徳兵衛 イオンモール東浦店','愛知県知多郡東浦町大字緒川字旭13-2'],['静岡県','浜松市中央区','にぎりの徳兵衛 西塚店','静岡県浜松市中央区神立町122-1']]
};

const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:null}catch{return null}};
const ownText=($,el)=>clean($(el).clone().children().remove().end().text());
const keyOf=row=>`${row.prefecture}/${row.municipality}`;

function municipality(pref,address){
  let s=clean(address);
  const i=s.indexOf(pref);
  if(i>=0)s=s.slice(i+pref.length);
  s=s.replace(/^〒?\s*\d{3}-?\d{4}/,'').trim();
  const ward=s.match(/^(.+?市\s*.+?区)/);if(ward)return ward[1].replace(/\s/g,'');
  const city=s.match(/^(.+?市)/);if(city)return city[1].replace(/\s/g,'');
  if(pref==='東京都'){const w=s.match(/^(.+?区)/);if(w)return w[1];}
  const dist=s.match(/^(.+?郡.+?[町村])/);if(dist)return dist[1];
  return s.match(/^(.+?[町村])/)?.[1]||null;
}

function cutAddress(s){
  let out=clean(s);
  for(const marker of ['TEL','Tel','tel','電話','営業時間','定休日','アクセス','Google','予約','｜','|']){
    const i=out.indexOf(marker);
    if(i>0)out=out.slice(0,i);
  }
  return clean(out).replace(/[、,]+$/,'');
}

function buildMunicipalityIndex(raw){
  const byName=new Map();
  for(const [pref,values] of Object.entries(raw||{})){
    for(const name of Array.isArray(values)?values:[]){
      const n=clean(name);if(!n)continue;
      const set=byName.get(n)||new Set();set.add(pref);byName.set(n,set);
    }
  }
  return byName;
}

async function loadMunicipalityIndex(){
  const r=await fetch(ADDRESS_API,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':UA,'cache-control':'no-cache'}});
  if(!r.ok)throw new Error(`municipality index HTTP ${r.status}`);
  return buildMunicipalityIndex(await r.json());
}

function explicitLocation(text){
  const t=clean(text);
  let best=null;
  for(const pref of PREFS){
    const i=t.indexOf(pref);
    if(i>=0&&(!best||i<best.i))best={pref,i};
  }
  if(!best)return null;
  const address=cutAddress(t.slice(best.i));
  const municipalityName=municipality(best.pref,address);
  return municipalityName?{pref:best.pref,address,municipality:municipalityName}:null;
}

function inferredLocation(text,geoIndex){
  if(!geoIndex?.size)return null;
  const t=clean(text);
  const matches=[];
  for(const [name,prefs] of geoIndex){
    const i=t.indexOf(name);
    if(i<0||prefs.size!==1)continue;
    matches.push({name,pref:[...prefs][0],i});
  }
  if(!matches.length)return null;
  matches.sort((a,b)=>a.i-b.i||b.name.length-a.name.length);
  const first=matches[0];
  const postal=[...t.matchAll(/〒?\s*\d{3}-?\d{4}/g)].filter(m=>m.index<=first.i).at(-1);
  let start=postal?postal.index+postal[0].length:first.i;
  if(!postal){
    const before=t.slice(Math.max(0,first.i-12),first.i);
    const district=before.match(/([^\s〒]{1,8}郡)$/);
    if(district)start=first.i-district[1].length;
  }
  let address=cutAddress(t.slice(start));
  if(!address.includes(first.name))address=cutAddress(t.slice(first.i));
  const fullAddress=address.startsWith(first.pref)?address:`${first.pref}${address}`;
  const municipalityName=municipality(first.pref,fullAddress);
  return municipalityName?{pref:first.pref,address:fullAddress,municipality:municipalityName}:null;
}

function locationFromText(text,geoIndex=null){return explicitLocation(text)||inferredLocation(text,geoIndex);}

function decodeHtml(bytes,contentType=''){
  const buf=Buffer.from(bytes);
  const head=buf.subarray(0,8192).toString('latin1');
  const declared=(contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]||
    head.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i)?.[1]||
    head.match(/charset\s*=\s*([^"'\s;>]+)/i)?.[1]||'utf-8').toLowerCase();
  const label=/shift[_-]?jis|sjis|windows-31j|cp932/.test(declared)?'shift_jis':/euc[_-]?jp/.test(declared)?'euc-jp':'utf-8';
  try{return new TextDecoder(label).decode(buf)}catch{return buf.toString('utf8')}
}

async function get(url){
  const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});
  if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);
  return decodeHtml(await r.arrayBuffer(),r.headers.get('content-type')||'');
}

function seedRows(chain){
  return SEEDS[chain].map(([prefecture,municipalityName,storeName,address])=>({chain,prefecture,municipality:municipalityName,storeName,address,officialUrl:SOURCES[chain],verified:true,source:'official_store_directory_seed'}));
}

function row(chain,loc,storeName,officialUrl){
  return {chain,prefecture:loc.pref,municipality:loc.municipality,storeName:clean(storeName),address:loc.address,officialUrl:officialUrl||SOURCES[chain],verified:true,source:'official_store_directory'};
}

function siblingWindowText($,el,limit=8){
  const parts=[clean($(el).text())];
  let n=$(el).next(),count=0;
  while(n.length&&count<limit){
    if(n.is('h2,h3,h4,h5'))break;
    parts.push(clean(n.text()));n=n.next();count++;
  }
  return clean(parts.join(' '));
}

function locationNear($,el,geoIndex=null){
  const candidates=[];
  const tr=$(el).closest('tr');if(tr.length)candidates.push(tr);
  let node=$(el);
  for(let i=0;i<4&&node.length;i++,node=node.parent()){
    const text=clean(node.text());if(text&&text.length<1800)candidates.push(node);
  }
  let next=$(el).next(),count=0;
  const parts=[clean($(el).text())];
  while(next.length&&count<8){
    if(next.is('h1,h2,h3,h4,h5')&&count>0)break;
    parts.push(clean(next.text()));next=next.next();count++;
  }
  const siblingText=clean(parts.join(' '));if(siblingText)candidates.unshift({text:()=>siblingText});
  for(const c of candidates){
    const text=typeof c.text==='function'?clean(c.text()):clean(c);
    const loc=locationFromText(text,geoIndex);if(loc)return loc;
  }
  return null;
}

export function parseTotomaruStores(html,geoIndex=null){
  const $=cheerio.load(html),rows=[],seen=new Set();let inSection=false;
  $('h2,h3').each((_,el)=>{
    if($(el).is('h2')){inSection=clean($(el).text())==='魚魚丸';return;}
    if(!inSection)return;
    let name=clean($(el).text()).replace(/\s+/g,' ');
    if(!name||!/店$/.test(name))return;
    const text=siblingWindowText($,el,8);
    const loc=locationFromText(text,geoIndex);if(!loc)return;
    const storeName=name.startsWith('魚魚丸')?name:`魚魚丸 ${name}`;
    const key=`${loc.pref}/${loc.municipality}/${storeName}`;
    if(seen.has(key))return;seen.add(key);
    rows.push(row('totomaru',loc,storeName,SOURCES.totomaru));
  });
  return rows;
}

export function parseMusashimaruStores(html,geoIndex=null){
  const $=cheerio.load(html),rows=[],seen=new Set(),links=new Map();
  $('a[href]').each((_,el)=>{
    const name=clean($(el).text());
    if(/^武蔵丸\s+.+店$/.test(name))links.set(name,abs($(el).attr('href'),SOURCES.musashimaru)||SOURCES.musashimaru);
  });
  for(const [storeName,officialUrl] of links){
    const matches=[];
    $('body *').each((_,el)=>{
      const text=clean($(el).text());
      if(text.length<storeName.length||text.length>1400||!text.includes(storeName))return;
      const loc=locationFromText(text,geoIndex);if(loc)matches.push({loc,length:text.length});
    });
    matches.sort((a,b)=>a.length-b.length);
    const loc=matches[0]?.loc;if(!loc)continue;
    const key=`${loc.pref}/${loc.municipality}/${storeName}`;
    if(seen.has(key))continue;seen.add(key);
    rows.push(row('musashimaru',loc,storeName,officialUrl));
  }
  if(rows.length)return rows;
  $('h1,h2,h3,h4,h5,strong,b,p,td,th,div').each((_,el)=>{
    const text=ownText($,el),m=text.match(/武蔵丸\s+[^〒電話TEL]{1,40}?店/);if(!m)return;
    const storeName=clean(m[0]),loc=locationNear($,el,geoIndex);if(!loc)return;
    const key=`${loc.pref}/${loc.municipality}/${storeName}`;if(seen.has(key))return;seen.add(key);
    rows.push(row('musashimaru',loc,storeName,SOURCES.musashimaru));
  });
  return rows;
}

export function parseTokubeiStores(html,geoIndex=null){
  const $=cheerio.load(html),rows=[],seen=new Set();
  $('a[href]').each((_,el)=>{
    const href=abs($(el).attr('href'),SOURCES.tokubei);
    if(!href||!/^https:\/\/www\.nigirinotokubei\.com\/shop\/[^/]+\/?$/i.test(href)||href===SOURCES.tokubei)return;
    let name=clean($(el).text()).replace(/\s*※\s*FC店舗\s*/g,'').trim();
    if(!name||!/店$/.test(name))return;
    const loc=locationNear($,el,geoIndex);if(!loc)return;
    const storeName=name.startsWith('にぎりの徳兵衛')?name:`にぎりの徳兵衛 ${name}`;
    const key=`${loc.pref}/${loc.municipality}/${storeName}`;
    if(seen.has(key))return;seen.add(key);
    rows.push(row('tokubei',loc,storeName,href));
  });
  return rows;
}

const PARSERS={totomaru:parseTotomaruStores,musashimaru:parseMusashimaruStores,tokubei:parseTokubeiStores};

function representatives(existing,rows){
  const grouped=new Map();
  for(const r of rows){const key=keyOf(r),list=grouped.get(key)||[];list.push(r);grouped.set(key,list);}
  const out={};
  for(const [key,list] of grouped){
    const old=existing?.[key];
    const chosen=(old?.storeName&&list.find(r=>r.storeName===old.storeName))||[...list].sort((a,b)=>a.storeName.localeCompare(b.storeName,'ja'))[0];
    out[key]={...chosen};
  }
  return out;
}

function fallbackChain(existing,chain){
  const retained=Object.fromEntries(Object.entries(existing||{}).filter(([,x])=>x?.verified!==false));
  if(Object.keys(retained).length)return retained;
  return representatives({},seedRows(chain));
}

function health(chain,rows,existing){
  const keys=new Set(rows.map(keyOf)).size;
  const previousKeys=Object.keys(existing||{}).length;
  const dynamicFloor=previousKeys>=MIN_KEYS[chain]?Math.ceil(previousKeys*.6):0;
  const healthy=rows.length>=MIN_ROWS[chain]&&keys>=Math.max(MIN_KEYS[chain],dynamicFloor);
  return {healthy,keys,previousKeys};
}

function warn(chain,message){console.warn(`::warning title=Local store parser::${chain} ${message}`);}

async function main(){
  const data=JSON.parse(await fs.readFile(STORE_PATH,'utf8'));data.catalog||={};
  let geoIndex=null;
  try{geoIndex=await loadMunicipalityIndex();}catch(e){console.warn(`::warning title=Local store parser geography::Municipality index unavailable; prefecture-omitted addresses will be skipped (${e.message})`);}
  let unhealthy=0;
  for(const chain of Object.keys(SOURCES)){
    const existing=data.catalog[chain]||{};let rows=[],fetchOk=false;
    try{
      rows=PARSERS[chain](await get(SOURCES[chain]),geoIndex);fetchOk=true;
      const h=health(chain,rows,existing);
      if(h.healthy){
        data.catalog[chain]=representatives(existing,rows);
        console.log(`${chain}: ${rows.length} official store rows parsed (${h.keys} municipalities); refreshed live catalog`);
      }else{
        unhealthy++;
        data.catalog[chain]=fallbackChain(existing,chain);
        warn(chain,`official store parser returned ${rows.length} rows / ${h.keys} municipalities; retained verified cache`);
      }
    }catch(e){
      unhealthy++;
      data.catalog[chain]=fallbackChain(existing,chain);
      warn(chain,`store directory refresh failed; retained verified cache (${e.message})`);
    }
    if(fetchOk&&!rows.length)console.log(`${chain}: official page fetched but yielded no safe store rows`);
  }
  if(unhealthy===Object.keys(SOURCES).length)console.warn('::warning title=Local store parser health::All local store parsers were unhealthy; retained verified caches/seeds');
  data.updatedAt=new Date().toISOString();
  data.localTokaiPolicy='Local Tokai store catalogs use chain-specific official-directory parsers. Healthy live results rebuild each chain so closures/moves can be reflected; parser/fetch anomalies retain verified cache/seeds. Exact municipality (or ward within the same ordinance city) only; no same-prefecture distant fallback.';
  await fs.writeFile(STORE_PATH,JSON.stringify(data,null,2)+'\n');
}

async function selfTest(){
  assert.equal(municipality('愛知県','愛知県豊橋市西岩田6丁目17-2'),'豊橋市');
  assert.equal(municipality('静岡県','静岡県浜松市中央区森田町101'),'浜松市中央区');
  const geo=buildMunicipalityIndex({'愛知県':['豊橋市','岡崎市'],'静岡県':['湖西市'],'広島県':['府中市'],'東京都':['府中市']});
  assert.equal(inferredLocation('〒441-8059 豊橋市柱五番町116-1',geo)?.pref,'愛知県');
  assert.equal(inferredLocation('府中市本町1-1',geo),null,'Ambiguous municipality must not guess a prefecture');

  const [totoHtml,musaHtml,tokuHtml]=await Promise.all([
    fs.readFile(path.join(FIXTURE_DIR,'totomaru-store-list.html'),'utf8'),
    fs.readFile(path.join(FIXTURE_DIR,'musashimaru-store-list.html'),'utf8'),
    fs.readFile(path.join(FIXTURE_DIR,'tokubei-store-list.html'),'utf8')
  ]);
  const toto=parseTotomaruStores(totoHtml,geo);
  assert.equal(toto.length,2);assert.equal(toto[0].prefecture,'愛知県');assert.equal(toto[0].municipality,'豊橋市');assert.match(toto[0].storeName,/魚魚丸 豊橋店/);
  assert.ok(!toto.some(x=>/金の魚魚丸/.test(x.storeName)),'Totomaru parser must stop at next brand heading');

  const musa=parseMusashimaruStores(musaHtml,geo);
  assert.equal(musa.length,2);assert.ok(musa.some(x=>x.storeName==='武蔵丸 豊橋藤沢本店'&&x.municipality==='豊橋市'));assert.ok(musa.some(x=>x.storeName==='武蔵丸 湖西店'&&x.prefecture==='静岡県'));

  const toku=parseTokubeiStores(tokuHtml,geo);
  assert.equal(toku.length,2);assert.ok(toku.some(x=>x.storeName==='にぎりの徳兵衛 岡崎欠町店'&&/\/shop\/900\/$/.test(x.officialUrl)));assert.ok(toku.every(x=>x.storeName.startsWith('にぎりの徳兵衛 ')));

  const stale={'愛知県/豊橋市':{chain:'totomaru',prefecture:'愛知県',municipality:'豊橋市',storeName:'魚魚丸 閉店済み店',address:'愛知県豊橋市旧町1',officialUrl:SOURCES.totomaru,verified:true,source:'official_store_directory'}};
  const rebuilt=representatives(stale,toto);assert.notEqual(rebuilt['愛知県/豊橋市']?.storeName,'魚魚丸 閉店済み店','Healthy rebuild must remove stale representative');
  const retained=fallbackChain(stale,'totomaru');assert.equal(retained['愛知県/豊橋市']?.storeName,'魚魚丸 閉店済み店','Failure fallback must retain verified cache');
  console.log('Local Tokai chain-specific store parser self-tests passed.');
}

if(process.argv.includes('--self-test'))await selfTest();else await main();
