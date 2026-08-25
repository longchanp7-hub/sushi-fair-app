import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Safari/537.36';
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:null}catch{return null}};
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
async function get(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);return r.text();}
function range(text,year=Number(TODAY().slice(0,4))){const s=clean(text);let m=s.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日[^～〜~\-–—]{0,20}[～〜~\-–—]\s*(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})日/);if(m){const sy=+m[1],sm=+m[2],em=+m[5];return{startDate:iso(sy,sm,+m[3]),endDate:iso(+(m[4]||(em<sm?sy+1:sy)),em,+m[6])}}m=s.match(/(\d{1,2})\/(\d{1,2})\s*(?:より|から|～|〜|-)/);if(m)return{startDate:iso(year,+m[1],+m[2]),endDate:null};m=s.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?{startDate:iso(+m[1],+m[2],+m[3]),endDate:null}:{startDate:null,endDate:null};}
const active=r=>!r?.startDate||r.startDate<=TODAY()&&(!r.endDate||TODAY()<=r.endDate);
function item(name,price=null,dates={},sourceUrl=null){return{name:clean(name),price:Number.isFinite(price)?price:null,...dates,saleStatus:'active',scrapeStatus:'ok',sourceUrl}}
function og($,base){return abs($('meta[property="og:image"]').attr('content')||$('meta[name="twitter:image"]').attr('content'),base)}
function isGenericOg(url){return !url||/\/img\/cmn\/og\.png(?:\?|$)/i.test(url)||/\/favicon|\/logo(?:[._-]|\/)/i.test(url)}
function parsePricedText(text,dates={},sourceUrl=null){const out=[],s=clean(text),re=/([^0-9¥￥]{2,60}?)\s*(?:¥|￥)?\s*(\d{2,4})円(?:\s*[（(]\s*税込\s*(\d{2,4})円\s*[）)])?/g;for(const m of s.matchAll(re)){let name=clean(m[1]).replace(/^.*?[：:]/,'').replace(/^[・●■★☆◆◇※\s]+/,'').trim();const price=Number(m[3]||m[2]);if(!name||name.length>55||!/\p{L}/u.test(name))continue;if(/開催|期間|クーポン|セット対象|税込|更新|販売|店舗|お知らせ|価格|円$/.test(name))continue;if(!Number.isFinite(price)||price<50||price>9999)continue;out.push(item(name,price,dates,sourceUrl));}return out;}
const dedupe=items=>[...new Map(items.filter(x=>x?.name).map(x=>[`${clean(x.name)}|${x.price??''}`,x])).values()];
const musashimaruHighlights=menu=>[
  {name:'店内寿司メニュー',priceFrom:176,note:'税込176円〜',sourceUrl:menu,sourceType:'official_menu_page'},
  {name:'釣り魚・国産食材の寿司',priceFrom:null,note:'最新ネタは公式メニュー・店頭で確認',sourceUrl:'https://www.634-jp.com/musashimaru.html',sourceType:'official_brand_page'}
];

