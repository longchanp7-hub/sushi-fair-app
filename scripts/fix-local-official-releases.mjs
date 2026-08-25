import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const FAIR_PATH=path.join(ROOT,'app','data','fairs.json');
const RELEASE={
  chain:'tokubei',match:/北海道産さんま|秋の味覚.*さんま/,startDate:'2026-08-18',endDate:'2026-11-03',
  officialReleaseUrl:'https://www.nigirinotokubei.com/info/11195/',companyReleaseUrl:'https://origin.digitalpr.jp/r/141163',
  imageUrl:'https://www.nigirinotokubei.com/wp/wp-content/uploads/93916721a52ef0667d19c1a4b1ab12f8.jpg',
  items:[['さんま食べ比べ三貫',649],['さんま',407],['さんま炙り',451],['さんま天',451]]
};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const makeItem=([name,price])=>({name,price,startDate:RELEASE.startDate,endDate:RELEASE.endDate,saleStatus:'active',scrapeStatus:'ok',sourceUrl:RELEASE.officialReleaseUrl});
export function applyOfficialRelease(data,now=today()){
  const fair=(data?.chains||[]).find(x=>x.chain===RELEASE.chain);if(!fair||!RELEASE.match.test(fair.fairName||''))return false;if(now<RELEASE.startDate||now>RELEASE.endDate)return false;
  const items=RELEASE.items.map(makeItem);fair.startDate=RELEASE.startDate;fair.endDate=RELEASE.endDate;fair.items=items;fair.status='ok';fair.message=null;fair.dataScope='local_official_brand_release';fair.officialReleaseUrl=RELEASE.officialReleaseUrl;fair.productSourceUrl=RELEASE.officialReleaseUrl;fair.companyReleaseUrl=RELEASE.companyReleaseUrl;fair.imageUrl=RELEASE.imageUrl;fair.representativeImageUrl=RELEASE.imageUrl;fair.representativeImageSource='official_brand_campaign_image';fair.representativeImageProduct='さんま食べ比べ三貫';fair.representativeImagePage=RELEASE.officialReleaseUrl;fair.priceNote='にぎりの徳兵衛公式ページ・公式フェア画像の税込価格です。一部店舗では価格が異なります。';
  const verified={fairName:fair.fairName,startDate:RELEASE.startDate,endDate:RELEASE.endDate,items,sourceUrl:RELEASE.officialReleaseUrl,imageUrl:RELEASE.imageUrl,verified:true};
  const campaigns=Array.isArray(fair.campaigns)?fair.campaigns:[];fair.campaigns=[verified,...campaigns.filter(c=>c?.sourceUrl!==RELEASE.officialReleaseUrl&&!(RELEASE.match.test(c?.fairName||'')&&c?.startDate===RELEASE.startDate))];
  return true;
}
if(process.argv.includes('--self-test')){const d={chains:[{chain:'tokubei',fairName:'秋の味覚、解禁！北海道産さんまのお寿司を食べ比べ！',items:[],campaigns:[{fairName:'別の同時開催フェア',sourceUrl:'https://example.test/other',items:[]}]}]};if(!applyOfficialRelease(d,'2026-08-25'))throw new Error('official release should apply');const f=d.chains[0];if(f.items.length!==4||f.items.find(x=>x.name==='さんま天')?.price!==451)throw new Error('Tokubei official price regression');if(f.items.find(x=>x.name==='さんま')?.price!==407)throw new Error('Tokubei sanma price regression');if(f.productSourceUrl!==RELEASE.officialReleaseUrl||f.representativeImageUrl!==RELEASE.imageUrl)throw new Error('Tokubei official source/image regression');if(f.campaigns.length!==2||!f.campaigns.some(c=>c.fairName==='別の同時開催フェア'))throw new Error('Tokubei concurrent campaign regression');console.log('Local official release self-tests passed.');}
else{const data=JSON.parse(await fs.readFile(FAIR_PATH,'utf8'));if(applyOfficialRelease(data)){await fs.writeFile(FAIR_PATH,JSON.stringify(data,null,2)+'\n');console.log('Applied Tokubei verified brand-official campaign data.');}else console.log('No current local official release override matched.');}
