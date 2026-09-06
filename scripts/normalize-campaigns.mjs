import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const todayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const dayDistance=(iso,today)=>Math.round((new Date(`${iso}T00:00:00+09:00`)-new Date(`${today}T00:00:00+09:00`))/86400000);
const phase=(c,today)=>c?.endDate&&c.endDate<today?'ended':c?.startDate&&c.startDate>today?'upcoming':'active';
const uniq=rows=>[...new Map(rows.filter(x=>x?.name).map(x=>[`${clean(x.name)}|${x.price??''}`,x])).values()];

export function normalizeConcurrentCampaigns(data,today=todayKey()){
  for(const chain of data.chains||[]){
    if(!Array.isArray(chain.campaigns)||!chain.campaigns.length)continue;
    chain.campaigns=chain.campaigns.map(c=>({...c,campaignPhase:phase(c,today),items:(c.items||[]).map(item=>item?.endDate&&item.endDate<today?{...item,saleStatus:'ended'}:item)}));
    if(chain.chain!=='kappasushi')continue;
    const active=chain.campaigns.filter(c=>c.campaignPhase==='active');
    const upcoming=chain.campaigns.filter(c=>c.campaignPhase==='upcoming'&&c.startDate&&dayDistance(c.startDate,today)<=14).sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
    const selected=active.length?active:(upcoming.length?[upcoming[0]]:[]);
    if(!selected.length){
      if(chain.endDate&&chain.endDate<today){chain.status='warning';chain.campaignPhase='ended';}
      continue;
    }
    const names=[...new Set(selected.map(c=>clean(c.fairName)).filter(Boolean))];
    if(names.length)chain.fairName=names.join('／');
    const starts=selected.map(c=>c.startDate).filter(Boolean).sort();
    const ends=selected.map(c=>c.endDate).filter(Boolean).sort();
    chain.startDate=starts[0]||chain.startDate||null;
    chain.endDate=selected.some(c=>!c.endDate)?null:(ends.at(-1)||chain.endDate||null);
    chain.campaignPhase=active.length?'active':'upcoming';
    if(!active.length)chain.status='warning';
    const campaignItems=uniq(selected.flatMap(c=>c.items||[])).filter(item=>item.saleStatus!=='ended'&&(!item.endDate||item.endDate>=today));
    if(campaignItems.length)chain.items=campaignItems;
  }
  return data;
}

function selfTest(){
  const data={chains:[{chain:'kappasushi',fairName:'all',startDate:'2026-09-03',endDate:'2026-09-30',items:[],campaigns:[
    {fairName:'増量祭り',startDate:'2026-09-03',endDate:'2026-09-16',items:[{name:'増量えび',price:150,startDate:'2026-09-03',endDate:'2026-09-16',saleStatus:'active'}]},
    {fairName:'秋のおすすめ',startDate:'2026-09-03',endDate:null,items:[{name:'大とろ',price:340,startDate:'2026-09-03',endDate:null,saleStatus:'active'}]},
    {fairName:'お月見祭り',startDate:'2026-09-03',endDate:'2026-09-30',items:[{name:'月見牛肉いなり',price:190,startDate:'2026-09-03',endDate:'2026-09-30',saleStatus:'active'}]},
  ]}]};
  normalizeConcurrentCampaigns(data,'2026-09-17');
  const k=data.chains[0];
  assert.equal(k.fairName,'秋のおすすめ／お月見祭り');
  assert.equal(k.items.some(x=>x.name==='増量えび'),false);
  assert.equal(k.items.some(x=>x.name==='大とろ'),true);
  assert.equal(k.endDate,null);
  console.log('Concurrent campaign normalization self-tests passed.');
}

async function main(){
  if(process.argv.includes('--self-test'))return selfTest();
  const data=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));
  normalizeConcurrentCampaigns(data);
  data.updatedAt=new Date().toISOString();
  await fs.writeFile(FAIR_PATH,`${JSON.stringify(data,null,2)}\n`);
  console.log('Normalized campaign phases; Kappa top-level data follows only active/current campaigns.');
}
await main();