async function totomaru(){
  const home='https://www.comline.co.jp/totomaru/',menu='https://www.comline.co.jp/totomaru/menu/';
  try{
    const html=await get(home),$=cheerio.load(html),campaigns=[];
    $('h2,h3,h4').each((_,el)=>{const title=clean($(el).text());if(!/旬|期間限定|おすすめ|フェア|祭/.test(title))return;let block=$(el).parent();let text=clean(block.text());if(text.length>5000)text=text.slice(0,5000);const dates=range(text);if(!active(dates))return;const names=[...text.matchAll(/[「『]([^」』]{2,42})[」』]/g)].map(m=>clean(m[1])).filter(n=>!/キャンペーン|クーポン|ポイント|メニュー/.test(n));const items=dedupe(names.map(n=>item(n,null,dates,menu))).slice(0,12);if(items.length||title)campaigns.push({fairName:title||'旬のおすすめ',...dates,items,sourceUrl:menu});});
    const uniqueCampaigns=[...new Map(campaigns.map(c=>[c.fairName,c])).values()].slice(0,6);
    let items=dedupe(uniqueCampaigns.flatMap(c=>c.items)).slice(0,24);
    if(!items.length){const text=clean($('body').text()).slice(0,6000);const names=[...text.matchAll(/[「『]([^」』]{2,42})[」』]/g)].map(m=>clean(m[1])).filter(n=>!/キャンペーン|クーポン|ポイント|メニュー/.test(n));items=dedupe(names.map(n=>item(n,null,{},menu))).slice(0,8);if(items.length)uniqueCampaigns.push({fairName:'旬のおすすめ',startDate:null,endDate:null,items,sourceUrl:menu});}
    const primary=uniqueCampaigns[0]||{fairName:'旬のおすすめ',startDate:null,endDate:null,items};
    const menuHighlights=items.slice(0,3).map(x=>({name:x.name,price:x.price,sourceUrl:x.sourceUrl||menu,sourceType:'official_menu_item'}));
    return {chain:'totomaru',group:'local_tokai',storeName:'選択地域',fairName:primary.fairName,startDate:primary.startDate,endDate:primary.endDate,items,campaigns:uniqueCampaigns,menuHighlights,sourceUrl:menu,storeUrl:'https://www.comline.co.jp/shoplist/',imageUrl:isGenericOg(og($,home))?null:og($,home),status:items.length?'ok':'warning',message:items.length?null:'公式の季節メニューは確認できました。個別商品・価格は公式メニューで確認してください。',dataScope:'local_official_menu',officialActionLabel:'店舗・順番待ちを公式で確認',officialActionUrl:'https://www.comline.co.jp/shoplist/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true},priceNote:'店舗・入荷状況により取扱いが異なる場合があります。'};
  }catch{return {chain:'totomaru',group:'local_tokai',storeName:'選択地域',fairName:'季節のおすすめ',startDate:null,endDate:null,items:[],campaigns:[],menuHighlights:[],sourceUrl:menu,storeUrl:'https://www.comline.co.jp/shoplist/',imageUrl:null,status:'warning',message:'公式サイトの自動取得に失敗したため、推測データは表示していません。',dataScope:'official_link_only',officialActionLabel:'店舗・順番待ちを公式で確認',officialActionUrl:'https://www.comline.co.jp/shoplist/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true}};}
}
async function musashimaru(){const menu='https://www.634-jp.com/musashimaru-menu.html';return {chain:'musashimaru',group:'local_tokai',storeName:'選択地域',fairName:'公式メニュー・おすすめ',startDate:null,endDate:null,items:[],campaigns:[],menuHighlights:musashimaruHighlights(menu),sourceUrl:menu,storeUrl:'https://www.634-jp.com/musashimaru-shop.html',imageUrl:null,status:'warning',message:'期間限定商品の安定したテキスト取得元が確認できないため、商品名は推測せず、公式に確認できるメニュー情報を表示しています。',dataScope:'official_link_only',officialActionLabel:'店舗情報を公式で確認',officialActionUrl:'https://www.634-jp.com/musashimaru-shop.html',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:false},priceNote:'公式メニューでは店内寿司メニューが税込176円〜。最新ネタ・おすすめは公式メニューまたは店頭でご確認ください。'};}
async function tokubei(){
  const info='https://www.nigirinotokubei.com/info/';
  try{
    const html=await get(info),$=cheerio.load(html),candidates=[];
    $('a[href]').each((_,e)=>{const t=clean($(e).text());if(!/(さんま|まぐろ|サーモン|旬|味覚|大漁|フェア|対決|祭り)/.test(t))return;const r=range(t);if(!active(r))return;const href=abs($(e).attr('href'),info);if(href)candidates.push({t,r,href});});
    const unique=[...new Map(candidates.map(c=>[c.href,c])).values()].sort((a,b)=>String(b.r.startDate||'').localeCompare(String(a.r.startDate||''))).slice(0,6);
    if(!unique.length)throw new Error('active food fair not found');
    const campaigns=[];
    for(const c of unique){let items=[],image=null;try{const detail=await get(c.href),d=cheerio.load(detail);image=og(d,c.href);if(isGenericOg(image))image=null;const blocks=[];d('li,p,td,th,figcaption,dd').each((_,el)=>{const t=clean(d(el).text());if(t&&t.length<=240&&/\d{2,4}円/.test(t))blocks.push(t);});items=dedupe((blocks.length?blocks:[clean(d('body').text())]).flatMap(t=>parsePricedText(t,c.r,c.href))).slice(0,12);}catch{}const fairName=c.t.replace(/^20\d{2}\.\d{2}\.\d{2}更新\s*/,'').replace(/20\d{2}年\d{1,2}月\d{1,2}日.*$/,'').trim()||'期間限定フェア';campaigns.push({fairName,...c.r,items,sourceUrl:c.href,imageUrl:image});}
    const primary=campaigns[0],items=dedupe(campaigns.flatMap(c=>c.items)).slice(0,30),image=primary.imageUrl||campaigns.find(c=>c.imageUrl)?.imageUrl||null;
    return {chain:'tokubei',group:'local_tokai',storeName:'選択地域',fairName:primary.fairName,startDate:primary.startDate,endDate:primary.endDate,items,campaigns,menuHighlights:items.slice(0,3).map(x=>({name:x.name,price:x.price,sourceUrl:x.sourceUrl||primary.sourceUrl,sourceType:'official_release_item'})),sourceUrl:primary.sourceUrl,storeUrl:'https://www.nigirinotokubei.com/shop/',imageUrl:image,status:items.length?'ok':'warning',message:items.length?null:'フェア名・期間は公式から取得しました。個別商品・価格は公式ページで確認してください。',dataScope:'local_official_release',officialActionLabel:'店舗・予約を公式で確認',officialActionUrl:'https://www.nigirinotokubei.com/shop/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true},priceNote:'店舗・FC店等により一部メニューやサービスが異なる場合があります。'};
  }catch{const r={startDate:'2026-08-18',endDate:'2026-11-03'};return {chain:'tokubei',group:'local_tokai',storeName:'選択地域',fairName:TODAY()<=r.endDate?'秋の味覚・北海道産さんま':'公式の期間限定メニュー',startDate:TODAY()<=r.endDate?r.startDate:null,endDate:TODAY()<=r.endDate?r.endDate:null,items:[],campaigns:[],menuHighlights:[],sourceUrl:info,storeUrl:'https://www.nigirinotokubei.com/shop/',imageUrl:null,status:'warning',message:'公式フェア情報への導線を表示しています。個別商品は推測していません。',dataScope:'official_link_only',officialActionLabel:'店舗・予約を公式で確認',officialActionUrl:'https://www.nigirinotokubei.com/shop/',regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true}};}
}

async function main(){const fairs=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));const locals=await Promise.all([totomaru(),musashimaru(),tokubei()]);const ids=new Set(locals.map(x=>x.chain));fairs.chains=(fairs.chains||[]).filter(x=>!ids.has(x.chain)).map(x=>({...x,group:'national'}));fairs.chains.push(...locals);await fs.writeFile(FAIR_PATH,JSON.stringify(fairs,null,2)+'\n');console.log('Updated local Tokai fairs only:',locals.map(x=>`${x.chain}:${x.items.length}/${x.campaigns?.length||0} campaigns/${x.menuHighlights?.length||0} highlights/${x.status}`).join(', '));}
if(process.argv.includes('--self-test')){const r=range('2026年8月18日（火）～11月3日（火・祝）');if(r.startDate!=='2026-08-18'||r.endDate!=='2026-11-03')throw new Error('range parser self-test failed');const pairs=parsePricedText('さんま 480円 まぐろ 300円',r,'https://example.test');if(pairs.length!==2||pairs[0].price!==480||pairs[1].price!==300||!pairs[0].sourceUrl)throw new Error('priced product parser self-test failed');const mh=musashimaruHighlights('https://www.634-jp.com/musashimaru-menu.html');if(mh.length<2||mh[0].priceFrom!==176||!/店内寿司メニュー/.test(mh[0].name))throw new Error('Musashimaru menu highlight self-test failed');console.log('Local Tokai fair adapter self-tests passed.');}else await main();
