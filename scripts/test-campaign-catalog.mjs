import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDates,discoverIndex,parseDetail,collectChain,verifyCoverage,SOURCES} from './campaign-catalog.mjs';
import {campaignPhase,canonicalCampaignUrl,renderCampaignCatalog,visibleCampaigns} from '../app/campaign-catalog.js';
const today='2026-09-07';
const toro='https://prtimes.jp/main/html/rd/p/000001212.000018731.html';
const release='<article><h1>かっぱ寿司「トロの日」</h1><p>2026年9月16日（水）限定、かっぱ寿司全店にて</p><p>『ほおばる贅沢！大とろ尽くし包み いくらのせ』</p><p>一貫355円（税込390円）〜</p></article>';
const entry={sourceUrl:toro,indexUrl:SOURCES.kappasushi.indices[1],fairName:'トロの日',indexText:'2026年9月16日（水）限定'};
const tororow=()=>parseDetail(release,entry,'kappasushi',today);
test('one day and Unicode dates; publication date is not sale date',()=>{
 assert.deepEqual(parseDates('2026年9月16日（水）限定',2026),{startDate:'2026-09-16',endDate:'2026-09-16'});
 assert.deepEqual(parseDates('２０２６年９月１８日（金）～１０月４日（日）',2026),{startDate:'2026-09-18',endDate:'2026-10-04'});
 assert.deepEqual(parseDates('2026.09.01更新 秋ランチ2026年9月1日（火）～11月2日（月）',2026),{startDate:'2026-09-01',endDate:'2026-11-02'});
 assert.deepEqual(parseDates('2026.09.02更新',2026),{startDate:null,endDate:null});
 assert.deepEqual(parseDates('2026年12月25日～1月4日',2026),{startDate:'2026-12-25',endDate:'2027-01-04'});
});
test('future release and minimum tax-inclusive price survive',()=>{const r=tororow();assert.equal(r.campaignPhase,'upcoming');assert.equal(r.items[0].price,390);assert.equal(r.items[0].priceType,'from');assert.equal(r.startDate,r.endDate);});
test('day before / same day / following day',()=>{const r=tororow();assert.equal(campaignPhase(r,'2026-09-15'),'upcoming');assert.equal(campaignPhase(r,'2026-09-16'),'active');assert.equal(campaignPhase(r,'2026-09-17'),'ended');});
test('ended release not silently reclassified active',()=>{assert.equal(parseDetail(release,entry,'kappasushi','2026-09-17').excludedReason,'ended');});
test('index includes concurrent desserts, lunch, takeout and benefits',()=>{
 const html='<ul>'+[['1','秋のスイーツ','9月1日～11月3日'],['2','【平日限定】秋ランチメニュー','9月1日～11月2日'],['3','秋のお持ち帰りすし祭り','9月18日～10月4日'],['4','シニアパスポート','9月18日～10月4日']].map(([id,t,d])=>`<li><a href="/info/${id}/"><h3>${t}</h3><p>2026年${d}</p></a></li>`).join('')+'</ul>';
 const links=discoverIndex(html,'https://www.nigirinotokubei.com/','tokubei');assert.equal(links.length,4);
 const rows=links.map(e=>parseDetail(`<article><h1>${e.fairName}</h1><p>${e.indexText}</p></article>`,e,'tokubei',today));
 assert.deepEqual(rows.map(x=>x.category),['dessert','lunch','takeout','benefit']);assert.equal(rows[2].campaignPhase,'upcoming');assert.equal(rows[3].endDate,'2026-10-04');
});
test('campaign without text products is retained with explicit unavailability',()=>{const r=parseDetail('<article><h1>秋のスイーツ</h1><img src="menu.png"></article>',{...entry,fairName:'秋のスイーツ',indexText:'2026年9月1日～11月3日'},'tokubei',today);assert.equal(r.items.length,0);assert.equal(r.itemStatus,'unavailable');});
test('collect more than first active release',async()=>{const index=`<a href="${toro}">トロの日</a><a href="https://prtimes.jp/main/html/rd/p/000001213.000018731.html">秋のおすすめフェア</a>`;const fetcher=async u=>SOURCES.kappasushi.indices.includes(u)?index:u===toro?release:'<article><h1>かっぱ寿司 秋のおすすめフェア</h1><p>2026年9月3日～9月30日</p></article>';const result=await collectChain('kappasushi',[],today,fetcher);assert.equal(result.rows.length,2);assert.equal(result.coverage.expectedUrls.length,2);});
test('deterministic publication loss is blocked by independent inventory',()=>{
 const row=tororow();const proof={state:'complete',attemptedAt:'x',indices:[{status:'ok'}],expectedUrls:[toro]};
 const data={chains:[{chain:'kappasushi',campaignCatalog:[row],campaignCoverage:proof},{chain:'tokubei',campaignCatalog:[],campaignCoverage:{...proof,expectedUrls:[]}}]};const inventory={kappasushi:proof,tokubei:data.chains[1].campaignCoverage};assert.ok(verifyCoverage(data,inventory));data.chains[0].campaignCatalog=[];assert.throws(()=>verifyCoverage(data,inventory),/dropped/);
});
test('source failure is not complete; never refresh stale verification timestamps',async()=>{const prev={...tororow(),lastConfirmedAt:new Date().toISOString()};const r=await collectChain('kappasushi',[prev],today,async()=>{throw new Error('HTTP 503');});assert.equal(r.coverage.state,'partial');assert.equal(r.rows[0].lastConfirmedAt,prev.lastConfirmedAt);assert.equal(r.rows[0].retainedFromPrevious,true);});
test('old unconfirmed fallback expires rather than staying current indefinitely',async()=>{const prev={...tororow(),lastConfirmedAt:'2020-01-01T00:00:00Z'};const r=await collectChain('kappasushi',[prev],today,async()=>{throw new Error('HTTP 503');});assert.equal(r.rows.length,0);assert.equal(r.coverage.state,'partial');});
test('future price is isolated from current chain product prices',()=>{const chain={items:[{name:'大とろ',price:340}],campaignCatalog:[tororow()],campaignCoverage:{state:'complete'}};const html=renderCampaignCatalog(chain,today);assert.match(html,/開始予定/);assert.match(html,/390円〜/);assert.equal(chain.items[0].price,340);});
test('render after end date removes the one-day event even with stale phase',()=>{const c={campaignCatalog:[tororow()],campaignCoverage:{state:'complete'}};assert.equal(visibleCampaigns(c,'2026-09-17').length,0);assert.doesNotMatch(renderCampaignCatalog(c,'2026-09-17'),/大とろ尽くし/);});
test('HTML escape and HTTPS URL guard',()=>{const r={...tororow(),fairName:'<script>alert(1)</script>',sourceUrl:'javascript:alert(1)'};const s=renderCampaignCatalog({campaignCatalog:[r],campaignCoverage:{state:'complete'}},today);assert.doesNotMatch(s,/<script>|href="javascript:/);assert.match(s,/&lt;script&gt;/);assert.equal(canonicalCampaignUrl(toro+'?utm_source=x'),toro);});
test('pre-existing main fair is not mutated by catalog rendering',()=>{const c={fairName:'秋の味覚祭り',items:[{name:'秋の特選五貫盛り',price:1155}],campaignCatalog:[tororow()],campaignCoverage:{state:'complete'}};const before=JSON.stringify(c);renderCampaignCatalog(c,today);assert.equal(JSON.stringify(c),before);});
