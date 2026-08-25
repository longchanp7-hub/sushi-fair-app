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
  sushiro: ['本鮪中とろ','天然本鮪7貫盛り','国産ほたて食べ比べ'],
  hamazushi: ['北海道水揚げ秋鮭','厳選まぐろ中とろ','うに軍艦'],
  kurasushi: ['うなぎ(一貫)','【浜名湖産】うなぎ(一貫)','黒毛和牛にぎり(一貫)'],
  kappasushi: ['北海道産 ほたて','大とろ塩炙り 柚子のせ','厳選びん長まぐろ'],
  uobei: ['本鮪中とろ','厳選まぐろ三昧','贅沢大生えび','のどぐろ'],
};
async function fetchHtml(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}
function imgSrc($,el,pageUrl){const raw=$(el).attr('src')||$(el).attr('data-src')||$(el).attr('data-lazy-src')||$(el).attr('data-original');return abs(raw,pageUrl);}
function usefulImage(url,alt=''){
  return Boolean(url)
    && !/(?:logo|icon|sprite|avatar|company|profile|header|footer|arrow|button|blank|loading|ogp\.png|qr[_-]|title_limited|title[_-](?:fair|menu|limited)|limited[_-]?menu|menu[_-]?title|mainvisual|main_visual)/i.test(url)
    && !/ロゴ|アイコン|会社概要|QR|期間限定メニュー$/.test(alt);
}
function directText($,el){return clean($(el).clone().children().remove().end().text());}

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

export function representativeImage(html,pageUrl,itemNames=[]){
 const $=cheerio.load(html),nodes=$('body *').toArray(),index=new Map(nodes.map((el,i)=>[el,i]));
 const names=itemNames.map(name=>({raw:clean(name),key:norm(name)})).filter(x=>x.key.length>=2).slice(0,12);
 const productPositions=[];
 nodes.forEach((el,pos)=>{const text=directText($,el);if(!text||text.length>240)return;const key=norm(text);names.forEach((name,itemIndex)=>{if(key.includes(name.key)||(name.key.includes(key)&&key.length>=4))productPositions.push({pos,itemIndex});});});
 let best=null;
 $('img').each((_,el)=>{
   const url=imgSrc($,el,pageUrl),alt=clean($(el).attr('alt')||$(el).attr('title')||'');
   if(!usefulImage(url,alt))return;
   const pos=index.get(el)??Number.MAX_SAFE_INTEGER;
   let score=0,matchedItem=999;
   const altKey=norm(alt);
   names.forEach((name,i)=>{if(altKey&&altKey.includes(name.key)){score=Math.max(score,220-i*8);matchedItem=Math.min(matchedItem,i);}});
   const context=clean(`${$(el).closest('figure,li,article,section').text()} ${$(el).parent().prev().text()} ${$(el).parent().next().text()}`);
   const contextKey=norm(context.slice(0,900));
   names.forEach((name,i)=>{if(contextKey.includes(name.key)){score=Math.max(score,160-i*8);matchedItem=Math.min(matchedItem,i);}});
   for(const p of productPositions){const distance=Math.abs(pos-p.pos);if(distance<=24){const proximity=132-p.itemIndex*8-distance*2;if(proximity>score){score=proximity;matchedItem=p.itemIndex;}}}
   if(score>=70&&(!best||score>best.score||(score===best.score&&matchedItem<best.itemIndex)))best={url,score,itemIndex:matchedItem};
 });
 return best?.url||null;
}

function pageCandidates(fair){
  const list=[];
  if(fair.chain==='kurasushi') list.push('https://www.kurasushi.co.jp/menu/?area=area2');
  if(fair.officialReleaseUrl) list.push(fair.officialReleaseUrl);
  if(fair.sourceUrl) list.push(fair.sourceUrl);
  return [...new Set(list)];
}

function trustedExistingProductImage(fair){
  // Hama's fair scraper already extracts the first actual limited product image.
  // Do not replace that with the generic `title_limited.png` heading image.
  if(fair.chain==='hamazushi' && usefulImage(fair.imageUrl||'')) return fair.imageUrl;
  return null;
}

async function main(){
 if(process.argv.includes('--self-test')){
   const fixture='<html><body><img src="title_limited.png" alt="期間限定メニュー"><p>北海道水揚げ秋鮭 110円</p><figure><img src="salmon.png" alt="北海道水揚げ秋鮭"></figure><p>本鮪中とろ 220円</p><figure><img src="tuna.png" alt="本鮪中とろ"></figure></body></html>';
   assert.deepEqual(orderedItemNames('uobei',[{name:'すけそう鱈'},{name:'本鮪中とろ'}]),['本鮪中とろ','すけそう鱈']);
   assert.equal(representativeImage(fixture,'https://example.jp/fair',orderedItemNames('hamazushi',['北海道水揚げ秋鮭','厳選まぐろ中とろ'])),'https://example.jp/salmon.png');
   assert.equal(usefulImage('https://example.jp/assets/menu/img/title_limited.png'),false);
   assert.equal(representativeImage('<html><body><img src="logo.png"><img src="title_limited.png"></body></html>','https://example.jp/',['北海道水揚げ秋鮭']),null);
   console.log('Representative image self-tests passed.');return;
 }
 const data=JSON.parse(await fs.readFile(OUT,'utf8'));
 for(const fair of data.chains||[]){
   const itemNames=orderedItemNames(fair.chain,fair.items||[]);
   let resolved=trustedExistingProductImage(fair),resolvedPage=resolved?fair.sourceUrl:null;
   if(!resolved){
     for(const pageUrl of pageCandidates(fair)){
       try{
         resolved=representativeImage(await fetchHtml(pageUrl),pageUrl,itemNames);
         if(resolved){resolvedPage=pageUrl;break;}
       }catch(e){console.warn(`${fair.chain}: representative image page failed ${pageUrl}: ${e.message}`);}
     }
   }
   if(resolved){
     fair.representativeImageUrl=resolved;
     fair.representativeImageSource='official_priority_product_image';
     fair.representativeImageProduct=itemNames[0]||null;
     fair.representativeImagePage=resolvedPage;
     console.log(`${fair.chain}: representative image resolved for ${itemNames[0]||'fair item'}`);
   } else {
     delete fair.representativeImageUrl;delete fair.representativeImageSource;delete fair.representativeImageProduct;delete fair.representativeImagePage;
     console.warn(`${fair.chain}: no confidently matched hero-product image; keeping visual fallback`);
   }
 }
 data.updatedAt=new Date().toISOString();
 await fs.writeFile(OUT,JSON.stringify(data,null,2)+'\n');
}
await main();
