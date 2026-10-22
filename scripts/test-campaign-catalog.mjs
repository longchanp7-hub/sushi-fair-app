import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDates,parseProducts,discoverIndex,parseDetail,collectChain,verifyCoverage,SOURCES,tokubeiSourceVerified,tokubeiRecurringRows} from './campaign-catalog.mjs';
import {campaignPhase,canonicalCampaignUrl,renderCampaignCatalog,visibleCampaigns} from '../app/campaign-catalog.js';
const today='2026-09-07';
const toro='https://prtimes.jp/main/html/rd/p/000001212.000018731.html';
const spicy='https://prtimes.jp/main/html/rd/p/000001217.000018731.html';
const early='https://prtimes.jp/main/html/rd/p/000001218.000018731.html';
const release='<article><h1>かっぱ寿司「トロの日」</h1><p>2026年9月16日（水）限定、かっぱ寿司全店にて</p><p>『ほおばる贅沢！大とろ尽くし包み いくらのせ』</p><p>一貫355円（税込390円）〜</p></article>';
const entry={sourceUrl:toro,indexUrl:SOURCES.kappasushi.indices[1],fairName:'トロの日',indexText:'2026年9月16日（水）限定'};
const tororow=()=>parseDetail(release,entry,'kappasushi',today);

test('Kappa four-day sets parse only four special prices, not receipt lottery spending',()=>{
 const url='https://prtimes.jp/main/html/rd/p/000001235.000018731.html';
 const title='かっぱ寿司の「秋のお得なセットメニュー」4種、アサイーボウルも';
 const html='<article><h1>'+title+'</h1>'+
 '<p>■販売期間：2026年10月22日（木）～10月25日（日）（予定）</p>'+
 '<p>まぐろ＆貝食べ比べセット</p><p>・ミナミマグロ3種</p><p>通常価格：税込１,０５６円～</p><p>→4日間限定特別価格：税込１,０１２円～</p>'+
 '<p>贅沢よくばり寿司セット</p><p>・サーモン</p><p>通常価格：税込1,650円～</p><p>→4日間限定特別価格：税込1,584円～</p>'+
 '<p>ラーメン＆サラダセット</p><p>・ラーメン</p><p>通常価格：税込671円～</p><p>→4日間限定特別価格：税込649円～</p>'+
 '<p>アサイー＆わらび餅セット</p><p>・わらび餅</p><p>通常価格：税込517円～</p><p>→4日間限定特別価格：税込495円～</p>'+
 '<h2>■10月レシート応募キャンペーン</h2><p>※本キャンペーンは1枚の対象レシートにつき、税込3,000円ごとに抽選</p></article>';
 const entry={sourceUrl:url,fairName:title,indexText:'2026年10月22日～10月25日',publishedAt:'2026-10-16T11:00:00+09:00'};
 const row=parseDetail(html,entry,'kappasushi','2026-10-17');
 assert.equal(row.category,'set');
 assert.equal(row.fairName,'秋のお得なセットメニュー（4日間限定）');
 assert.deepEqual([row.startDate,row.endDate,row.campaignPhase,row.itemStatus],['2026-10-22','2026-10-25','upcoming','parsed']);
 assert.deepEqual(row.items.map(x=>[x.name,x.price,x.priceType,x.saleStatus]),[
  ['まぐろ＆貝食べ比べセット',1012,'from','upcoming'],
  ['贅沢よくばり寿司セット',1584,'from','upcoming'],
  ['ラーメン＆サラダセット',649,'from','upcoming'],
  ['アサイー＆わらび餅セット',495,'from','upcoming']]);
 assert.equal(row.items.some(x=>x.price===3000),false);
 assert.equal(parseDetail(html,entry,'kappasushi','2026-10-22').campaignPhase,'active');
 assert.equal(parseDetail(html,entry,'kappasushi','2026-10-26').excludedReason,'ended');
 assert.deepEqual(parseDetail(html.replace('<p>→4日間限定特別価格：税込495円～</p>',''),entry,'kappasushi','2026-10-17').items,[]);
});
test('receipt/application charges never become food products',()=>{
 const u='https://prtimes.jp/main/html/rd/p/000001235.000018731.html';
 assert.deepEqual(parseProducts(['※本キャンペーンは1枚の対象レシートにつき 税込3,000円','応募条件 レシート金額','税込3,000円','レシートをお持ちの方 税込3,000円'],u,{startDate:'2026-10-22',endDate:'2026-10-25'}),[]);
});


