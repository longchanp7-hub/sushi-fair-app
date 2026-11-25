import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const FAIR=path.join(ROOT,'app/data/fairs.json');
const PUBLISHED='https://digitalpr.jp/pdf.php?r=147401';
const NOTICE='https://www.nigirinotokubei.com/info/11410';
const START='2026-11-10', END='2027-01-11';

// 2026-11-02 corporate press release, page 2: all 19 product names and
// tax-inclusive prices for the active winter fair. Scope to this exact edition.
export const ITEMS=[
  ['冬の特選五貫盛り',1100],
  ['ぶり食べ比べ三昧',649],
  ['ぶり',407],
  ['ぶりのりゅうきゅう',451],
  ['ぶりしゃぶ',451],
  ['蒸しがき',407],
  ['きんき塩〆',649],
  ['八角（はっかく）',539],
  ['蒸しほたて',539],
  ['アブラカレイ',341],
  ['水だこ',341],
  ['白菜漬け',253],
  ['かき松前焼き',759],
  ['冬の三宝茶碗蒸し',539],
  ['鴨そば',649],
  ['かに餡かけだし巻き玉子',616],
  ['かにクリームコロッケ',539],
  ['赤かれいの唐揚げ',341],
  ['赤かれいの骨せんべい',143],
];

const todayJst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function reconcileTokubeiOfficial(data,today=todayJst()){
 const chain=data.chains?.find(c=>c.chain==='tokubei');
 if(!chain||chain.campaignCoverage?.state!=='complete'||!Array.isArray(chain.campaignCatalog))
   return {promoted:false,reason:'official_index_not_verified'};
 const announced=chain.campaignCatalog.find(c=>
   c.sourceUrl===NOTICE&&c.category==='fair'&&c.metadataStatus==='parsed'
   &&!c.retainedFromPrevious&&/ぶりと北海祭り/.test(c.fairName||'')
   &&c.startDate===START&&c.endDate===END);
 if(!announced||today<START||today>END)
   return {promoted:false,reason:'current_official_campaign_not_confirmed'};
 if(ITEMS.length!==19||new Set(ITEMS.map(x=>x[0])).size!==19||
    !ITEMS.every(([name,price])=>name&&Number.isInteger(price)&&price>0))
   throw new Error('Manufacturer item list integrity failed');
 const rows=ITEMS.map(([name,price])=>({
   name,price,priceType:'listed',startDate:START,endDate:END,
   sourceUrl:PUBLISHED,saleStatus:'active',scrapeStatus:'ok',
 }));
 announced.items=structuredClone(rows);
 announced.itemStatus='parsed';
 chain.items=structuredClone(rows);
 chain.status='ok';
 chain.message=null;
 chain.priceNote='2026年11月2日発表のコロワイドグループ・アトム公式資料による税込価格。対象店舗・品切れ・価格変更は公式情報で確認してください。';
 chain.officialCampaignUrl=NOTICE;
 return {promoted:true,items:rows.length,source:PUBLISHED};
}

function selfTest(){
 const make=()=>({chains:[{chain:'tokubei',items:[],campaignCoverage:{state:'complete'},campaignCatalog:[
  {sourceUrl:NOTICE,category:'fair',metadataStatus:'parsed',fairName:'ぶりと北海祭り',
   startDate:START,endDate:END,items:[],itemStatus:'unavailable'}]}]});
 const sample=make(),result=reconcileTokubeiOfficial(sample,'2026-11-25');
 assert.equal(result.promoted,true);assert.equal(result.items,19);
 const c=sample.chains[0];assert.equal(c.items.length,19);
 assert.equal(c.campaignCatalog[0].itemStatus,'parsed');
 assert.equal(c.items.find(i=>i.name==='蒸しがき')?.price,407);
 assert.equal(c.items.find(i=>i.name==='冬の特選五貫盛り')?.price,1100);
 assert.ok(c.items.every(i=>i.sourceUrl===PUBLISHED&&i.saleStatus==='active'));
 const early=make();assert.equal(reconcileTokubeiOfficial(early,'2026-11-09').promoted,false);
 const expired=make();assert.equal(reconcileTokubeiOfficial(expired,'2027-01-12').promoted,false);
 const incomplete=make();incomplete.chains[0].campaignCoverage.state='partial';
 assert.equal(reconcileTokubeiOfficial(incomplete,'2026-11-25').promoted,false);
 const missing=make();missing.chains[0].campaignCatalog[0].sourceUrl='https://example.com/fake';
 assert.equal(reconcileTokubeiOfficial(missing,'2026-11-25').promoted,false);
 const stale=make();stale.chains[0].campaignCatalog[0].retainedFromPrevious=true;
 assert.equal(reconcileTokubeiOfficial(stale,'2026-11-25').promoted,false);
 console.log('Tokubei manufacturer-verified 19-item coverage and fail-closed self-tests passed');
}

export async function main(argv=process.argv.slice(2)){
 if(argv.includes('--self-test'))return selfTest();
 const data=JSON.parse(await fs.readFile(FAIR,'utf8'));
 const result=reconcileTokubeiOfficial(data,argv.includes('--today')?argv[argv.indexOf('--today')+1]:todayJst());
 await fs.writeFile(FAIR,JSON.stringify(data,null,2)+'\n');
 console.log('Tokubei official product reconciliation: '+JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
