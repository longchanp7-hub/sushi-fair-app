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
async function fetchHtml(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=.9','cache-control':'no-cache'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}
function imgSrc($,el,pageUrl){const raw=$(el).attr('src')||$(el).attr('data-src')||$(el).attr('data-lazy-src')||$(el).attr('data-original');return abs(raw,pageUrl);}
function usefulImage(url,alt=''){return Boolean(url)&&!/(?:logo|icon|sprite|avatar|company|profile|header|footer|arrow|button|blank|loading|ogp\.png)/i.test(url)&&!/ロゴ|アイコン|会社概要/.test(alt);}
function directText($,el){return clean($(el).clone().children().remove().end().text());}

export function representativeImage(html,pageUrl,itemNames=[]){
 const $=cheerio.load(html),nodes=$('body *').toArray(),index=new Map(nodes.map((el,i)=>[el,i]));
 const names=itemNames.map(name=>({raw:clean(name),key:norm(name)})).filter(x=>x.key.length>=2).slice(0,10);
 const productPositions=[];
 nodes.forEach((el,pos)=>{const text=directText($,el);if(!text||text.length>240)return;const key=norm(text);names.forEach((name,itemIndex)=>{if(key.includes(name.key)||name.key.includes(key)&&key.length>=4)productPositions.push({pos,itemIndex});});});
 let best=null;
 $('img').each((_,el)=>{
   const url=imgSrc($,el,pageUrl),alt=clean($(el).attr('alt')||$(el).attr('title')||'');
   if(!usefulImage(url,alt))return;
   const pos=index.get(el)??Number.MAX_SAFE_INTEGER;
   let score=0,matchedItem=999;
   const altKey=norm(alt);
   names.forEach((name,i)=>{if(altKey&&altKey.includes(name.key)){score=Math.max(score,160-i*5);matchedItem=Math.min(matchedItem,i);}});
   const context=clean(`${$(el).closest('figure,li,article').text()} ${$(el).parent().prev().text()} ${$(el).parent().next().text()}`);
   const contextKey=norm(context.slice(0,700));
   names.forEach((name,i)=>{if(contextKey.includes(name.key)){score=Math.max(score,130-i*5);matchedItem=Math.min(matchedItem,i);}});
   for(const p of productPositions){const distance=Math.abs(pos-p.pos);if(distance<=26){const proximity=112-p.itemIndex*5-distance*2;if(proximity>score){score=proximity;matchedItem=p.itemIndex;}}}
   if(score>=62&&(!best||score>best.score||(score===best.score&&matchedItem<best.itemIndex)))best={url,score,itemIndex:matchedItem};
 });
 return best?.url||null;
}

async function main(){
 if(process.argv.includes('--self-test')){
   const fixture='<html><body><img src="banner.jpg"><p>本鮪中とろ 110円</p><figure><img src="tuna.png" alt="本鮪中とろ"></figure><p>別商品 220円</p><img src="other.png"></body></html>';
   assert.equal(representativeImage(fixture,'https://example.jp/fair',['本鮪中とろ','別商品']),'https://example.jp/tuna.png');
   assert.equal(representativeImage('<html><body><img src="logo.png"><img src="banner.jpg"></body></html>','https://example.jp/',['本鮪中とろ']),null);
   console.log('Representative image self-tests passed.');return;
 }
 const data=JSON.parse(await fs.readFile(OUT,'utf8'));
 for(const fair of data.chains||[]){
   const pageUrl=fair.officialReleaseUrl||fair.sourceUrl;
   if(!pageUrl)continue;
   try{
     const image=representativeImage(await fetchHtml(pageUrl),pageUrl,(fair.items||[]).map(x=>x.name));
     if(image){fair.representativeImageUrl=image;fair.representativeImageSource='official_product_near_fair_item';console.log(`${fair.chain}: representative product image resolved`);}
     else {delete fair.representativeImageUrl;delete fair.representativeImageSource;console.warn(`${fair.chain}: no confidently matched product image; keeping visual fallback`);}
   }catch(e){console.warn(`${fair.chain}: representative image refresh failed: ${e.message}`);}
 }
 data.updatedAt=new Date().toISOString();
 await fs.writeFile(OUT,JSON.stringify(data,null,2)+'\n');
}
await main();
