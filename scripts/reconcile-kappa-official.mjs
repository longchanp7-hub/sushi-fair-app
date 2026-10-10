import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const FAIR=path.join(ROOT,'app/data/fairs.json');
const UNI_URL='https://prtimes.jp/main/html/rd/p/000001227.000018731.html';
const NAGANO_URL='https://prtimes.jp/main/html/rd/p/000001226.000018731.html';
const TARGET_FIRST='2026-10-01',TARGET_LAST='2026-10-21';
const TARGET_SECOND='2026-10-22',SECOND_LAST='2026-11-11';
const REGIONS='長野県・東京都・埼玉県・神奈川県・千葉県';

const NAGANO_PHASES=[
  {startDate:TARGET_FIRST,endDate:TARGET_LAST,items:[
    ['クイーンルージュ®＆シャインマスカット食べ比べ ～ミニバニラアイス添え～',340],
    ['クイーンルージュ®＆シャインマスカット 紅茶ゼリーのパフェ ～醤油キャラメルアイス～',790],
    ['創業の地“ながの”5貫プレート',390],
    ['かっぱスティック “しょうゆ豆”',190],
  ]},
  {startDate:TARGET_SECOND,endDate:SECOND_LAST,items:[
    ['ふじりんごと紅茶ゼリーのプレミアムプリンパフェ ～醤油キャラメルアイス～',540],
    ['合鴨ロース ～ふじりんごのクリーミーマヨソース～',150],
    ['えび天にぎり ～ふじりんごのクリーミーマヨソース～',190],
    ['サラダ軍艦 ～ふじりんごのクリーミーマヨソース～',150],
    ['ふじりんごソース',60],
  ]},
];
const phase=(start,end,today)=>end<today?'ended':start>today?'upcoming':'active';
const clean=(v)=>String(v||'').replace(/\s+/g,' ').trim();
const todayJst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const source=(entry,url)=>entry?.sourceUrl===url&&entry.itemStatus==='parsed'&&!entry.retainedFromPrevious&&entry.items?.length>0;

// Only the dated, identified official release may replace the national top-level fair.
// The official announcement inventory itself is maintained independently upstream.
export function reconcileKappaOfficial(data,today=todayJst()){
  const chain=(data.chains||[]).find(c=>c.chain==='kappasushi');
  if(!chain||chain.campaignCoverage?.state!=='complete'||!Array.isArray(chain.campaignCatalog))return {promoted:false,nagano:false,reason:'campaign_inventory_not_complete'};
  let promoted=false,nagano=false;
  const uni=chain.campaignCatalog.find(c=>source(c,UNI_URL));
  if(uni&&uni.startDate===TARGET_FIRST&&uni.endDate===TARGET_LAST
      &&uni.items.length===5
      &&uni.items.every(i=>clean(i.name)&&Number.isFinite(i.price)&&i.price>0&&i.sourceUrl===UNI_URL)
      &&today>=TARGET_FIRST&&today<=TARGET_LAST){
    chain.fairName='かっぱの贅沢うに祭り';
    chain.startDate=TARGET_FIRST;
    chain.endDate=TARGET_LAST;
    chain.campaignPhase='active';
    chain.items=structuredClone(uni.items);
    chain.sourceUrl=UNI_URL;
    chain.officialCampaignUrl=UNI_URL;
    chain.officialCampaignTitle=chain.fairName;
    chain.priceNote='全国向け公式プレスリリース掲載の税込価格（最低価格の場合あり）。店舗ごとに取扱い・販売状況が異なります。';
    chain.status='ok';
    chain.message=null;
    // The previous hero described September items; never present it as the new fair.
    chain.representativeImageUrl=null;
    chain.imageUrl=null;
    chain.representativeImageProduct=uni.items[0].name;
    chain.representativeImagePage=UNI_URL;
    chain.representativeImageSource='unavailable_for_current_fair';
    promoted=true;
  }
  const base=chain.campaignCatalog.find(c=>source(c,NAGANO_URL));
  if(base&&base.startDate===TARGET_FIRST&&base.endDate===TARGET_LAST
      &&base.items.length>=8
      &&today<=SECOND_LAST){
    const replacements=NAGANO_PHASES.map((spec,i)=>({
      ...base,
      id:i===0?base.id:base.id+'-phase2',
      fairName:'長野市フェア 第'+(i+1)+'弾',
      category:'store_limited',
      startDate:spec.startDate,endDate:spec.endDate,
      campaignPhase:phase(spec.startDate,spec.endDate,today),
      scopeNote:REGIONS+'のかっぱ寿司限定（一部休業・改装店舗除く）。天候・入荷・売れ行き等で品切れ・早期終了の場合があります。税込価格は公式発表のものです。第2弾の商品は10月22日までは販売開始前です。',
      items:spec.items.map(([name,price])=>({
        name,price,priceType:'listed',
        startDate:spec.startDate,endDate:spec.endDate,
        sourceUrl:NAGANO_URL,
        saleStatus:phase(spec.startDate,spec.endDate,today),
        scrapeStatus:'ok',
      })),
      itemStatus:'parsed',metadataStatus:'parsed',
    }));
    chain.campaignCatalog=chain.campaignCatalog.flatMap(row=>row.id===base.id?replacements:[row]);
    nagano=true;
  }
  return {promoted,nagano};
}

