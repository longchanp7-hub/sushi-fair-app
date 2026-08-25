import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'store-contexts.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const HAMA_REGIONS = {
  hokkaido:['北海道'], tohoku:['青森県','岩手県','宮城県','秋田県','山形県','福島県'],
  kanto:['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','長野県','山梨県'],
  hokuriku:['新潟県','富山県','石川県','福井県'], tokai:['静岡県','愛知県','岐阜県','三重県'],
  kansai:['滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'], chugoku:['鳥取県','島根県','岡山県','広島県','山口県'],
  shikoku:['徳島県','香川県','愛媛県','高知県'], kyushu:['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県'], okinawa:['沖縄県']
};
const HAMA_LABEL={hokkaido:'北海道',tohoku:'東北',kanto:'関東',hokuriku:'北陸',tokai:'東海',kansai:'関西',chugoku:'中国',shikoku:'四国',kyushu:'九州',okinawa:'沖縄'};

const clean = (v='') => String(v).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs = (v,b) => { try { return new URL(v,b).href; } catch { return null; } };
async function fetchText(url, attempts=2){ let last; for(let i=0;i<attempts;i++){ try{ const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }catch(e){last=e;if(i+1<attempts)await new Promise(r=>setTimeout(r,600*(i+1)));}} throw last; }
async function mapLimit(values, limit, fn){ const out=[]; let p=0; const workers=Array.from({length:Math.min(limit,values.length)},async()=>{while(true){const i=p++;if(i>=values.length)break;try{out[i]=await fn(values[i],i);}catch(e){out[i]={error:e};}}}); await Promise.all(workers); return out; }
function municipality(pref,address){ let s=clean(address); const i=s.indexOf(pref); if(i>=0)s=s.slice(i+pref.length); s=s.replace(/^〒?\d{3}-?\d{4}/,'').trim(); const ward=s.match(/^(.+?市.+?区)/); if(ward)return ward[1]; const city=s.match(/^(.+?市)/); if(city)return city[1]; if(pref==='東京都'){const w=s.match(/^(.+?区)/);if(w)return w[1];} const dist=s.match(/^(.+?郡.+?[町村])/); if(dist)return dist[1].replace(/^.+?郡/,''); const town=s.match(/^(.+?[町村])/); return town?.[1]||null; }
function parentCity(city=''){ const m=city.match(/^(.+?市).+?区$/); return m?.[1]||null; }
function bestCardText($,el,pref){ let cur=$(el); for(let n=0;n<7;n++){ const t=clean(cur.text()); if(t.includes(pref)&&t.length<1000)return t; cur=cur.parent(); } return clean($(el).parent().text()); }
function extractAddress(pref,text){ const t=clean(text); const i=t.indexOf(pref); if(i<0)return null; let s=t.slice(i); const stops=['電話','TEL','営業時間','営業中','営業終了','LINE','お席予約','デジロー','Google']; let end=s.length; for(const x of stops){const j=s.indexOf(x,pref.length);if(j>0)end=Math.min(end,j);} return clean(s.slice(0,end)); }
function key(pref,city){return `${pref}/${city}`;}
function put(map,store){ if(!store?.prefecture||!store?.municipality)return; const k=key(store.prefecture,store.municipality); if(!map[k])map[k]=store; }

async function buildSushiro(){
  const list=[];
  const pages=await mapLimit(PREFS.map((pref,i)=>({pref,no:i+1})),6,async({pref,no})=>({pref,html:await fetchText(`https://www.akindo-sushiro.co.jp/shop/?pref=${no}`)}));
  for(const result of pages){ if(!result||result.error)continue; const {$dummy,...x}=result; const $=cheerio.load(x.html); $('a[href*="detail.php?id="]').each((_,el)=>{ const href=abs($(el).attr('href'),'https://www.akindo-sushiro.co.jp/shop/'); const name=clean($(el).text()).replace(/\s+\d+(?:\.\d+)?km.*$/,''); const card=bestCardText($,el,x.pref); const address=extractAddress(x.pref,card); const city=municipality(x.pref,address||card); const id=href?.match(/[?&]id=(\d+)/)?.[1]; if(href&&id&&city&&name&&!list.some(s=>s.storeId===id))list.push({chain:'sushiro',prefecture:x.pref,municipality:city,storeName:name,storeId:id,address,officialUrl:href,source:'official_store_directory'}); }); }
  const reps={}; for(const s of list)put(reps,s);
  const repList=Object.values(reps);
  const detailed=await mapLimit(repList,8,async s=>{ const html=await fetchText(s.officialUrl,1); const $=cheerio.load(html); const text=clean($.text()); const priceTier=Number(text.match(/一皿\s*(\d+)円/)?.[1]||0)||null; const menuUrl=abs($('a[href*="/menu/menu_detail/"]').first().attr('href'),s.officialUrl); const menuAreaCode=menuUrl?.match(/[?&]s_id=(\d+)/)?.[1]||null; return {...s,priceTier,menuAreaCode,menuUrl,verified:true}; });
  return detailed.filter(x=>x&&!x.error);
}

