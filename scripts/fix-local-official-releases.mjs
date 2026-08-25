import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const RELEASE={
  chain:'tokubei',
  match:/北海道産さんま|秋の味覚.*さんま/,
  startDate:'2026-08-18',
  endDate:'2026-11-03',
  officialReleaseUrl:'https://origin.digitalpr.jp/r/141163',
  items:[
    ['さんま食べ比べ三貫',649],
    ['さんま',407],
    ['さんま炙り',451],
    ['さんま天',459]
  ]
};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const makeItem=([name,price])=>({name,price,startDate:RELEASE.startDate,endDate:RELEASE.endDate,saleStatus:'active',scrapeStatus:'ok'});

export function applyOfficialRelease(data,now=today()){
  const fair=(data?.chains||[]).find(x=>x.chain===RELEASE.chain);
  if(!fair||!RELEASE.match.test(fair.fairName||''))return false;
  if(now<RELEASE.startDate||now>RELEASE.endDate)return false;
  fair.startDate=RELEASE.startDate;
  fair.endDate=RELEASE.endDate;
  fair.items=RELEASE.items.map(makeItem);
  fair.status='ok';
  fair.message=null;
  fair.dataScope='local_official_company_release';
  fair.officialReleaseUrl=RELEASE.officialReleaseUrl;
  fair.productSourceUrl=RELEASE.officialReleaseUrl;
  fair.priceNote='株式会社アトムの公式発表掲載価格です。一部店舗では価格が異なります。';
  // A site-wide OG/logo must never be presented as the campaign hero.
  if(fair.imageUrl&&/\/img\/cmn\/og\.png(?:\?|$)/i.test(fair.imageUrl))fair.imageUrl=null;
  return true;
}

if(process.argv.includes('--self-test')){
  const d={chains:[{chain:'tokubei',fairName:'秋の味覚、解禁！北海道産さんまのお寿司を食べ比べ！',items:[]}]};
  if(!applyOfficialRelease(d,'2026-08-25'))throw new Error('official release should apply');
  const f=d.chains[0];
  if(f.items.length!==4||f.items.find(x=>x.name==='さんま天')?.price!==459)throw new Error('Tokubei official price regression');
  if(f.items.find(x=>x.name==='さんま')?.price!==407)throw new Error('Tokubei sanma price regression');
  console.log('Local official release self-tests passed.');
}else{
  const data=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));
  if(applyOfficialRelease(data)){
    await fs.writeFile(FAIR_PATH,JSON.stringify(data,null,2)+'\n');
    console.log('Applied Tokubei official company release prices.');
  }else console.log('No current local official release override matched.');
}