function selfTest(){
  const mk=()=>({chains:[{chain:'kappasushi',fairName:'かっぱの秋のおすすめ',startDate:'2026-09-03',
    campaignCoverage:{state:'complete'},items:[{name:'old',price:110}],representativeImageUrl:'https://example.com/old.png',
    campaignCatalog:[
      {id:'uni-1',fairName:'長いPR名',sourceUrl:UNI_URL,startDate:TARGET_FIRST,endDate:TARGET_LAST,
        itemStatus:'parsed',items:['うに軍艦','ごちそう 倍盛うに軍艦','ごちそう うに中とろ','贅沢うに茶碗蒸し','うにクリーミーコロッケ'].map((name,i)=>({name,price:[190,340,390,390,290][i],sourceUrl:UNI_URL}))},
      {id:'nagano-1',fairName:'長野市フェア',sourceUrl:NAGANO_URL,startDate:TARGET_FIRST,endDate:TARGET_LAST,
        itemStatus:'parsed',items:Array.from({length:9},(_,i)=>({name:'fragment'+i,price:100+i,sourceUrl:NAGANO_URL}))},
    ]}]});
  const data=mk(),result=reconcileKappaOfficial(data,'2026-10-10'),chain=data.chains[0];
  assert.deepEqual(result,{promoted:true,nagano:true});
  assert.equal(chain.fairName,'かっぱの贅沢うに祭り');
  assert.equal(chain.items.length,5);
  assert.equal(chain.representativeImageUrl,null);
  const nagano=chain.campaignCatalog.filter(x=>x.sourceUrl===NAGANO_URL);
  assert.equal(nagano.length,2);
  assert.notEqual(nagano[0].id,nagano[1].id);
  assert.deepEqual(nagano.map(x=>x.items.length),[4,5]);
  assert.deepEqual(nagano.map(x=>x.campaignPhase),['active','upcoming']);
  assert.deepEqual(nagano[1].items.map(x=>x.startDate),Array(5).fill(TARGET_SECOND));
  assert.ok(nagano[0].items.every(x=>x.saleStatus==='active'));
  assert.ok(nagano[1].items.every(x=>x.saleStatus==='upcoming'));
  const after=mk();const check=reconcileKappaOfficial(after,'2026-10-22');
  assert.equal(check.promoted,false,'Expired national fair must not be advertised as current');
  assert.equal(after.chains[0].campaignCatalog.filter(x=>x.sourceUrl===NAGANO_URL)[1].campaignPhase,'active');
  const unavailable=mk();unavailable.chains[0].campaignCoverage.state='partial';
  assert.equal(reconcileKappaOfficial(unavailable,'2026-10-10').promoted,false);
  const stale=mk();stale.chains[0].campaignCatalog[0].retainedFromPrevious=true;
  assert.equal(reconcileKappaOfficial(stale,'2026-10-10').promoted,false);
  console.log('Kappa official current fair and Nagano phase separation self-tests passed.');
}

export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--self-test'))return selfTest();
  const data=JSON.parse(await fs.readFile(FAIR,'utf8'));
  const result=reconcileKappaOfficial(data,argv.includes('--today')?argv[argv.indexOf('--today')+1]:todayJst());
  await fs.writeFile(FAIR,JSON.stringify(data,null,2)+'\n');
  console.log('Kappa official release reconciliation: '+JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