test('Tokubei 9/19/29 are separate dated food, coupon, app benefits with valid redemption phase',()=>{
 const u='https://www.nigirinotokubei.com/info/10346',r=tokubeiRecurringRows('2026-10-19',u);
 const ninth=r.find(x=>x.id==='tokubei-recurring-day-2026-11-09');
 const nineteenth=r.find(x=>x.id==='tokubei-recurring-day-2026-10-19');
 const redeem=r.find(x=>x.id==='tokubei-recurring-coupon-2026-10-19');
 assert.deepEqual(ninth.items.map(x=>[x.name,x.price]),[['徳兵衛の日限定7貫盛り',1089]]);
 assert.equal(nineteenth.category,'benefit');assert.equal(nineteenth.campaignPhase,'active');assert.equal(nineteenth.items.length,0);
 assert.deepEqual([redeem.startDate,redeem.endDate,redeem.campaignPhase],['2026-10-20','2026-11-18','upcoming']);
 const now=tokubeiRecurringRows('2026-10-23',u);
 assert.ok(now.some(x=>x.id==='tokubei-recurring-coupon-2026-10-19'&&x.campaignPhase==='active'));
 assert.ok(now.some(x=>x.id==='tokubei-recurring-day-2026-10-29'&&x.campaignPhase==='upcoming'));
 assert.ok(!now.some(x=>x.id==='tokubei-recurring-day-2026-10-19'));
 assert.ok(now.some(x=>x.id==='tokubei-recurring-day-2026-10-29'&&x.scopeNote.includes('稲沢店')));
 assert.ok(!tokubeiRecurringRows('2027-02-28',u).some(x=>x.id==='tokubei-recurring-day-2027-02-29'));
});
test('Tokubei official fallthrough still verifies recurrence when main indexes are HTTP503',async()=>{
 const body='<main>9のつく日は徳兵衛の日 毎月9日・19日・29日に実施中 毎月9日 徳兵衛の日限定7貫盛り 990円（税込1,089円） 毎月19日 税込1,000円以上のお会計で200円券配布 毎月29日 アトムアプリポイント3倍 200円券の有効期限は配布翌日～翌月18日まで</main>';
 assert.ok(tokubeiSourceVerified(body));
 assert.ok(!tokubeiSourceVerified(body.replace('翌月18日','翌月17日')));
 const r=await collectChain('tokubei',[],'2026-10-23',async url=>{
  if(url==='https://www.atom-corp.co.jp/fair/fair.php?fair_no=3729')return body;
  throw new Error('HTTP 503');
 });
 assert.equal(r.coverage.state,'partial');assert.equal(r.recurringDayCoverage.state,'verified');
 assert.equal(r.recurringDayCoverage.sourceUrl,'https://www.atom-corp.co.jp/fair/fair.php?fair_no=3729');
 assert.equal(r.rows.filter(x=>x.id==='tokubei-recurring-day-2026-11-19').length,1);
 assert.ok(!visibleCampaigns({campaignCatalog:r.rows},'2026-10-23').some(x=>x.kind==='recurrence_summary'));
});

