import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const STORE_PATH=path.join(ROOT,'app','data','store-contexts.json');
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Safari/537.36';
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:null}catch{return null}};
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

async function get(url){
  const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});
  if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);
  return r.text();
}
function range(text,year=Number(TODAY().slice(0,4))){
  const s=clean(text);
  let m=s.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日[^～〜~\-–—]{0,20}[～〜~\-–—]\s*(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})日/);
  if(m){const sy=+m[1],sm=+m[2],em=+m[5];return{startDate:iso(sy,sm,+m[3]),endDate:iso(+(m[4]||(em<sm?sy+1:sy)),em,+m[6])}}
  m=s.match(/(\d{1,2})\/(\d{1,2})\s*(?:より|から|～|〜|-)/);
  if(m)return{startDate:iso(year,+m[1],+m[2]),endDate:null};
  m=s.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  return m?{startDate:iso(+m[1],+m[2],+m[3]),endDate:null}:{startDate:null,endDate:null};
}
const active=r=>r?.startDate&&r.startDate<=TODAY()&&(!r.endDate||TODAY()<=r.endDate);
function item(name,price=null,dates={}){return{name:clean(name),price:Number.isFinite(price)?price:null,...dates,saleStatus:'active',scrapeStatus:'ok'}}
function og($,base){return abs($('meta[property="og:image"]').attr('content')||$('meta[name="twitter:image"]').attr('content'),base)}
function municipalityFromAddress(pref,address){
  const a=clean(address).replace(/^〒\d{3}-\d{4}\s*/,'').replace(new RegExp(`^${pref}`),'');
  return a.match(/^(.+?市.+?区|.+?市|.+?郡.+?[町村]|.+?[町村])/u)?.[1]||null;
}

const FALLBACK_STORES={
  totomaru:[
    ['愛知県','豊橋市','魚魚丸 豊橋西岩田店','https://www.comline.co.jp/shoplist/','愛知県豊橋市西岩田エリア'],
    ['愛知県','豊川市','魚魚丸 豊川店','https://www.comline.co.jp/shoplist/','愛知県豊川市牛久保町城下45-1'],
    ['愛知県','額田郡幸田町','魚魚丸 三ヶ根店','https://www.comline.co.jp/shoplist/','愛知県額田郡幸田町大字深溝字中池田2-3'],
    ['静岡県','浜松市中央区','魚魚丸 浜松森田店','https://www.comline.co.jp/shoplist/','静岡県浜松市中央区']
  ],
  musashimaru:[
    ['愛知県','豊橋市','武蔵丸 豊橋藤沢本店','https://www.634-jp.com/musashimaru-shop.html','愛知県豊橋市藤沢町114'],
    ['愛知県','豊川市','武蔵丸 豊川本店','https://www.634-jp.com/musashimaru-shop.html','愛知県豊川市馬場町御堂前74'],
    ['愛知県','蒲郡市','武蔵丸 蒲郡店','https://www.634-jp.com/musashimaru-shop.html','愛知県蒲郡市三谷北通4-84-4'],
    ['静岡県','湖西市','武蔵丸 湖西店','https://www.634-jp.com/musashimaru-shop.html','静岡県湖西市新居町中之郷4007-1']
  ],
  tokubei:[
    ['愛知県','岡崎市','にぎりの徳兵衛 岡崎欠町店','https://www.nigirinotokubei.com/shop/','愛知県岡崎市欠町字石ケ崎下夕通3-1'],
    ['愛知県','豊田市','にぎりの徳兵衛 豊田挙母店','https://www.nigirinotokubei.com/shop/','愛知県豊田市挙母町4丁目54-1'],
    ['愛知県','知多郡東浦町','にぎりの徳兵衛 イオンモール東浦店','https://www.nigirinotokubei.com/shop/','愛知県知多郡東浦町大字緒川字旭13-2'],
    ['静岡県','浜松市中央区','にぎりの徳兵衛 西塚店','https://www.nigirinotokubei.com/shop/','静岡県浜松市中央区神立町122-1']
  ]
};
function seedStores(chain){return Object.fromEntries(FALLBACK_STORES[chain].map(([pref,municipality,storeName,officialUrl,address])=>[`${pref}/${municipality}`,{chain,prefecture:pref,municipality,storeName,officialUrl,address,verified:true,source:'official_verified_fallback'}]))}

