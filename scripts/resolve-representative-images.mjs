import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const clean = (v='') => String(v).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const norm = (v='') => clean(v).replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g,'').toLowerCase();
const abs = (v,b) => { try{return v?new URL(v,b).href:null;}catch{return null;} };
const HERO_PRIORITY = {
  sushiro: ['天然まぐろのハラモ1貫','天然3貫盛り(キンキ・本鮪赤身・生エビ)','天然本鮪7貫盛り'],
  hamazushi: ['北海道水揚げ秋鮭','厳選まぐろ中とろ','うに軍艦'],
  kurasushi: ['厳選かに軍艦（一貫）','北海道サーモン','【北海道産】秋刀魚'],
  kappasushi: ['北海道産 ほたて','大とろ塩炙り 柚子のせ','厳選びん長まぐろ'],
  uobei: ['本鮪中とろ','厳選まぐろ三昧','贅沢大生えび','のどぐろ'],
};
const FOOD_TEXT = /寿司|すし|鮨|まぐろ|鮪|サーモン|さんま|秋刀魚|かつお|鰹|かに|カニ|蟹|えび|海老|ほたて|帆立|いか|たこ|うなぎ|鰻|魚|ネタ|にぎり|軍艦|刺身|料理|メニュー|フェア|祭り|おすすめ|旬|食べ比べ|握り/i;
const STORE_TEXT = /店内|店舗内|内観|外観|店内写真|店舗写真|店頭|座席|客席|スタッフ|従業員|採用|会社概要|企業情報|アクセス/i;
const GENERIC_IMAGE_URL = /(?:logo|favicon|sprite|avatar|company|profile|header|footer|arrow|button|blank|loading|qr[_-]|shared\/img\/ogp\.png|\/img\/ogp\/|ogp[-_.]|\/themes\/[^/]+\/img\/info\/(?:sp\/)?mainimg\.(?:jpe?g|png|webp)|\/recruit\/|\/staff\/|\/company\/)/i;
const FOOD_IMAGE_URL = /(?:wp-content\/uploads|release_image|campaign|fair|menu|neta|sushi|food|product|season|autumn|summer|spring|winter|osusume|recommend|pickup|top[_-]?slider|slide)/i;