test('MOMOREI buffet admission and leftover charges are not food items',()=>{
 const url='https://prtimes.jp/main/html/rd/p/000001216.000018731.html';
 const title='かっぱ寿司「MOMOREI」食べ放題キャンペーン';
 const html=`<article><h1>${title}</h1><p>キャンペーン開始日：2026年10月1日（木）～なくなり次第終了</p><p>小学生：1,990 円（税込）、幼児（未就学児）：無料</p><p>※シャリを残された場合、一貫につき33円（税込）をいただいております。</p></article>`;
 const row=parseDetail(html,{sourceUrl:url,fairName:title,indexText:title,publishedAt:'2026-09-09T16:00:00+09:00'},'kappasushi','2026-10-14');
 assert.equal(row.campaignPhase,'active');
 assert.equal(row.startDate,'2026-10-01');
 assert.deepEqual(row.items,[]);
 assert.equal(row.itemStatus,'unavailable');
});
test('buffet admission labels are excluded in single and split lines',()=>{
 const range={startDate:'2026-10-01',endDate:null};
 for(const name of ['一般','大人','小学生:','中学生〜大学院生','シニア(65歳以上)','幼児(未就学児)','平日学割']){
  assert.deepEqual(parseProducts([`${name} 税込1,990円`],toro,range),[],name);
  assert.deepEqual(parseProducts([name,'税込1,990円'],toro,range),[],name);
  assert.deepEqual(parseProducts(['食べ放題の料金',`${name} 税込1,990円`],toro,range),[],name);
 }
});
test('real rice dishes and child meals keep their tax-inclusive prices',()=>{
 const items=parseProducts(['『追いシャリ』 税込110円','『お子様セット』 税込390円','『うに軍艦』 一貫173円（税込190円）〜'],toro,{startDate:'2026-10-01',endDate:null});
 assert.deepEqual(items.map(x=>[x.name,x.price]),[['追いシャリ',110],['お子様セット',390],['うに軍艦',190]]);
 assert.equal(items[2].priceType,'from');
});
test('one day and Unicode dates; publication date is not sale date',()=>{
 assert.deepEqual(parseDates('2026年9月16日（水）限定',2026),{startDate:'2026-09-16',endDate:'2026-09-16'});
 assert.deepEqual(parseDates('２０２６年９月１８日（金）～１０月４日（日）',2026),{startDate:'2026-09-18',endDate:'2026-10-04'});
 assert.deepEqual(parseDates('2026.09.01更新 秋ランチ2026年9月1日（火）～11月2日（月）',2026),{startDate:'2026-09-01',endDate:'2026-11-02'});
 assert.deepEqual(parseDates('2026年9月9日（水）から9月16日（水）まで',2026),{startDate:'2026-09-09',endDate:'2026-09-16'});
 assert.deepEqual(parseDates('2026.09.02更新',2026),{startDate:null,endDate:null});
 assert.deepEqual(parseDates('2026年12月25日～1月4日',2026),{startDate:'2026-12-25',endDate:'2027-01-04'});
});
test('future release and minimum tax-inclusive price survive',()=>{const r=tororow();assert.equal(r.campaignPhase,'upcoming');assert.equal(r.items[0].price,390);assert.equal(r.items[0].priceType,'from');assert.equal(r.startDate,r.endDate);});
test('Kappa food releases without generic campaign words are retained',()=>{
 const title='韓国市場売上No.1韓国のソウルフード「辛ラーメン」が、かっぱ寿司に登場！かっぱ寿司×「辛ラーメン」活〆真鯛のアラ出汁を合わせた「鯛スープの海鮮 辛ラーメン」シリーズ3種が新登場';
 const html=`<article><h1>${title}</h1><p>販売期間：2026年9月17日（木）～2026年12月9日（水）予定</p><p>販売店舗：かっぱ寿司全店</p><p>『鯛スープの海鮮 辛ラーメン』</p><p>391円（税込430円）</p><p>『鯛スープの海鮮 辛ラーメン 追いシャリセット』</p><p>491円（税込540円）</p><p>『鯛スープの海鮮 辛ラーメン 味変セット』</p><p>628円（税込690円）</p></article>`;
 const r=parseDetail(html,{sourceUrl:spicy,indexUrl:SOURCES.kappasushi.indices[1],fairName:title,indexText:title,publishedAt:'2026-09-09T14:00:02+09:00'},'kappasushi','2026-09-11');
 assert.equal(r.campaignPhase,'upcoming');assert.equal(r.category,'other');assert.equal(r.startDate,'2026-09-17');assert.equal(r.endDate,'2026-12-09');assert.deepEqual(r.items.map(x=>x.price),[430,540,690]);
});
test('Kappa takeout early-bird release keeps reservation and pickup periods distinct and excludes discounts from items',()=>{
 const title='【本日から】 お持ち帰りWEB予約限定！早めのご予約で税込400円OFF！シルバーウィークのお集まりや秋の行楽に！かっぱ寿司「シルバーウィーク早割」';
 const html=`<article><h1>${title}</h1><p>2026年9月9日（水）から9月16日（水）までの期間中、かっぱ寿司アプリ会員のお客様を対象に、お持ち帰りWEB予約で税込3,000円以上ご予約いただいたお客様がご利用いただける税込400円OFFクーポンをご用意しました。対象商品のお受け取り期間は、2026年9月19日（土）から9月23日（水・祝）までです。</p><p>■ご予約受付期間：2026年9月9日（水）～9月16日（水）</p><p>■対象お受け取り期間：2026年9月19日（土）～9月23日（水・祝）</p><p>■実施店舗：かっぱ寿司全店（一部改装中・休業中店舗は除く）</p><p>※税込400円分の値引き額がレシートに表記されます。</p></article>`;
 const r=parseDetail(html,{sourceUrl:early,indexUrl:SOURCES.kappasushi.indices[1],fairName:title,indexText:title,publishedAt:'2026-09-09T11:00:02+09:00'},'kappasushi','2026-09-11');
 assert.equal(r.category,'takeout');assert.equal(r.campaignPhase,'active');assert.equal(r.startDate,'2026-09-09');assert.equal(r.endDate,'2026-09-16');assert.equal(r.items.length,0);assert.match(r.scopeNote,/アプリ会員対象/);assert.match(r.scopeNote,/3,000円以上/);assert.match(r.scopeNote,/400円OFF/);assert.match(r.scopeNote,/2026-09-19〜2026-09-23/);assert.match(r.scopeNote,/改装中・休業中/);
});
test('generic app feature announcement is still excluded despite new-arrival wording',()=>{
 const title='かっぱ寿司公式アプリに新機能が登場';
 const r=parseDetail(`<article><h1>${title}</h1><p>かっぱ寿司公式アプリをアップデートしました。</p></article>`,{sourceUrl:'https://prtimes.jp/main/html/rd/p/000001219.000018731.html',fairName:title,indexText:title,publishedAt:'2026-09-10T10:00:00+09:00'},'kappasushi','2026-09-11');
 assert.equal(r.excludedReason,'not_food_campaign');
});
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

