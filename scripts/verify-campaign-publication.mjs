import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalCampaignUrl,renderCampaignCatalog,visibleCampaigns} from '../app/campaign-catalog.js';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
export const TARGETS=['kappasushi','tokubei'];
const validDate=v=>v===null||v===undefined||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export function validateCatalog(data,inventory=null){
 const result={};
 for(const id of TARGETS){
  const c=data.chains?.find(x=>x.chain===id),proof=inventory?.[id]||c?.campaignCoverage;
  assert.ok(c&&proof,`${id}: announcement coverage missing`);
  assert.ok(['complete','partial'].includes(proof.state),`${id}: coverage state invalid`);
  assert.ok(Number.isFinite(Date.parse(proof.attemptedAt)),`${id}: coverage time missing`);
  assert.ok(Array.isArray(c.campaignCatalog),`${id}: catalog missing`);
  assert.deepEqual(c.campaignCoverage,proof,`${id}: independent inventory differs from final coverage`);
  const ids=new Set(),urls=new Set();
  for(const row of c.campaignCatalog){
   assert.ok(row.id&&row.fairName&&!ids.has(row.id),`${id}: missing or duplicate announcement ID`);
   assert.ok(canonicalCampaignUrl(row.sourceUrl),`${id}: unsafe source URL`);
   assert.ok(validDate(row.startDate)&&validDate(row.endDate),`${id}: invalid date`);
   assert.ok(!row.startDate||!row.endDate||row.startDate<=row.endDate,`${id}: reversed dates`);
   assert.ok(Array.isArray(row.items),`${id}: items must be an array`);
   assert.ok(['parsed','unavailable'].includes(row.itemStatus),`${id}: item extraction state missing`);
   for(const item of row.items){
    assert.ok(typeof item.name==='string'&&item.name.trim()&&!/^@|https?:\/\//.test(item.name),`${id}: invalid product name`);
    assert.ok(item.price==null||Number.isFinite(item.price)&&item.price>0,`${id}: invalid product price`);
    assert.ok(canonicalCampaignUrl(item.sourceUrl),`${id}: missing product source`);
   }
   ids.add(row.id);urls.add(canonicalCampaignUrl(row.sourceUrl));
  }
  for(const expected of proof.expectedIds||[])assert.ok(ids.has(expected),`${id}: published announcement missing: ${expected}`);
  for(const url of proof.expectedUrls||[])assert.ok(urls.has(canonicalCampaignUrl(url)),`${id}: published announcement URL missing: ${url}`);
  if(proof.state==='complete'){
   assert.ok(proof.indices.length&&proof.indices.every(x=>x.status==='ok'),`${id}: cannot claim complete index coverage after source failure`);
   assert.equal(proof.failures?.length||0,0,`${id}: failures hidden by complete status`);
  }
  const html=renderCampaignCatalog(c);
  for(const row of visibleCampaigns(c))assert.ok(html.includes(`data-campaign-id="${row.id}"`),`${id}: record not rendered`);
  result[id]={coverage:proof.state,announcements:c.campaignCatalog.length,visible:visibleCampaigns(c).length,itemsParsed:c.campaignCatalog.reduce((n,x)=>n+x.items.length,0),itemListsUnavailable:c.campaignCatalog.filter(x=>x.itemStatus==='unavailable').length};
 }
 return result;
}
const payload=data=>data.chains.filter(x=>TARGETS.includes(x.chain)).map(x=>({chain:x.chain,campaignCatalog:x.campaignCatalog,campaignCoverage:x.campaignCoverage}));
export async function main(argv=process.argv.slice(2)){
 const value=flag=>{const i=argv.indexOf(flag);return i<0?null:argv[i+1];};
 const app=path.join(ROOT,'app'),local=JSON.parse(await fs.readFile(path.join(app,'data/fairs.json'),'utf8'));
 const inventoryPath=value('--inventory'),inventory=inventoryPath?JSON.parse(await fs.readFile(inventoryPath,'utf8')):null;
 const localResult=validateCatalog(local,inventory);
 const assetNames=['national.js','campaign-catalog.js','sw.js'];
 const localAssets=Object.fromEntries(await Promise.all(assetNames.map(async name=>[name,await fs.readFile(path.join(app,name),'utf8')])));
 assert.match(localAssets['national.js'],/renderCampaignCatalog\(f\)/,'Main card renderer is not connected');
 assert.match(localAssets['sw.js'],/campaign-catalog\.js\?v=20260907/,'Offline campaign module not precached');
 if(argv.includes('--local')){console.log(JSON.stringify({localValidated:true,chains:localResult},null,2));return;}
 const input=value('--url');if(!input)throw new Error('--url or --local required');
 const base=new URL(input);assert.equal(base.protocol,'https:');if(!base.pathname.endsWith('/'))base.pathname+='/';
 async function text(name,attempt){const u=new URL(name,base);u.searchParams.set('__catalog_verify',`${Date.now()}-${attempt}`);const r=await fetch(u,{signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});if(!r.ok){const e=new Error(`${name} HTTP ${r.status}`);e.retryable=[404,408,429].includes(r.status)||r.status>=500;throw e;}return r.text();}
 let last;
 for(let attempt=1;attempt<=6;attempt++){
  try{
   const remote=JSON.parse(await text('data/fairs.json',attempt));
   // A stale Pages edge may be serving the old release; retry only until exact expected bytes arrive.
   if(JSON.stringify(payload(remote))!==JSON.stringify(payload(local))){const e=new Error('Pages catalog does not yet match this publication');e.retryable=true;throw e;}
   for(const name of assetNames){if(await text(name,attempt)!==localAssets[name]){const e=new Error(`${name} has not propagated to Pages`);e.retryable=true;throw e;}}
   const result={verifiedAt:new Date().toISOString(),testedCommit:process.env.GITHUB_SHA||null,pageUrl:base.href,exactCatalogMatches:true,rendererAssetsMatch:true,chains:validateCatalog(remote,inventory)};
   if(value('--report'))await fs.writeFile(value('--report'),JSON.stringify(result,null,2)+'\n');
   console.log(JSON.stringify(result,null,2));return;
  }catch(e){last=e;console.warn(`Catalog verification ${attempt}: ${e.message}`);if(e.code==='ERR_ASSERTION'||e.retryable===false||attempt===6)throw e;await new Promise(r=>setTimeout(r,5000));}
 }
 throw last;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