async function buildKura(){
  const home='https://shop.kurasushi.co.jp/'; const html=await fetchText(home); const $=cheerio.load(html); const prefLinks=[];
  $('a[href]').each((_,el)=>{const text=clean($(el).text());const href=abs($(el).attr('href'),home);if(PREFS.includes(text)&&href&&href.startsWith(home)&&!prefLinks.some(x=>x.pref===text))prefLinks.push({pref:text,url:href});});
  const stores=[]; const pages=await mapLimit(prefLinks,6,async p=>({...p,html:await fetchText(p.url,1)}));
  for(const p of pages){if(!p||p.error)continue;const $p=cheerio.load(p.html);$p('a[href*="/detail/"]').each((_,el)=>{const href=abs($p(el).attr('href'),p.url);const label=clean($p(el).text());const id=href?.match(/\/detail\/(\d+)/)?.[1];if(!href||!id)return;const card=bestCardText($p,el,p.pref);const address=extractAddress(p.pref,card);const city=municipality(p.pref,address||card);const priceTier=Number((label+' '+card).match(/１?皿\s*(\d+)円/)?.[1]||0)||null;const name=label.replace(/〖.*?〗/g,'').replace(/\s+/g,' ').trim();if(city&&name&&!stores.some(s=>s.storeId===id))stores.push({chain:'kurasushi',prefecture:p.pref,municipality:city,storeName:name,storeId:id,address,priceTier,officialUrl:href,verified:true,source:'official_store_directory'});});}
  const reps={};stores.forEach(s=>put(reps,s));return Object.values(reps);
}

function parseTypeLists(html){ const text=clean(cheerio.load(html).text()); const norm=s=>clean(s).replace(/[\s　]/g,''); const sections={}; for(const type of ['B','C','D']){ const start=text.search(new RegExp(`タイプ${type}店舗一覧`)); if(start<0){sections[type]='';continue;} const rest=text.slice(start+7); const indexes=['B','C','D'].filter(t=>t!==type).map(t=>rest.search(new RegExp(`タイプ${t}店舗一覧`))).filter(i=>i>=0); const end=indexes.length?Math.min(...indexes):Math.min(rest.length,12000); sections[type]=norm(rest.slice(0,end)); } return {typeFor(name){const n=norm(name.replace(/※タイプ[A-DＢＣＤ]/g,''));for(const [t,section] of Object.entries(sections))if(n&&section.includes(n))return t;return 'A';}}; }
async function buildKappa(){
  const typePage=await fetchText('https://www.kappasushi.jp/kappa-takeout'); const types=parseTypeLists(typePage);
  const root='https://yoyaku.kappasushi.jp/shop/extent'; const html=await fetchText(root); const $=cheerio.load(html); const areaUrls=[];$('a[href*="/shop/area/area_id/"]').each((_,e)=>{const u=abs($(e).attr('href'),root);if(u&&!areaUrls.includes(u))areaUrls.push(u);});
  const areaPages=await mapLimit(areaUrls,5,async url=>({url,html:await fetchText(url,1)})); const listUrls=[]; for(const p of areaPages){if(!p||p.error)continue;const $p=cheerio.load(p.html);$p('a[href*="/shop/list/area_id/"]').each((_,e)=>{const u=abs($p(e).attr('href'),p.url);if(u&&!listUrls.includes(u))listUrls.push(u);});}
  const listPages=await mapLimit(listUrls,6,async url=>({url,html:await fetchText(url,1)})); const detailUrls=[];for(const p of listPages){if(!p||p.error)continue;const $p=cheerio.load(p.html);$p('a[href*="/shop/detail/"]').each((_,e)=>{const u=abs($p(e).attr('href'),p.url);if(u&&!detailUrls.includes(u))detailUrls.push(u);});}
  const details=await mapLimit(detailUrls,10,async url=>{const html=await fetchText(url,1);const $d=cheerio.load(html);const text=clean($d.text());const name=clean($d('h1,h2,h3').filter((_,e)=>/店/.test(clean($d(e).text()))).first().text()||text.match(/([\p{L}\p{N}・ー（）()]+店)/u)?.[1]||'').replace(/※.*$/,'').trim();const address=text.match(/住所\s*([^\n]{4,120}?)(?:TEL|電話|営業時間|Google)/)?.[1]||null;const pref=PREFS.find(p=>address?.includes(p));const city=pref?municipality(pref,address):null;const shopId=url.match(/shop_id\/(\d+)/)?.[1]||null;if(!pref||!city||!name)return null;return {chain:'kappasushi',prefecture:pref,municipality:city,storeName:name,storeId:shopId,address:clean(address),menuType:types.typeFor(name),officialUrl:url,verified:true,source:'official_reservation_directory+official_menu_type_list'};});
  const reps={};details.filter(Boolean).filter(x=>!x.error).forEach(s=>put(reps,s));return Object.values(reps);
}

