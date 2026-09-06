import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CHAIN_IDS, sourceHostAllowed } from './source-registry.mjs';

const NATIONAL = new Set(['sushiro','hamazushi','kurasushi','kappasushi','uobei']);
const GENERIC_FAIR = /^(?:フェア商品|期間限定メニュー|期間限定キャンペーン|開催中イベント|最新フェア確認中|季節のおすすめ|公式メニュー・おすすめ|取得エラー)$/;
const SUSPICIOUS_ITEM = /(?:^@|@[A-Za-z0-9_]{3,}|https?:\/\/|開催.*開催|公式アカウント|LINE公式)/i;
const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();
const norm = v => clean(v).replace(/[「」『』【】（）()\s・:：,，.。!！?？/／\\-]/g,'').toLowerCase();

function args(argv=process.argv.slice(2)) {
  const out={};
  for(let i=0;i<argv.length;i+=1){const key=argv[i];if(!key.startsWith('--'))continue;out[key.slice(2)]=argv[i+1]?.startsWith('--')?true:argv[++i]??true;}
  return out;
}
function issue(code,severity,message){return{code,severity,message};}
function activeItems(chain,today){return (chain?.items||[]).filter(x=>x?.saleStatus!=='ended'&&(!x?.endDate||x.endDate>=today));}
function activeCampaigns(chain,today){return (chain?.campaigns||[]).filter(x=>(!x?.startDate||x.startDate<=today)&&(!x?.endDate||x.endDate>=today));}
function sameCampaign(a,b){return norm(a?.fairName)&&norm(a?.fairName)===norm(b?.fairName);}
function usableLkg(chain,today){
  if(!chain)return false;
  if(chain.endDate&&chain.endDate<today)return false;
  if(activeItems(chain,today).length)return true;
  if((chain.menuHighlights||[]).length)return true;
  if(activeCampaigns(chain,today).length)return true;
  return !NATIONAL.has(chain.chain)&&chain.status==='warning'&&Boolean(chain.sourceUrl);
}
function sanitize(chain,today){
  const copy=structuredClone(chain);
  copy.items=(copy.items||[]).map(item=>item?.endDate&&item.endDate<today?{...item,saleStatus:'ended'}:item);
  if(copy.endDate&&copy.endDate<today){copy.status='warning';copy.campaignPhase='ended';}
  return copy;
}