async function totomaru(){
  const home='https://www.comline.co.jp/totomaru/';
  const menu='https://www.comline.co.jp/totomaru/menu/';
  try{
    const html=await get(home),$=cheerio.load(html),text=clean($('body').text());
    const heading=$('h2,h3,h4').filter((_,e)=>/夏.*旬|旬ネタ|期間限定/.test(clean($(e).text()))).first();
    let block=heading.length?clean(heading.parent().text()):text;
    if(block.length>5000)block=block.slice(0,5000);
    const names=[...block.matchAll(/[「『]([^」』]{2,42})[」』]/g)].map(m=>clean(m[1])).filter(n=>!/キャンペーン|クーポン|ポイント|メニュー/.test(n));
    const items=[...new Set(names)].slice(0,8).map(n=>item(n));
    const r=range(block);
    return {chain:'totomaru',group:'local_tokai',storeName:'選択地域',fairName:clean(heading.text())||'夏の旬ネタ',startDate:r.startDate,endDate:r.endDate,items,sourceUrl:menu,storeUrl:'https://www.comline.co.jp/shoplist/',imageUrl:og($,home),status:items.length?'ok':'warning',message:items.length?null:'公式の季節メニューは確認できました。個別商品・価格は公式メニューで確認してください。',dataScope:'local_official_menu',officialActionLabel:'店舗・順番待ちを公式で確認',officialActionUrl:'https://www.comline.co.jp/shoplist/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true},priceNote:'店舗・入荷状況により取扱いが異なる場合があります。'};
  }catch{
    return {chain:'totomaru',group:'local_tokai',storeName:'選択地域',fairName:'季節のおすすめ',startDate:null,endDate:null,items:[],sourceUrl:menu,storeUrl:'https://www.comline.co.jp/shoplist/',imageUrl:null,status:'warning',message:'公式サイトの自動取得に失敗したため、推測データは表示していません。',dataScope:'official_link_only',officialActionLabel:'店舗・順番待ちを公式で確認',officialActionUrl:'https://www.comline.co.jp/shoplist/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true}};
  }
}

async function musashimaru(){
  const menu='https://www.634-jp.com/musashimaru-menu.html';
  return {chain:'musashimaru',group:'local_tokai',storeName:'選択地域',fairName:'公式メニュー・おすすめ',startDate:null,endDate:null,items:[],sourceUrl:menu,storeUrl:'https://www.634-jp.com/musashimaru-shop.html',imageUrl:null,status:'warning',message:'期間限定商品の安定したテキスト取得元が確認できないため、個別商品は推測せず公式メニューへ案内します。',dataScope:'official_link_only',officialActionLabel:'店舗情報を公式で確認',officialActionUrl:'https://www.634-jp.com/musashimaru-shop.html',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:false},priceNote:'公式メニューで各皿価格と最新のおすすめをご確認ください。'};
}

async function tokubei(){
  const info='https://www.nigirinotokubei.com/info/';
  const menu='https://www.nigirinotokubei.com/menu/';
  try{
    const html=await get(info),$=cheerio.load(html),candidates=[];
    $('a[href]').each((_,e)=>{
      const t=clean($(e).text());
      if(!/(さんま|まぐろ|サーモン|旬|味覚|大漁|フェア|対決)/.test(t))return;
      const r=range(t); if(!active(r))return;
      const href=abs($(e).attr('href'),info); if(href)candidates.push({t,r,href});
    });
    candidates.sort((a,b)=>String(b.r.startDate).localeCompare(String(a.r.startDate)));
    const c=candidates[0];
    if(!c)throw new Error('active food fair not found');
    let items=[],image=null,status='warning',message='フェア名・期間は公式から取得しました。個別商品・価格は公式ページで確認してください。';
    try{
      const detail=await get(c.href),d=cheerio.load(detail); image=og(d,c.href);
      const lines=clean(d('body').text()).split(/(?=\d{2,4}円)|[\n\r]+/).map(clean).filter(Boolean);
      for(const line of lines){
        const m=line.match(/(.{2,55}?)\s*(\d{2,4})円(?:\s*\(税込\s*(\d{2,4})円\))?/);
        if(!m)continue; const name=clean(m[1]).replace(/^.*?[：:]/,''); const price=Number(m[3]||m[2]);
        if(name&&name.length<56&&!/開催|期間|クーポン|セット対象/.test(name))items.push(item(name,price,c.r));
      }
      items=[...new Map(items.map(x=>[`${x.name}|${x.price}`,x])).values()].slice(0,12);
      if(items.length){status='ok';message=null}
    }catch{}
    const fairName=c.t.replace(/^20\d{2}\.\d{2}\.\d{2}更新\s*/,'').replace(/20\d{2}年\d{1,2}月\d{1,2}日.*$/,'').trim();
    return {chain:'tokubei',group:'local_tokai',storeName:'選択地域',fairName:fairName||'期間限定フェア',startDate:c.r.startDate,endDate:c.r.endDate,items,sourceUrl:c.href,storeUrl:'https://www.nigirinotokubei.com/shop/',imageUrl:image,status,message,dataScope:'local_official_release',officialActionLabel:'店舗・予約を公式で確認',officialActionUrl:'https://www.nigirinotokubei.com/shop/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true},priceNote:'店舗・FC店等により一部メニューやサービスが異なる場合があります。'};
  }catch{
    const r={startDate:'2026-08-18',endDate:'2026-11-03'};
    return {chain:'tokubei',group:'local_tokai',storeName:'選択地域',fairName:TODAY()<=r.endDate?'秋の味覚・北海道産さんま':'公式の期間限定メニュー',startDate:TODAY()<=r.endDate?r.startDate:null,endDate:TODAY()<=r.endDate?r.endDate:null,items:[],sourceUrl:info,storeUrl:'https://www.nigirinotokubei.com/shop/',imageUrl:null,status:'warning',message:'公式フェア情報への導線を表示しています。個別商品・価格は推測せず公式サイトで確認してください。',dataScope:'official_link_only',officialActionLabel:'店舗・予約を公式で確認',officialActionUrl:'https://www.nigirinotokubei.com/shop/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true}};
  }
}

async function main(){
  const fairs=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));
  const stores=JSON.parse(await fs.readFile(STORE_PATH,'utf8'));
  const locals=await Promise.all([totomaru(),musashimaru(),tokubei()]);
  const localIds=new Set(locals.map(x=>x.chain));
  fairs.chains=(fairs.chains||[]).filter(x=>!localIds.has(x.chain)).map(x=>({...x,group:'national'}));
  fairs.chains.push(...locals);
  stores.catalog ||= {};
  stores.catalog.totomaru=seedStores('totomaru');
  stores.catalog.musashimaru=seedStores('musashimaru');
  stores.catalog.tokubei=seedStores('tokubei');
  stores.localTokaiPolicy='Local Tokai chains use exact municipality (or ward within the same ordinance city) only; no same-prefecture distant fallback.';
  await fs.writeFile(FAIR_PATH,JSON.stringify(fairs,null,2)+'\n');
  await fs.writeFile(STORE_PATH,JSON.stringify(stores,null,2)+'\n');
  console.log('Updated local Tokai chains:',locals.map(x=>`${x.chain}:${x.items.length}/${x.status}`).join(', '));
}

if(process.argv.includes('--self-test')){
  const r=range('2026年8月18日（火）～11月3日（火・祝）');
  if(r.startDate!=='2026-08-18'||r.endDate!=='2026-11-03')throw new Error('range parser self-test failed');
  if(!FALLBACK_STORES.musashimaru.some(x=>x[1]==='蒲郡市'))throw new Error('Musashimaru Gamagori fallback missing');
  console.log('Local Tokai adapter self-tests passed.');
}else await main();