function uobeiEmbeddedStores(html){
  const $=cheerio.load(html); const stores=[]; const seen=new Set(); const add=(obj)=>{if(!obj||typeof obj!=='object')return;const name=clean(obj.name||obj.shop_name||obj.store_name||obj.title||'');const address=clean(obj.address||obj.addr||obj.location||'');if(!/魚べい|店/.test(name)||!address)return;const pref=PREFS.find(p=>address.includes(p));const city=pref?municipality(pref,address):null;if(!pref||!city)return;const id=String(obj.id||obj.shop_id||obj.store_id||'');const k=`${name}|${address}`;if(seen.has(k))return;seen.add(k);stores.push({chain:'uobei',prefecture:pref,municipality:city,storeName:name.replace(/^魚べい\s*/,''),storeId:id||null,address,officialUrl:'https://www.uobei.info/store/',priceClass:obj.price_class||obj.priceClass||null,verified:Boolean(obj.price_class||obj.priceClass),source:'official_store_page_embedded_data'});};
  $('script').each((_,e)=>{const t=$(e).html()||'';for(const m of t.matchAll(/\{[^{}]{0,1500}(?:address|住所)[^{}]{0,1500}\}/g)){try{add(JSON.parse(m[0]));}catch{}}});return stores;
}
async function buildUobei(){
  const url='https://www.uobei.info/store/'; const html=await fetchText(url); let stores=uobeiEmbeddedStores(html); const $=cheerio.load(html);
  if(!stores.length){ $('a[href]').each((_,e)=>{const href=abs($(e).attr('href'),url);const txt=clean($(e).text());if(!href||!txt||!/(?:店|魚べい)/.test(txt))return;const card=clean($(e).parent().text());const pref=PREFS.find(p=>card.includes(p));if(!pref)return;const city=municipality(pref,card);if(city)stores.push({chain:'uobei',prefecture:pref,municipality:city,storeName:txt.replace(/^魚べい\s*/,''),storeId:null,address:null,officialUrl:href,priceClass:null,verified:false,source:'official_store_page_link'});}); }
  const reps={};stores.forEach(s=>put(reps,s));return Object.values(reps);
}

function seedHama(){ const out=[]; for(const pref of PREFS){const region=Object.entries(HAMA_REGIONS).find(([,ps])=>ps.includes(pref))?.[0]||null;if(region)out.push({chain:'hamazushi',prefecture:pref,municipality:'*',regionCode:region,regionLabel:HAMA_LABEL[region],officialUrl:'https://maps.hama-sushi.co.jp/jp/address.html',verified:true,source:'official_menu_region_definition'});} return out; }
function seedKnown(){return [
  {chain:'sushiro',prefecture:'北海道',municipality:'札幌市中央区',storeName:'札幌パルコ店',storeId:'2575',menuAreaCode:'883',priceTier:150,officialUrl:'https://www.akindo-sushiro.co.jp/shop/detail.php?id=2575',menuUrl:'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=883',verified:true,source:'official_store_page'},
  {chain:'hamazushi',prefecture:'北海道',municipality:'札幌市中央区',storeName:'札幌中央市場前店',storeId:'4460',regionCode:'hokkaido',regionLabel:'北海道',officialUrl:'https://maps.hama-sushi.co.jp/jp/detail/4460.html',verified:true,source:'official_store_page'},
  {chain:'kurasushi',prefecture:'北海道',municipality:'札幌市白石区',storeName:'ラソラ札幌店',storeId:'570',priceTier:120,officialUrl:'https://shop.kurasushi.co.jp/detail/570',verified:true,source:'official_store_page'}
];}
function mergeChain(catalog,chain,rows){catalog[chain]??={};for(const r of rows||[]){if(!r?.prefecture||!r?.municipality)continue;catalog[chain][key(r.prefecture,r.municipality)]=r;}}

async function main(){
  if(process.argv.includes('--self-test')){console.log(municipality('北海道','北海道札幌市中央区南一条西3-3')==='札幌市中央区'?'Store context self-tests passed.':'fail');return;}
  let previous={};try{previous=JSON.parse(await fs.readFile(OUT,'utf8'));}catch{}
  const catalog=structuredClone(previous.catalog||{}); mergeChain(catalog,'hamazushi',seedHama()); for(const s of seedKnown())mergeChain(catalog,s.chain,[s]);
  const builders=[['sushiro',buildSushiro],['kurasushi',buildKura],['kappasushi',buildKappa],['uobei',buildUobei]];
  for(const [chain,builder] of builders){try{const rows=await builder();if(rows.length)mergeChain(catalog,chain,rows);console.log(`${chain}: ${rows.length} representative municipalities`);}catch(e){console.warn(`${chain} store catalog refresh failed; keeping previous/seed data: ${e.message}`);}}
  const result={schemaVersion:1,updatedAt:new Date().toISOString(),policy:'Official store directories only. Same municipality preferred; ordinance-city fallback may use another ward in the same parent city. Unknown values remain null.',catalog}; await fs.writeFile(OUT,JSON.stringify(result,null,2)+'\n');
  console.log('Built store contexts:',Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,Object.keys(v||{}).length])));
}
await main();
