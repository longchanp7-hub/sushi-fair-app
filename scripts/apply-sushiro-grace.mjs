import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const PREVIOUS_PATH=process.env.PREVIOUS_FAIRS||null;
const GRACE_DAYS=7;
const todayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const addDays=(iso,n)=>{const d=new Date(`${iso}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};

export function mergeSushiroNational(current,previous,today=todayKey()){
  if(!current)return current;
  const seen=new Set((current.items||[]).map(x=>clean(x.name)));
  const currentItems=(current.items||[]).map(item=>({
    ...item,
    saleStatus:item.endDate&&item.endDate<today?'ended':(item.saleStatus||'active'),
    scrapeStatus:item.scrapeStatus||'ok',
    lastSeenAt:today,
    missingSince:null,
    graceUntil:null,
    sourceUrl:item.sourceUrl||current.sourceUrl||null,
  }));
  const carried=[];
  for(const old of previous?.items||[]){
    if(!old?.name||seen.has(clean(old.name)))continue;
    if(old.endDate&&old.endDate<today)continue;
    let missingSince=old.missingSince||today;
    let graceUntil=old.graceUntil||null;
    if(!old.endDate){
      graceUntil ||= addDays(missingSince,GRACE_DAYS);
      if(today>graceUntil)continue;
    }
    carried.push({
      ...old,
      saleStatus:old.saleStatus==='ended'?'unknown':(old.saleStatus||'unknown'),
      scrapeStatus:'not_listed_reference_store',
      missingSince,
      graceUntil,
      availabilityNote:old.endDate
        ?'代表店舗で今回未掲載ですが、公式販売期間内のため全国フェア商品として保持しています。'
        :`代表店舗で今回未掲載です。公式終了確認がないため${GRACE_DAYS}日間のgrace期間で保持しています。`,
      sourceUrl:old.sourceUrl||previous?.sourceUrl||current.sourceUrl||null,
    });
  }
  return {
    ...current,
    dataScope:'national_fair_with_reference_store_overlay',
    nationalSourceOfTruth:true,
    referenceStoreOverlayOnly:true,
    items:[...currentItems,...carried],
  };
}

function selfTest(){
  const previous={sourceUrl:'https://example.test/fair',items:[
    {name:'期間あり',price:100,startDate:'2026-08-01',endDate:'2026-09-01',saleStatus:'active',scrapeStatus:'ok'},
    {name:'終了日なし',price:200,startDate:'2026-08-01',endDate:null,saleStatus:'active',scrapeStatus:'ok'},
    {name:'期限切れ',price:300,startDate:'2026-08-01',endDate:'2026-08-20',saleStatus:'active',scrapeStatus:'ok'},
  ]};
  const current={chain:'sushiro',sourceUrl:'https://example.test/fair',items:[{name:'現行',price:110,startDate:'2026-08-19',endDate:'2026-08-30',saleStatus:'active',scrapeStatus:'ok'}]};
  const first=mergeSushiroNational(current,previous,'2026-08-25');
  assert.equal(first.items.find(x=>x.name==='現行').startDate,'2026-08-19','upstream item date must be preserved');
  assert.equal(first.items.find(x=>x.name==='期間あり')?.scrapeStatus,'not_listed_reference_store');
  assert.equal(first.items.find(x=>x.name==='終了日なし')?.graceUntil,'2026-09-01');
  assert.equal(first.items.some(x=>x.name==='期限切れ'),false,'expired item must be dropped');
  const old={...previous,items:[{...previous.items[1],missingSince:'2026-08-10',graceUntil:'2026-08-17'}]};
  assert.equal(mergeSushiroNational(current,old,'2026-08-25').items.some(x=>x.name==='終了日なし'),false,'unknown-end item must leave public list after grace without being marked ended');
  console.log('Sushiro national/grace self-tests passed.');
}

if(process.argv.includes('--self-test'))selfTest();
else{
  const data=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));
  let previous=null;
  if(PREVIOUS_PATH){try{previous=JSON.parse(await fs.readFile(PREVIOUS_PATH,'utf8'));}catch{}}
  const current=data.chains?.find(x=>x.chain==='sushiro');
  const old=previous?.chains?.find(x=>x.chain==='sushiro');
  if(current){
    const merged=mergeSushiroNational(current,old);
    data.chains=data.chains.map(x=>x.chain==='sushiro'?merged:x);
    await fs.writeFile(FAIR_PATH,JSON.stringify(data,null,2)+'\n');
    console.log(`Applied Sushiro national source-of-truth + ${GRACE_DAYS}-day grace policy.`);
  }
}