async function fetchHtml(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}
function imgSrc($,el,pageUrl){const raw=$(el).attr('src')||$(el).attr('data-src')||$(el).attr('data-lazy-src')||$(el).attr('data-original');return abs(raw,pageUrl);}
export function genericOrStoreImage(url='',alt='',context=''){
  const text=`${alt} ${context}`;
  if(!url)return true;
  if(GENERIC_IMAGE_URL.test(url))return true;
  if(STORE_TEXT.test(text)&&!FOOD_TEXT.test(text))return true;
  return false;
}
export function usefulImage(url,alt='',context=''){
  return Boolean(url)
    && /(?:\.avif|\.webp|\.jpe?g|\.png)(?:[?#].*)?$/i.test(url)
    && !genericOrStoreImage(url,alt,context)
    && !/ロゴ|アイコン|会社概要|QRコード/.test(alt);
}
function directText($,el){return clean($(el).clone().children().remove().end().text());}
function imageContext($,el){
  const node=$(el);
  const closest=node.closest('figure,li,article,section,main,div');
  return clean(`${node.attr('alt')||''} ${node.attr('title')||''} ${closest.text()} ${node.parent().prev().text()} ${node.parent().next().text()}`).slice(0,1200);
}
function semanticImageScore($,el,url,alt,context){
  if(!usefulImage(url,alt,context))return -999;
  let score=0;
  const lower=decodeURIComponent(url).toLowerCase();
  if(FOOD_IMAGE_URL.test(lower))score+=42;
  if(/wp-content\/uploads/i.test(lower))score+=22;
  if(FOOD_TEXT.test(alt))score+=34;
  if(FOOD_TEXT.test(context))score+=24;
  if($(el).closest('article,main').length)score+=12;
  if($(el).closest('figure').length)score+=8;
  const width=Number($(el).attr('width')||0),height=Number($(el).attr('height')||0);
  if(width>=480||height>=300)score+=6;
  if(width>=900||height>=500)score+=4;
  if(/banner|bnr/i.test(lower)&&FOOD_TEXT.test(context))score+=8;
  if(/mainvisual|main_visual|hero|kv/i.test(lower)&&!FOOD_TEXT.test(context))score-=18;
  if(STORE_TEXT.test(context)&&!FOOD_TEXT.test(context))score-=80;
  return score;
}

export function orderedItemNames(chain,items=[]){
  const names=items.map(x=>typeof x==='string'?x:x?.name).filter(Boolean);
  const priorities=HERO_PRIORITY[chain]||[];
  return [...names].sort((a,b)=>{
    const ai=priorities.findIndex(p=>norm(p)===norm(a));
    const bi=priorities.findIndex(p=>norm(p)===norm(b));
    const ar=ai<0?999:ai, br=bi<0?999:bi;
    return ar-br;
  });
}

export function representativeImage(html,pageUrl,itemNames=[],fairHints=[]){
 const $=cheerio.load(html),nodes=$('body *').toArray(),index=new Map(nodes.map((el,i)=>[el,i]));
 const names=[...itemNames,...fairHints].map(name=>({raw:clean(name),key:norm(name)})).filter(x=>x.key.length>=2).slice(0,20);
 const productPositions=[];
 nodes.forEach((el,pos)=>{const text=directText($,el);if(!text||text.length>260)return;const key=norm(text);names.forEach((name,itemIndex)=>{if(key.includes(name.key)||(name.key.includes(key)&&key.length>=4))productPositions.push({pos,itemIndex});});});
 let best=null;
 $('img').each((_,el)=>{
   const url=imgSrc($,el,pageUrl),alt=clean($(el).attr('alt')||$(el).attr('title')||''),context=imageContext($,el);
   if(!usefulImage(url,alt,context))return;
   const pos=index.get(el)??Number.MAX_SAFE_INTEGER;
   let score=semanticImageScore($,el,url,alt,context),matchedItem=999,matched=false;
   const altKey=norm(alt),contextKey=norm(context);
   names.forEach((name,i)=>{
     if(altKey&&altKey.includes(name.key)){score=Math.max(score,260-i*7);matchedItem=Math.min(matchedItem,i);matched=true;}
     if(contextKey.includes(name.key)){score=Math.max(score,190-i*7);matchedItem=Math.min(matchedItem,i);matched=true;}
   });
   for(const p of productPositions){const distance=Math.abs(pos-p.pos);if(distance<=28){const proximity=152-p.itemIndex*7-distance*2;if(proximity>score){score=proximity;matchedItem=p.itemIndex;matched=true;}}}
   const threshold=matched?70:58;
   if(score>=threshold&&(!best||score>best.score||(score===best.score&&matchedItem<best.itemIndex)))best={url,score,itemIndex:matchedItem};
 });
 return best?.url||null;
}

function pageCandidates(fair){
  const list=[];
  if(fair.officialCampaignUrl)list.push(fair.officialCampaignUrl);
  if(fair.officialReleaseUrl)list.push(fair.officialReleaseUrl);
  for(const campaign of fair.campaigns||[])if(campaign?.sourceUrl)list.push(campaign.sourceUrl);
  for(const highlight of fair.menuHighlights||[])if(highlight?.sourceUrl)list.push(highlight.sourceUrl);
  if(fair.sourceUrl)list.push(fair.sourceUrl);
  if(fair.chain==='kurasushi')list.push('https://www.kurasushi.co.jp/menu/?area=area2');
  return [...new Set(list.filter(Boolean))];
}

function trustedItemImage(fair,itemNames){
  for(const name of itemNames){
    const item=(fair.items||[]).find(x=>norm(x?.name)===norm(name));
    if(item?.imageUrl&&usefulImage(item.imageUrl,item.name,'商品画像'))return {url:item.imageUrl,page:item.sourceUrl||fair.sourceUrl||null,product:item.name};
  }
  return null;
}
function trustedExistingProductImage(fair){
  const url=fair.imageUrl||'';
  if(!usefulImage(url,fair.fairName||'',fair.fairName||''))return null;
  if(fair.chain==='hamazushi')return {url,page:fair.sourceUrl,product:fair.representativeImageProduct||fair.items?.[0]?.name||null};
  if(fair.chain==='totomaru'&&/(?:top[_-]?slider|summer|season|menu|fair|campaign)/i.test(url))return {url,page:fair.sourceUrl,product:fair.items?.[0]?.name||null};
  if(fair.representativeImageSource==='official_priority_product_image'&&!genericOrStoreImage(url))return {url,page:fair.representativeImagePage||fair.sourceUrl,product:fair.representativeImageProduct||null};
  return null;
}
function fairHints(fair){
  return [fair.fairName,fair.officialCampaignTitle,...(fair.menuHighlights||[]).map(x=>x?.name),...(fair.campaigns||[]).map(x=>x?.fairName)].filter(Boolean);
}

async function main(){
 if(process.argv.includes('--self-test')){
   const fixture='<html><body><img src="title_limited.png" alt="期間限定メニュー"><p>北海道水揚げ秋鮭 110円</p><figure><img src="salmon.png" alt="北海道水揚げ秋鮭"></figure><p>本鮪中とろ 220円</p><figure><img src="tuna.png" alt="本鮪中とろ"></figure></body></html>';
   assert.deepEqual(orderedItemNames('uobei',[{name:'すけそう鱈'},{name:'本鮪中とろ'}]),['本鮪中とろ','すけそう鱈']);
   assert.equal(representativeImage(fixture,'https://example.jp/fair',orderedItemNames('hamazushi',['北海道水揚げ秋鮭','厳選まぐろ中とろ'])),'https://example.jp/salmon.png');
   assert.equal(usefulImage('https://example.jp/assets/menu/img/title_limited.png'),true);
   assert.equal(genericOrStoreImage('https://www.nigirinotokubei.com/wp/wp-content/themes/tokubei.com/img/info/sp/mainimg.jpg'),true);
   const tokubeiFixture='<html><head><meta property="og:image" content="/wp/wp-content/themes/tokubei.com/img/info/sp/mainimg.jpg"></head><body><article><h1>生サーモン・さんま・かつお 秋の味覚祭り</h1><figure><img src="/wp/wp-content/uploads/2026/09/autumn-salmon-sanma.jpg" alt="生サーモン・さんま・かつお 秋の味覚祭り"></figure></article></body></html>';
   assert.equal(representativeImage(tokubeiFixture,'https://www.nigirinotokubei.com/info/11244/',[],['生サーモン・さんま・かつお 秋の味覚祭り']),'https://www.nigirinotokubei.com/wp/wp-content/uploads/2026/09/autumn-salmon-sanma.jpg');
   const kuraFixture='<html><head><meta property="og:image" content="/shared/img/ogp.png"></head><body><article><h1>北海フェア</h1><p>厳選かに軍艦（一貫） 110円</p><figure><img src="/images/kani-gunkan.png" alt="厳選かに軍艦（一貫）"></figure></article></body></html>';
   assert.equal(representativeImage(kuraFixture,'https://www.kurasushi.co.jp/author/008437.html',['厳選かに軍艦（一貫）'],['北海フェア']),'https://www.kurasushi.co.jp/images/kani-gunkan.png');
   console.log('Representative image self-tests passed.');return;
 }
 const data=JSON.parse(await fs.readFile(OUT,'utf8'));
 for(const fair of data.chains||[]){
   const itemNames=orderedItemNames(fair.chain,fair.items||[]);
   const itemImage=trustedItemImage(fair,itemNames),existing=trustedExistingProductImage(fair);
   let resolved=itemImage?.url||existing?.url||null,resolvedPage=itemImage?.page||existing?.page||null,resolvedProduct=itemImage?.product||existing?.product||null;
   if(!resolved){
     for(const pageUrl of pageCandidates(fair)){
       try{
         resolved=representativeImage(await fetchHtml(pageUrl),pageUrl,itemNames,fairHints(fair));
         if(resolved){resolvedPage=pageUrl;resolvedProduct=itemNames[0]||fair.menuHighlights?.[0]?.name||fair.fairName||null;break;}
       }catch(e){console.warn(`${fair.chain}: representative image page failed ${pageUrl}: ${e.message}`);}
     }
   }
   if(resolved){
     fair.representativeImageUrl=resolved;
     fair.representativeImageSource='official_food_or_fair_image';
     fair.representativeImageProduct=resolvedProduct;
     fair.representativeImagePage=resolvedPage;
     fair.imageUrl=resolved;
     console.log(`${fair.chain}: food/fair representative image resolved for ${resolvedProduct||'current fair'}`);
   } else {
     delete fair.representativeImageUrl;delete fair.representativeImageSource;delete fair.representativeImageProduct;delete fair.representativeImagePage;
     if(genericOrStoreImage(fair.imageUrl||'',fair.fairName||'',fair.fairName||'')){
       console.warn(`${fair.chain}: suppressed generic/store hero image ${fair.imageUrl}`);
       fair.imageUrl=null;
     } else console.warn(`${fair.chain}: no confidently matched food/fair image; keeping safe visual fallback`);
   }
 }
 data.updatedAt=new Date().toISOString();
 await fs.writeFile(OUT,JSON.stringify(data,null,2)+'\n');
}
await main();
