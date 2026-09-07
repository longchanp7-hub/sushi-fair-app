import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as cheerio from 'cheerio';
import {source} from './source-registry.mjs';
import {canonicalCampaignUrl as canonical, campaignPhase, catalogToday} from '../app/campaign-catalog.js';
export const SOURCES = {
  kappasushi:{indices:[source('kappasushi','campaigns'),'https://prtimes.jp/companyrdf.php?company_id=18731'],detail:u=>(u.hostname==='prtimes.jp'&&/\/main\/html\/rd\/p\/\d+\.000018731\.html$/.test(u.pathname))||(u.hostname==='www.kappasushi.jp'&&u.pathname!=='/'&&!/^\/(?:campaign_list|shop|support|info\/|202302_news|kappa-action)/.test(u.pathname))},
  tokubei:{indices:['https://www.nigirinotokubei.com/',source('tokubei','info')],detail:u=>u.hostname==='www.nigirinotokubei.com'&&/^\/info\/\d+\/?$/.test(u.pathname)},
};
const ROOT=fileURLToPath(new URL('..',import.meta.url)),FAIR=path.join(ROOT,'app/data/fairs.json');
const clean=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const DAY=86400000,HORIZON=45,LOOKBACK=90,MAX_DETAILS=120;
const eligible=/フェア|祭り|まつり|キャンペーン|トロの日|ランチ|スイーツ|パスポート|優待|お徳なセット|周年祭|おせち|期間限定|増量|おすすめ|食べ放題/;
const irrelevant=/訂正|お詫び|休止|休業|偽|なりすまし|テレビ|放送|採用|募集|決算|株主|業績|会社説明/;
const key=u=>createHash('sha256').update(u).digest('hex').slice(0,20);
function iso(y,m,d){const v=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const parsed=new Date(v+'T00:00:00Z');return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===v?v:null;}
export function parseDates(value,year=Number(catalogToday().slice(0,4))){
 const s=clean(value).replace(/20\d{2}[./年]\d{1,2}[./月]\d{1,2}日?\s*更新/g,'');
 const date='(?:(20\\d{2})[年./]\\s*)?(\\d{1,2})[月./]\\s*(\\d{1,2})日?',weekday='(?:\\s*[（(][^）)]{1,8}[）)])?';
 let m=s.match(new RegExp(date+weekday+'\\s*[～〜~−–—-]\\s*'+date));
 if(m){const y=+(m[1]||year),ey=+(m[4]||(+m[5]<+m[2]?y+1:y));return {startDate:iso(y,+m[2],+m[3]),endDate:iso(ey,+m[5],+m[6])};}
 m=s.match(new RegExp(date+weekday+'\\s*(?:限定|のみ|一日|1日限定)'));
 if(m){const d=iso(+(m[1]||year),+m[2],+m[3]);return {startDate:d,endDate:d};}
 m=s.match(new RegExp(date+weekday+'\\s*(?:[～〜~]|から|より|開始|スタート)'));
 if(m)return {startDate:iso(+(m[1]||year),+m[2],+m[3]),endDate:null};
 m=s.match(new RegExp('(?:販売日|開催日|(?:販売|開催|実施|提供)期間)\\s*[:：]?\\s*'+date+weekday+'(?:\\s|$)'));
 if(m){const d=iso(+(m[1]||year),+m[2],+m[3]);return {startDate:d,endDate:d};}
 m=s.match(new RegExp('[～〜~]\\s*'+date+weekday+'\\s*まで'));
 if(m)return {startDate:null,endDate:iso(+(m[1]||year),+m[2],+m[3])};
 return {startDate:null,endDate:null};
}
function titleOnly(v){return clean(v).replace(/^20\d{2}[./年]\d{1,2}[./月]\d{1,2}日?\s*更新\s*/,'').replace(/20\d{2}年\d{1,2}月\d{1,2}日.*$/,'').replace(/\s*[|｜].*$/,'').replace(/^予告\s*/,'').trim();}
function category(t){return /お持ち帰り|持ち帰り|テイクアウト/.test(t)?'takeout':/ランチ/.test(t)?'lunch':/スイーツ|ゼリー|アイス|アサイー/.test(t)?'dessert':/パスポート|優待/.test(t)?'benefit':/おせち|予約/.test(t)?'preorder':/店舗限定|店[】〗\]]|周年祭/.test(t)?'store_limited':/フェア|祭り|トロの日|増量/.test(t)?'fair':'other';}
function textLines($,root){const el=root.clone();el.find('script,style,nav,header,footer').remove();el.find('br').replaceWith('\n');el.find('p,div,li,dt,dd,h1,h2,h3,h4,tr').append('\n');return el.text().split(/\n+/).map(clean).filter(Boolean);}
export function discoverIndex(html,indexUrl,chain){
 const found=new Map(),isFeed=/<(?:rss\b|rdf:RDF)/i.test(html),$=cheerio.load(html,isFeed?{xmlMode:true}:{});
 function add(href,title,text,extra={}){
  let u;try{u=new URL(href,indexUrl);}catch{return;}
  if(!SOURCES[chain].detail(u))return;
  const sourceUrl=canonical(u.href),fairName=titleOnly(title)||'プレスリリース';
  const identity=u.hostname==='www.kappasushi.jp'&&u.pathname==='/menu2'?sourceUrl+'#announcement='+key(fairName):sourceUrl;
  const year=Number(String(extra.publishedAt||text).match(/20\d{2}/)?.[0]||catalogToday().slice(0,4));
  const e={sourceUrl,identity,fairName,indexText:clean(text),indexUrl,...parseDates(text,year),...extra};
  const old=found.get(identity);if(!old||e.indexText.length>old.indexText.length)found.set(identity,e);
 }
 if(isFeed){$('item').each((_,el)=>{const n=$(el),title=n.find('title').text(),publishedAt=n.children().filter((_,c)=>/^(?:dc:date|pubDate|date)$/.test(c.name||'')).text();add(n.find('link').text()||n.attr('rdf:about'),title,`${title} ${n.find('description').text()}`,{publishedAt});});return [...found.values()];}
 $('header,footer,nav,script,style').remove();
 $('a[href]').each((_,a)=>{
  const node=$(a),parent=node.closest('li'),alt=clean(node.find('img').map((_,i)=>$(i).attr('alt')||'').get().join(' '));
  const label=clean(node.text()),context=clean((parent.length?parent:node).text());
  const heading=clean(node.find('h1,h2,h3,h4,strong').first().text());
  add(node.attr('href'),heading||alt||label,`${label} ${context}`,{fromOfficialList:chain==='kappasushi'&&new URL(indexUrl).hostname==='www.kappasushi.jp'});
 });
 return [...found.values()];
}
export function entryExclusion(e,previous=[],today=catalogToday()){
 if(irrelevant.test(e.fairName))return 'not_food_campaign';
 if(campaignPhase(e,today)==='ended')return 'ended';
 const published=Date.parse(e.publishedAt);
 const knownCurrent=previous.some(x=>canonical(x.sourceUrl)===canonical(e.sourceUrl)&&campaignPhase(x,today)!=='ended');
 if(!e.fromOfficialList&&Number.isFinite(published)&&Date.parse(today)-published>LOOKBACK*DAY&&!knownCurrent&&!(e.endDate&&e.endDate>=today))return 'feed_older_than_90_days';
 return null;
}
export function parseProducts(lines,sourceUrl,range){
 const out=[];
 for(let i=0;i<lines.length;i++)for(const text of [lines[i],`${lines[i]} ${lines[i+1]||''}`]){
  if(text.length>250||/販売期間|販売店舗|対象店舗|合計|割引|クーポン|以上|お買い上げ/.test(text))continue;
  const p=text.match(/(?:税込\s*([\d,]+)\s*円|([\d,]+)\s*円\s*[（(]税込[）)])/);if(!p)continue;
  const before=text.slice(0,p.index).replace(/^[・●■◆◇\s]+/,''),quotes=[...before.matchAll(/[『「]([^』」]+)[』」]/g)];
  let name=quotes.at(-1)?.[1]||before.replace(/\s*[（(]?\s*[\d,]+円.*$/,'').replace(/\s*(?:一|二|三|\d+)貫\s*$/,'').replace(/[（(\s]+$/,'');
  name=clean(name).replace(/^(?:店内切付(?:\/直火炙り)?|直火炙り)\s*/,'').replace(/[.．・]{2,}$/,'').trim();
  if(!name||name.length>65||/[。]|税込|販売|提供|購入|価格|通常|全店|プレス/.test(name))continue;
  const price=Number((p[1]||p[2]).replace(/,/g,''));if(!(price>0&&price<100000))continue;
  const suffix=text.slice(p.index+p[0].length,p.index+p[0].length+5);
  out.push({name,price,priceType:/^[）)\s]*[～〜~]/.test(suffix)?'from':'listed',...range,sourceUrl,saleStatus:campaignPhase(range),scrapeStatus:'ok'});break;
 }
 return [...new Map(out.map(x=>[`${x.name}|${x.price}`,x])).values()];
}
export function parseDetail(html,entry,chain,today=catalogToday()){
 const $=cheerio.load(html),root=$('#press-release-body,.press-release-body,.release-body,article,main,#main,#contents').first();
 const lines=textLines($,root.length?root:$('body')),heading=clean($('h1').first().text()),meta=clean($('meta[property="og:title"]').attr('content')||$('title').text());
 let title=titleOnly(entry.fromOfficialList?entry.fairName:heading&&eligible.test(heading)?heading:meta&&eligible.test(meta)?meta:entry.fairName);
 if(/トロの日/.test(title))title='トロの日';
 const year=Number(String(entry.publishedAt||entry.indexText||meta).match(/20\d{2}/)?.[0]||today.slice(0,4));
 const periods=lines.filter(l=>/(?:販売日|開催日|(?:販売|開催|実施|提供|配布)期間)/.test(l));
 let range={startDate:entry.startDate||null,endDate:entry.endDate||null};
 const texts=entry.fromOfficialList?[entry.indexText,...periods,`${heading} ${meta}`]:[...periods,entry.indexText,`${heading} ${meta}`,...lines.slice(0,45)];
 for(const text of texts){const r=parseDates(text,year);if(r.startDate||r.endDate){range=r;break;}}
 if(chain==='kappasushi'&&!/かっぱ寿司|カッパ・クリエイト/.test(lines.join(' ')+' '+meta))throw new Error('Wrong brand in release');
 const cat=category(title),phase=campaignPhase(range,today);
 if((!eligible.test(title)&&!entry.fromOfficialList)||irrelevant.test(title))return {excludedReason:'not_food_campaign',title};
 if(phase==='ended')return {excludedReason:'ended',title,...range};
 if(range.startDate&&new Date(range.startDate)-new Date(today)>HORIZON*DAY)return {excludedReason:'beyond_45_day_horizon',title,...range};
 // A common menu page does not prove that every menu product belongs to a banner's campaign.
 const sharedMenu=new URL(entry.sourceUrl).pathname==='/menu2';
 const items=sharedMenu?[]:parseProducts(lines,entry.sourceUrl,range).map(x=>({...x,saleStatus:campaignPhase(x,today)}));
 const note=cat==='takeout'?'お持ち帰り向け。店内飲食の価格・フェアとは別扱いです。':cat==='lunch'?'平日限定ランチ。提供時間・対象店舗は公式告知で確認してください。':cat==='benefit'?'優待・配布条件があります。年齢条件、配布期間と利用期間を公式告知で確認してください。':cat==='store_limited'?'対象店舗限定の告知です。選択店舗での実施を保証しません。':cat==='preorder'?'予約商品の告知です。申込期限と受取・販売日は公式で確認してください。':/店内飲食限定/.test(lines.join(' '))?'店内飲食限定。店舗により価格・取扱いが異なり、数量限定・売り切れの場合があります。':'対象店舗・店内／持ち帰り・数量限定などの条件は公式告知で確認してください。';
 return {id:`${chain}-${key(entry.identity||entry.sourceUrl)}`,fairName:title,sourceUrl:entry.sourceUrl,indexUrl:entry.indexUrl,...range,campaignPhase:phase,category:cat,scopeNote:note,items,itemStatus:items.length?'parsed':'unavailable',metadataStatus:range.startDate?'parsed':'partial',lastConfirmedAt:new Date().toISOString()};
}
async function get(url){let last;for(let attempt=0;attempt<2;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(16000),headers:{'user-agent':'Mozilla/5.0 SushiFairOfficialCatalog/1.0','accept-language':'ja-JP','cache-control':'no-cache'}});if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.retryable=r.status>=500||r.status===429;throw e;}return await r.text();}catch(e){last=e;if(e.retryable===false)break;if(!attempt)await new Promise(r=>setTimeout(r,800));}}throw last;}
async function pool(values,fn){let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<values.length){const n=cursor++;await fn(values[n]);}}));}
function freshPrevious(row,now){return Boolean(row?.lastConfirmedAt&&now-Date.parse(row.lastConfirmedAt)<3*DAY&&now>=Date.parse(row.lastConfirmedAt));}
export async function collectChain(chain,previous=[],today=catalogToday(),fetcher=get){
 const attemptedAt=new Date().toISOString(),indexResults=[],entries=new Map(),failures=[];
 for(const url of SOURCES[chain].indices){try{const html=await fetcher(url),links=discoverIndex(html,url,chain);if(!links.length)throw new Error('No announcement links: index structure may have changed');indexResults.push({url,status:'ok',count:links.length});for(const e of links){const id=e.identity||e.sourceUrl,old=entries.get(id);if(!old||e.indexText.length>old.indexText.length)entries.set(id,e);}}catch(e){indexResults.push({url,status:'failed',error:e.message});failures.push({url,error:e.message});}}
 const inventory=[],rows=[],now=Date.parse(attemptedAt),all=[];
 for(const e of entries.values()){const reason=entryExclusion(e,previous,today);if(reason)inventory.push({...e,excludedReason:reason});else all.push(e);}
 if(all.length>MAX_DETAILS)throw new Error(`${chain}: ${all.length} in-scope links exceed scan limit ${MAX_DETAILS}; coverage is not complete`);
 await pool(all,async e=>{
  try{const row=parseDetail(await fetcher(e.sourceUrl),e,chain,today);if(row.excludedReason){inventory.push({...e,...row});return;}rows.push(row);inventory.push({sourceUrl:e.sourceUrl,fairName:row.fairName,expected:true,id:row.id});}
  catch(error){
   failures.push({url:e.sourceUrl,error:error.message});
   const id=`${chain}-${key(e.identity||e.sourceUrl)}`,old=previous.find(x=>x.id===id&&freshPrevious(x,now)&&campaignPhase(x,today)!=='ended');
   if(old){rows.push({...old,retainedFromPrevious:true});inventory.push({sourceUrl:e.sourceUrl,expected:true,id});}
   else if(eligible.test(e.fairName)||e.fromOfficialList){rows.push({id,fairName:e.fairName,sourceUrl:e.sourceUrl,indexUrl:e.indexUrl,startDate:e.startDate,endDate:e.endDate,category:category(e.fairName),scopeNote:'詳細ページの取得に失敗しました。公式の対象店舗・利用条件を確認してください。',items:[],itemStatus:'unavailable',metadataStatus:'partial',lastConfirmedAt:null});inventory.push({sourceUrl:e.sourceUrl,expected:true,id});}
   else inventory.push({sourceUrl:e.sourceUrl,unresolved:true,error:error.message});
  }
 });
 if(failures.length)for(const old of previous)if(freshPrevious(old,now)&&campaignPhase(old,today)!=='ended'&&!rows.some(x=>x.id===old.id)&&!inventory.some(x=>canonical(x.sourceUrl)===canonical(old.sourceUrl)&&x.excludedReason))rows.push({...old,retainedFromPrevious:true});
 rows.sort((a,b)=>String(a.startDate||'').localeCompare(String(b.startDate||''))||a.id.localeCompare(b.id));
 const coverage={version:1,state:failures.length||inventory.some(x=>x.unresolved)?'partial':'complete',attemptedAt,indices:indexResults,expectedUrls:[...new Set(inventory.filter(x=>x.expected).map(x=>x.sourceUrl))].sort(),expectedIds:inventory.filter(x=>x.expected).map(x=>x.id).sort(),failures,inventory:inventory.sort((a,b)=>a.sourceUrl.localeCompare(b.sourceUrl)),horizonDays:HORIZON,feedLookbackDays:LOOKBACK};
 return {rows,coverage};
}
export function verifyCoverage(data,inventory){
 for(const id of Object.keys(SOURCES)){
  const chain=data.chains?.find(x=>x.chain===id),proof=inventory?.[id];if(!chain||!proof)throw new Error(`${id}: independent announcement inventory missing`);
  const rows=chain.campaignCatalog;if(!Array.isArray(rows))throw new Error(`${id}: campaign catalog missing`);
  const urls=new Set(rows.map(x=>canonical(x.sourceUrl))),ids=new Set();
  for(const u of proof.expectedUrls||[])if(!urls.has(canonical(u)))throw new Error(`${id}: announced campaign dropped after collection: ${u}`);
  for(const r of rows){if(!r.id||ids.has(r.id)||!canonical(r.sourceUrl)||!r.fairName)throw new Error(`${id}: invalid campaign record`);ids.add(r.id);}
  for(const expected of proof.expectedIds||[])if(!ids.has(expected))throw new Error(`${id}: distinct announcement dropped after collection: ${expected}`);
  if(proof.state==='complete'&&!proof.indices?.some(x=>x.status==='ok'))throw new Error(`${id}: complete coverage claimed without fetched index`);
  if(chain.campaignCoverage?.attemptedAt!==proof.attemptedAt)throw new Error(`${id}: coverage inventory replaced downstream`);
 }
 return true;
}
export async function main(argv=process.argv.slice(2)){
 const value=flag=>{const i=argv.indexOf(flag);return i<0?null:argv[i+1];},file=value('--file')||FAIR,report=value('--report')||'/tmp/campaign-coverage.json';
 const data=JSON.parse(await fs.readFile(file,'utf8'));
 if(argv.includes('--verify')){verifyCoverage(data,JSON.parse(await fs.readFile(report,'utf8')));console.log('Independent campaign inventory matches final dataset.');return;}
 const previous=process.env.PREVIOUS_FAIRS?JSON.parse(await fs.readFile(process.env.PREVIOUS_FAIRS,'utf8')):data,inventory={};
 for(const id of Object.keys(SOURCES)){
  const chain=data.chains.find(x=>x.chain===id);if(!chain)throw new Error(`${id}: chain missing`);
  const result=await collectChain(id,previous.chains?.find(x=>x.chain===id)?.campaignCatalog||[],value('--today')||catalogToday());
  chain.campaignCatalog=result.rows;chain.campaignCoverage=result.coverage;inventory[id]=result.coverage;
  if(result.coverage.state!=='complete')console.warn(`::warning::${id} announcement coverage is partial; do not claim completeness`);
  console.log(JSON.stringify({chain:id,coverage:result.coverage.state,indices:result.coverage.indices,failures:result.coverage.failures,campaigns:result.rows.map(x=>({id:x.id,title:x.fairName,start:x.startDate,end:x.endDate,url:x.sourceUrl,items:x.items}))}));
 }
 verifyCoverage(data,inventory);await fs.writeFile(report,JSON.stringify(inventory,null,2)+'\n');await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
