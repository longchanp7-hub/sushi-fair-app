import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const STORE_PATH=path.join(ROOT,'app','data','store-contexts.json');
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Safari/537.36';
const SOURCES={totomaru:'https://www.comline.co.jp/shoplist/',musashimaru:'https://www.634-jp.com/musashimaru-shop.html',tokubei:'https://www.nigirinotokubei.com/shop/'};
const MATCH={totomaru:/魚魚丸/,musashimaru:/武蔵丸/,tokubei:/徳兵衛/};
const PREFS=['愛知県','静岡県','岐阜県','三重県','長野県','石川県','福井県','富山県'];
const SEEDS={
  totomaru:[['愛知県','豊橋市','魚魚丸 豊橋西岩田店','愛知県豊橋市西岩田6丁目17-2'],['愛知県','豊川市','魚魚丸 豊川店','愛知県豊川市牛久保町城下45-1'],['愛知県','額田郡幸田町','魚魚丸 三ヶ根店','愛知県額田郡幸田町大字深溝字中池田2-3'],['静岡県','浜松市中央区','魚魚丸 浜松森田店','静岡県浜松市中央区森田町101']],
  musashimaru:[['愛知県','豊橋市','武蔵丸 豊橋藤沢本店','愛知県豊橋市藤沢町114'],['愛知県','豊川市','武蔵丸 豊川本店','愛知県豊川市馬場町御堂前74'],['愛知県','蒲郡市','武蔵丸 蒲郡店','愛知県蒲郡市三谷北通4-84-4'],['静岡県','湖西市','武蔵丸 湖西店','静岡県湖西市新居町中之郷4007-1']],
  tokubei:[['愛知県','岡崎市','にぎりの徳兵衛 岡崎欠町店','愛知県岡崎市欠町字石ケ崎下夕通3-1'],['愛知県','豊田市','にぎりの徳兵衛 豊田挙母店','愛知県豊田市挙母町4丁目54-1'],['愛知県','知多郡東浦町','にぎりの徳兵衛 イオンモール東浦店','愛知県知多郡東浦町大字緒川字旭13-2'],['静岡県','浜松市中央区','にぎりの徳兵衛 西塚店','静岡県浜松市中央区神立町122-1']]
};
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:null}catch{return null}};
function municipality(pref,address){let s=clean(address);const i=s.indexOf(pref);if(i>=0)s=s.slice(i+pref.length);s=s.replace(/^〒?\s*\d{3}-?\d{4}/,'').trim();const ward=s.match(/^(.+?市\s*.+?区)/);if(ward)return ward[1].replace(/\s/g,'');const city=s.match(/^(.+?市)/);if(city)return city[1].replace(/\s/g,'');if(pref==='東京都'){const w=s.match(/^(.+?区)/);if(w)return w[1];}const dist=s.match(/^(.+?郡.+?[町村])/);if(dist)return dist[1];return s.match(/^(.+?[町村])/)?.[1]||null;}
function addressFromText(text){const t=clean(text);const pref=PREFS.find(p=>t.includes(p));if(!pref)return null;let s=t.slice(t.indexOf(pref));for(const marker of ['電話','TEL','営業時間','定休日','アクセス','Google','予約']){const i=s.indexOf(marker,pref.length);if(i>0)s=s.slice(0,i);}return {pref,address:clean(s)};}
async function get(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);return r.text();}
function seedRows(chain){return SEEDS[chain].map(([prefecture,municipalityName,storeName,address])=>({chain,prefecture,municipality:municipalityName,storeName,address,officialUrl:SOURCES[chain],verified:true,source:'official_store_directory_seed'}));}
function parseRows(chain,html){const $=cheerio.load(html),rows=[],seen=new Set();$('a,article,li,section,div').each((_,el)=>{const text=clean($(el).text());if(text.length<8||text.length>1000||!MATCH[chain].test(text))return;const loc=addressFromText(text);if(!loc)return;const municipalityName=municipality(loc.pref,loc.address);if(!municipalityName)return;const heading=$(el).find('h1,h2,h3,h4,h5,strong,b').toArray().map(x=>clean($(x).text())).find(x=>MATCH[chain].test(x)&&x.length<80);const link=$(el).is('a')?$(el):$(el).find('a[href]').first();const officialUrl=abs(link.attr('href'),SOURCES[chain])||SOURCES[chain];let storeName=heading||clean($(el).is('a')?$(el).text():'');storeName=storeName.match(/(?:魚魚丸|武蔵丸|にぎりの徳兵衛|徳兵衛)[^〒電話TEL]{0,45}?店/)?.[0]||storeName.match(/[^ ]{2,40}店/)?.[0]||'';if(!storeName)return;const key=`${loc.pref}/${municipalityName}/${storeName}`;if(seen.has(key))return;seen.add(key);rows.push({chain,prefecture:loc.pref,municipality:municipalityName,storeName,address:loc.address,officialUrl,verified:true,source:'official_store_directory'});});return rows;}
function mergeChain(existing,chain,rows){const out={...(existing||{})};for(const row of [...seedRows(chain),...rows]){const key=`${row.prefecture}/${row.municipality}`;if(!out[key]||row.source==='official_store_directory')out[key]={...(out[key]||{}),...row};}return out;}

async function main(){const data=JSON.parse(await fs.readFile(STORE_PATH,'utf8'));data.catalog||={};for(const chain of Object.keys(SOURCES)){let rows=[];try{rows=parseRows(chain,await get(SOURCES[chain]));console.log(`${chain}: ${rows.length} official store rows parsed`);}catch(e){console.warn(`${chain}: store directory refresh failed; retaining verified cache/seeds: ${e.message}`);}data.catalog[chain]=mergeChain(data.catalog[chain],chain,rows);}data.updatedAt=new Date().toISOString();data.localTokaiPolicy='Local Tokai store catalogs are refreshed separately from fair scraping. Exact municipality (or ward within the same ordinance city) only; no same-prefecture distant fallback.';await fs.writeFile(STORE_PATH,JSON.stringify(data,null,2)+'\n');}

if(process.argv.includes('--self-test')){
  assert.equal(municipality('愛知県','愛知県豊橋市西岩田6丁目17-2'),'豊橋市');
  assert.equal(municipality('静岡県','静岡県浜松市中央区森田町101'),'浜松市中央区');
  const synthetic='<article><h3>魚魚丸 豊橋西岩田店</h3><p>〒440-0831 愛知県豊橋市西岩田6丁目17-2</p><a href="/shop/test">店舗詳細</a></article>';
  const rows=parseRows('totomaru',synthetic);assert.equal(rows[0]?.municipality,'豊橋市');assert.match(rows[0]?.officialUrl||'',/^https:/);
  console.log('Local Tokai store catalog self-tests passed.');
}else await main();