export function inspectChain(candidate,previous,today=todayKey()){
  const issues=[];
  if(!candidate||typeof candidate!=='object')return[issue('missing_chain','error','chain row missing')];
  if(!CHAIN_IDS.includes(candidate.chain))issues.push(issue('unknown_chain','error',`unknown chain ${candidate.chain}`));
  if(!Array.isArray(candidate.items))issues.push(issue('items_not_array','error','items must be an array'));
  if(!clean(candidate.fairName))issues.push(issue('missing_fair_name','error','fairName missing'));
  if(candidate.sourceUrl&&!/^https:\/\//.test(candidate.sourceUrl))issues.push(issue('bad_source_url','error','sourceUrl must be https'));
  if(candidate.sourceUrl&&/^https:\/\//.test(candidate.sourceUrl)&&!sourceHostAllowed(candidate.sourceUrl))issues.push(issue('unregistered_source_host','warning',`source host is not in registry: ${candidate.sourceUrl}`));
  if(candidate.endDate&&candidate.endDate<today&&candidate.status==='ok')issues.push(issue('expired_chain_ok','error','expired chain cannot remain status=ok'));
  for(const item of candidate.items||[]){
    if(!clean(item?.name))issues.push(issue('empty_item_name','error','empty item name'));
    if(item?.endDate&&item.endDate<today&&item.saleStatus==='active')issues.push(issue('expired_item_active','error',`${item.name} is expired but active`));
    if(SUSPICIOUS_ITEM.test(clean(item?.name))&&item?.price==null)issues.push(issue('suspicious_item_name','error',`non-product text detected: ${item.name}`));
    if(item?.sourceUrl&&/^https:\/\//.test(item.sourceUrl)&&!sourceHostAllowed(item.sourceUrl))issues.push(issue('unregistered_item_source','warning',`item source host is not in registry: ${item.sourceUrl}`));
  }
  const nowItems=activeItems(candidate,today),oldItems=activeItems(previous,today);
  if(previous&&oldItems.length>0&&nowItems.length===0&&(!candidate.endDate||candidate.endDate>=today))issues.push(issue('active_items_dropped_to_zero','error',`active items dropped from ${oldItems.length} to 0`));
  if(previous&&oldItems.length>=5&&sameCampaign(candidate,previous)&&nowItems.length<Math.ceil(oldItems.length*0.25))issues.push(issue('same_campaign_large_drop','error',`same campaign item count dropped ${oldItems.length} -> ${nowItems.length}`));
  if(previous&&!GENERIC_FAIR.test(clean(previous.fairName))&&GENERIC_FAIR.test(clean(candidate.fairName))&&usableLkg(previous,today))issues.push(issue('regressed_to_generic_fair','error',`fair name regressed to generic label: ${candidate.fairName}`));
  if(candidate.chain==='musashimaru'&&!nowItems.length&&(candidate.menuHighlights||[]).length<2)issues.push(issue('musashimaru_no_verified_menu','error','Musashimaru requires verified menu highlights when product rows are fail-closed'));
  if(candidate.chain==='totomaru'&&!nowItems.length&&!(candidate.menuHighlights||[]).length)issues.push(issue('totomaru_no_menu_signal','error','Totomaru has neither product rows nor verified menu highlights'));
  return issues;
}

export function promoteCandidate(candidate,previous,today=todayKey()){
  assert.equal(candidate?.schemaVersion,2,'candidate schemaVersion must be 2');
  assert.equal(candidate?.timezone,'Asia/Tokyo','candidate timezone must be Asia/Tokyo');
  const c=Object.fromEntries((candidate.chains||[]).map(x=>[x.chain,x]));
  const p=Object.fromEntries((previous?.chains||[]).map(x=>[x.chain,x]));
  const selected=[];const fallbackChains=[];const quarantined=[];const warnings=[];
  for(const id of CHAIN_IDS){
    const row=c[id],old=p[id];
    const findings=inspectChain(row,old,today);
    const errors=findings.filter(x=>x.severity==='error');
    warnings.push(...findings.filter(x=>x.severity==='warning').map(x=>({chain:id,...x})));
    if(errors.length){
      quarantined.push({chain:id,issues:errors});
      if(!usableLkg(old,today))throw new Error(`Quality gate blocked ${id}: ${errors.map(x=>x.code).join(', ')}; no usable last-known-good row`);
      const fallback=sanitize(old,today);
      fallback.status='warning';
      fallback.qualityState='last_known_good';
      fallback.qualityCheckedAt=new Date().toISOString();
      fallback.qualityIssues=errors.map(x=>x.code);
      fallback.message=`今回の更新候補を品質ゲートで隔離し、前回確認済みデータを表示しています（${errors.map(x=>x.code).join(', ')}）。`;
      selected.push(fallback);fallbackChains.push(id);
    }else{
      const ok=sanitize(row,today);
      ok.qualityState=findings.length?'verified_with_warnings':'verified';
      ok.qualityCheckedAt=new Date().toISOString();
      if(findings.length)ok.qualityIssues=findings.map(x=>x.code);else delete ok.qualityIssues;
      selected.push(ok);
    }
  }
  const out={...candidate,chains:selected,qualityGate:{version:1,checkedAt:new Date().toISOString(),fallbackChains,quarantined,warnings}};
  return {data:out,report:out.qualityGate};
}

function selfTest(){
  const base=id=>({chain:id,fairName:`${id} current`,startDate:'2026-09-01',endDate:null,items:[{name:'商品A',price:110,startDate:'2026-09-01',endDate:null,saleStatus:'active',scrapeStatus:'ok',sourceUrl:'https://www.hamazushi.com/menu/'}],sourceUrl:'https://www.hamazushi.com/menu/',status:'ok',officialActionUrl:'https://www.hamazushi.com/',regionalModel:{strategyKey:'test'},group:NATIONAL.has(id)?'national':'local_tokai'});
  const previous={schemaVersion:2,timezone:'Asia/Tokyo',chains:CHAIN_IDS.map(base)};
  previous.chains.find(x=>x.chain==='musashimaru').items=[];previous.chains.find(x=>x.chain==='musashimaru').menuHighlights=[{name:'店内寿司',priceFrom:176},{name:'国産食材'}];
  previous.chains.find(x=>x.chain==='totomaru').menuHighlights=[{name:'旬ネタ'}];
  const candidate=structuredClone(previous);
  const u=candidate.chains.find(x=>x.chain==='uobei');u.items=[];u.status='warning';u.message='parser returned zero';
  const promoted=promoteCandidate(candidate,previous,'2026-09-06');
  assert.ok(promoted.report.fallbackChains.includes('uobei'));
  assert.equal(promoted.data.chains.find(x=>x.chain==='uobei').qualityState,'last_known_good');
  const bad=structuredClone(candidate);bad.chains.find(x=>x.chain==='uobei').items=[{name:'@official_account',price:null,saleStatus:'active',scrapeStatus:'ok'}];
  const again=promoteCandidate(bad,previous,'2026-09-06');assert.ok(again.report.fallbackChains.includes('uobei'));
  console.log('Quality gate self-tests passed.');
}

async function main(){
  const a=args();
  if(a['self-test'])return selfTest();
  if(!a.candidate)throw new Error('--candidate is required');
  const candidate=JSON.parse(await fs.readFile(a.candidate,'utf8'));
  const previous=JSON.parse(await fs.readFile(a.previous||a.candidate,'utf8'));
  const {data,report}=promoteCandidate(candidate,previous,a.today||todayKey());
  if(a['check-only']){console.log(JSON.stringify(report,null,2));return;}
  if(!a.out)throw new Error('--out is required unless --check-only is used');
  await fs.writeFile(a.out,`${JSON.stringify(data,null,2)}\n`);
  if(a.report)await fs.writeFile(a.report,`${JSON.stringify(report,null,2)}\n`);
  console.log(`Quality gate passed. LKG fallbacks: ${report.fallbackChains.join(', ')||'none'}`);
}

await main();
