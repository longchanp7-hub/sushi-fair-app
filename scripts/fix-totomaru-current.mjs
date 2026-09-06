import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { source } from './source-registry.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const HOME=source('totomaru','home');
const NEWS=source('totomaru','news');
const SHOPS=source('totomaru','shops');
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Safari/537.36';
const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const abs=(v,b)=>{try{return v?new URL(v,b).href:null;}catch{return null;}};
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const yearNow=()=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric'}).format(new Date()));

async function get(url,attempts=3){let last;for(let i=1;i<=attempts;i+=1){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}catch(e){last=e;if(i<attempts)await new Promise(r=>setTimeout(r,700*i));}}throw last;}
function fairName(text){const s=clean(text);const m=s.match(/([ぁ-んァ-ヶ一-龥A-Za-z0-9・＆&ー]+(?:フェア|祭り))/);return clean(m?.[1]||'');}
function dates(text,year=yearNow()){
  const s=clean(text);
  let m=s.match(/(20\d{2})[年/.]\s*(\d{1,2})[月/.]\s*(\d{1,2})日?\s*[～〜~\-–—]\s*(?:(20\d{2})[年/.]\s*)?(\d{1,2})[月/.]\s*(\d{1,2})日?/);
  if(m){const sy=+m[1],sm=+m[2],em=+m[5];return{startDate:iso(sy,sm,+m[3]),endDate:iso(+(m[4]||(em<sm?sy+1:sy)),em,+m[6])};}
  m=s.match(/(\d{1,2})月\s*(\d{1,2})日[^～〜~\-–—]{0,20}[～〜~\-–—]\s*(\d{1,2})月\s*(\d{1,2})日/);
  if(m){const sm=+m[1],em=+m[3];return{startDate:iso(year,sm,+m[2]),endDate:iso(em<sm?year+1:year,em,+m[4])};}
  m=s.match(/(20\d{2})[/.](\d{1,2})[/.](\d{1,2})/);if(m)return{startDate:iso(+m[1],+m[2],+m[3]),endDate:null};
  m=s.match(/(\d{1,2})月\s*(\d{1,2})日/);if(m)return{startDate:iso(year,+m[1],+m[2]),endDate:null};
  return{startDate:null,endDate:null};
}
function products(html,base=HOME){
  const $=cheerio.load(html),out=[];
  $('a[href*="/products/detail/"]').each((_,a)=>{
    const href=abs($(a).attr('href'),base);let node=$(a),text=clean(node.text());
    for(let i=0;i<4&&node.length&&!/[￥¥]\s*[\d,]+/.test(text);i+=1,node=node.parent())text=clean(node.text());
    const price=text.match(/[￥¥]\s*([\d,]+)/);const name=clean($(a).find('h1,h2,h3,h4,strong,b').first().text()||$(a).text()).replace(/^(?:New|おすすめ)\s*/i,'');
    if(!href||!name||name.length>80||!price)return;
    out.push({name,priceFrom:Number(price[1].replace(/,/g,'')),sourceUrl:href,sourceType:'official_current_product'});
  });
  return [...new Map(out.map(x=>[`${x.name}|${x.priceFrom}`,x])).values()].slice(0,8);
}
function fairCandidates(html,base){
  const $=cheerio.load(html),out=[];
  $('a[href*="/news/detail/"]').each((_,a)=>{
    let node=$(a),text=clean(node.text());for(let i=0;i<3&&node.length&&text.length<20;i+=1,node=node.parent())text=clean(node.text());
    const name=fairName(text);if(!name)return;
    const href=abs($(a).attr('href'),base);if(!href)return;
    const r=dates(text);out.push({fairName:name,sourceUrl:href,...r,raw:text});
  });
  return [...new Map(out.map(x=>[x.sourceUrl,x])).values()].sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||'')));
}
function detailInfo(html,url,fallback){
  const $=cheerio.load(html);const title=clean($('h1').first().text()||$('meta[property="og:title"]').attr('content')||fallback.raw||fallback.fairName);const body=clean($('body').text());const r=dates(`${title} ${body}`);const image=abs($('meta[property="og:image"]').attr('content')||$('meta[name="twitter:image"]').attr('content'),url);
  return{fairName:fairName(title)||fallback.fairName,startDate:r.startDate||fallback.startDate||null,endDate:r.endDate||fallback.endDate||null,sourceUrl:url,imageUrl:image};
}

export async function buildTotomaruCurrent(homeHtml,newsHtml=null){
  const menuHighlights=products(homeHtml,HOME);
  let candidates=fairCandidates(homeHtml,HOME);
  if(!candidates.length&&newsHtml)candidates=fairCandidates(newsHtml,NEWS);
  if(!candidates.length)throw new Error('current Totomaru official fair announcement not found');
  const selected=candidates[0];let fair={...selected,imageUrl:null};
  try{fair=detailInfo(await get(selected.sourceUrl,2),selected.sourceUrl,selected);}catch{}
  return{
    chain:'totomaru',group:'local_tokai',storeName:'選択地域',fairName:fair.fairName,startDate:fair.startDate,endDate:fair.endDate,
    items:[],campaigns:[{fairName:fair.fairName,startDate:fair.startDate,endDate:fair.endDate,items:[],sourceUrl:fair.sourceUrl,imageUrl:fair.imageUrl||null,verified:true}],
    menuHighlights,sourceUrl:fair.sourceUrl,storeUrl:SHOPS,imageUrl:fair.imageUrl||null,status:'ok',
    message:menuHighlights.length?'フェア名・期間は魚魚丸の現行公式告知から取得し、商品欄は推測せず公式サイトのおすすめ商品を別枠表示しています。':'フェア名・期間は魚魚丸の現行公式告知から取得しています。個別商品は推測していません。',
    dataScope:'local_current_official_news',officialActionLabel:'店舗・順番待ちを公式で確認',officialActionUrl:SHOPS,
    regionalModel:{strategyKey:'exactLocalStore',label:'選択市区町村の実店舗',priceVariesByLocation:true},priceNote:'店舗・入荷状況により取扱いが異なる場合があります。',
  };
}

export async function refreshTotomaruCurrent(data){
  let newsHtml=null;const homeHtml=await get(HOME);try{newsHtml=await get(NEWS,2);}catch{}
  const current=await buildTotomaruCurrent(homeHtml,newsHtml);
  data.chains=(data.chains||[]).map(c=>c.chain==='totomaru'?current:c);
  return current;
}

function selfTest(){
  const home=`<h2>おすすめ商品</h2><div><a href="/products/detail/a"><strong>中とろ醤油炙り</strong></a><span>￥496</span></div><section><a href="/news/detail/x">2026/09/04 フェア告知 〖9月4日(金)～〗天然南まぐろフェア開催！！</a></section>`;
  const cs=fairCandidates(home,HOME);assert.equal(cs[0].fairName,'天然南まぐろフェア');assert.equal(cs[0].startDate,'2026-09-04');const ps=products(home,HOME);assert.equal(ps[0].priceFrom,496);assert.match(ps[0].sourceUrl,/\/products\/detail\/a$/);assert.deepEqual(dates('9月4日（金）～9月17日（木）',2026),{startDate:'2026-09-04',endDate:'2026-09-17'});console.log('Totomaru current official-site self-tests passed.');
}

async function main(){
  if(process.argv.includes('--self-test'))return selfTest();
  const data=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));const current=await refreshTotomaruCurrent(data);data.updatedAt=new Date().toISOString();await fs.writeFile(FAIR_PATH,`${JSON.stringify(data,null,2)}\n`);console.log(`Applied current Totomaru official source: ${current.fairName} (${current.startDate||'?'} - ${current.endDate||'open'}) / ${current.menuHighlights.length} menu highlights`);
}
const direct=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(direct)await main();
