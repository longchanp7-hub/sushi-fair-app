import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FAIR_PATH = path.join(ROOT, 'app', 'data', 'fairs.json');
const S = {
  hama: 'https://www.hamazushi.com/topics/2026/0831000844.html',
  kMain: 'https://prtimes.jp/main/html/rd/p/000001211.000018731.html',
  kAutumn: 'https://prtimes.jp/main/html/rd/p/000001213.000018731.html',
  kMoon: 'https://prtimes.jp/main/html/rd/p/000001214.000018731.html',
  uobei: 'https://prtimes.jp/main/html/rd/p/000000243.000020954.html',
  uobeiHero: 'https://prcdn.freetls.fastly.net/release_image/20954/243/20954-243-f4d244da98b9421a28f5fbd4f82cf5d1-600x600.png',
  kura: 'https://www.kurasushi.co.jp/author/008437.html',
  toku: 'https://www.nigirinotokubei.com/info/11244/',
  tokuCompany: 'https://www.atom-corp.co.jp/fair/fair.php?fair_no=3827',
};
const jstToday = (now = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const active = (today, start, end = null) => today >= start && (!end || today <= end);
const item = (name, price, start, end, sourceUrl) => ({ name, price, startDate:start, endDate:end, saleStatus:'active', scrapeStatus:'ok', sourceUrl });
const byChain = data => Object.fromEntries((data?.chains || []).map(c => [c.chain, c]));
const itemsFrom = (rows, start, end, source) => rows.map(([name, price]) => item(name, price, start, end, source));

const K_MAIN = [
  ['大ぶりとろサーモン',110],['大ぶりとろサーモン 塩炙り',150],['北海道産さんま',190],['北海道産さんま塩炙り',190],
  ['秋の彩りフェアプレート',590],['お値段そのまま50％増量 感動コーン',110],['お値段そのまま50％増量 えび天にぎり',150],
  ['お値段そのまま50％増量 てりやきハンバーグ',120],['お値段そのままトッピング50％増量 コク旨醤油ラーメン',430],['シャリドーナツ きな粉（3個）',110],
];
const K_AUTUMN = [
  ['大とろ',340],['大とろ塩炙り 柚子のせ',340],['贅沢いくらの茶碗蒸し',430],['北海道産 ほたて',240],['天然メアジ',240],['天然メアジ塩炙り',240],
  ['醤油漬け焼き風サーモン',190],['とろ〆さば',110],['3種の貝食べ比べ（つぶ貝・大切り蝦夷あわび・赤貝）',430],['合鴨ロース',120],
  ['合鴨ロース オニオンマヨ',150],['合鴨ロースのトリュフマヨのせ',190],['3種のトリュフマヨ寿司食べ比べ',290],['合鴨ロースサラダ',390],
  ['まいたけ天にぎり',150],['まいたけとかつお出汁餡の茶碗蒸し',340],['季節の天ぷら盛り合わせ“秋”～天つゆ付き～',540],['贅沢 大えび天入りうどん“秋”',540],
  ['紅茶ゼリー～バニラアイス添え～',340],['紅茶ゼリー～ホイップ添え～',340],['秋色プレミアムプリンパフェ 醤油キャラメルアイス仕立て',490],
];
const K_MOON = [
  ['月見牛肉いなり',190],['卵黄とろろ軍艦',150],['卵黄納豆軍艦',150],['かっぱのシャリドーナツ きなこ（2個）',110],
  ['かっぱのシャリドーナツ キャラメルシナモン（2個）',110],['ふわもちみたらし団子',190],
];
const UOBEI = [
  ['赤魚',110],['かつおたたき',110],['こういかげそ',132],['瀬戸内産茹で牡蠣',198],['紅鮭すじこ',198],['うにいかぐんかん',198],
  ['プレミアム蒸しえび',308],['とろびん長はらも',165],['本鮪大とろ',308],['お得！まぐろ三昧',451],['混ぜて食べるマスカットパフェ',418],['苺のクランブルタルト',264],
];
const KURA = [
  ['厳選かに軍艦（一貫）',110,'2026-09-13'],['北海道サーモン',270,'2026-09-13'],['〖北海道産〗秋刀魚',160,'2026-10-01'],
  ['〖北海道産〗たこ柔らか煮',180,'2026-09-13'],['生ずわいがに（一貫）',350,'2026-09-13'],['スパイシーサーモンマヨ',140,'2026-09-13'],
  ['あぶりチーズドリア風',120,'2026-09-13'],['超熟成 金目鯛（一貫）',110,'2026-09-27'],
];
const TOKU = [
  ['秋の特選五貫盛り',1155],['生サーモン食べ比べ三昧',649],['生サーモン',407],['生サーモン味噌炙り',451],['生サーモンごまぽん漬け',451],
  ['さんま食べ比べ三昧',649],['さんま',407],['さんま炙り',451],['さんま天',451],['かつおのたたき ぬたのせ',407],['土佐巻き',407],['姫丼 漬けかつお',407],
  ['さばガリロール',341],['焼き鯖の押し寿司',451],['まいたけ天',253],['揚げなす肉みそのせ',253],['サーモン塩麹軍艦',198],['大紋（おおもん）はた',649],
  ['あまごの姿揚げ',539],['秋の茶碗蒸し',429],['秋の天ぷら盛り合わせ',649],['鮭と舞茸のあんかけだし巻き玉子',605],['鮭豚汁（しゃけとんじる）',407],
];

export function applyVerifiedCurrentOfficialCampaigns(data, today = jstToday()) {
  const c = byChain(data), changed = [];
  if (c.hamazushi && today >= '2026-09-01' && (c.hamazushi.items || []).some(x => /九州産.*あじのたたき.*大葉つつみ/.test(x?.name || ''))) {
    Object.assign(c.hamazushi, { fairName:'はま寿司のにっぽん旨ねた祭り 第2弾', startDate:'2026-09-01', endDate:null, officialCampaignTitle:'はま寿司のにっぽん旨ねた祭り 第2弾', officialCampaignUrl:S.hama, fairNameSource:'official_topic_page', status:'ok', message:null, campaignPhase:'active' });
    changed.push('hamazushi');
  }
  if (c.kappasushi && active(today, '2026-09-03', '2026-09-30')) {
    const main = itemsFrom(K_MAIN,'2026-09-03','2026-09-16',S.kMain), autumn = itemsFrom(K_AUTUMN,'2026-09-03',null,S.kAutumn), moon = itemsFrom(K_MOON,'2026-09-03','2026-09-30',S.kMoon);
    Object.assign(c.kappasushi, { fairName:'かっぱの秋の旨ネタ＆50％増量祭り／秋のおすすめ／お月見祭り', startDate:'2026-09-03', endDate:'2026-09-30', items:[...main,...autumn,...moon], sourceUrl:'https://www.kappasushi.jp/campaign_list/', officialReleaseUrl:S.kMain, status:'ok', message:null, campaignPhase:'active', dataScope:'national_verified_official_campaigns', priceNote:'公式発表の税込価格です。一部店舗では価格が異なる場合があります。', campaigns:[{fairName:'かっぱの秋の旨ネタ＆お値段そのまま50％増量祭り',startDate:'2026-09-03',endDate:'2026-09-16',sourceUrl:S.kMain,items:main},{fairName:'かっぱの秋のおすすめ',startDate:'2026-09-03',endDate:null,sourceUrl:S.kAutumn,items:autumn},{fairName:'かっぱのお月見祭り',startDate:'2026-09-03',endDate:'2026-09-30',sourceUrl:S.kMoon,items:moon}] });
    changed.push('kappasushi');
  }
  if (c.uobei && active(today, '2026-08-25', '2026-09-30')) {
    Object.assign(c.uobei, { fairName:'秋の味覚フェア', startDate:'2026-08-25', endDate:null, items:itemsFrom(UOBEI,'2026-08-25',null,S.uobei), sourceUrl:'https://www.uobei.info/menu/', officialReleaseUrl:S.uobei, status:'ok', message:null, campaignPhase:'active', dataScope:'national_verified_official_release', priceNote:'公式発表の税込価格です。地域・店舗により価格が異なる場合があります。', imageUrl:S.uobeiHero, representativeImageUrl:S.uobeiHero, representativeImageSource:'official_food_or_fair_image', representativeImageProduct:'本鮪大とろ', representativeImagePage:S.uobei });
    changed.push('uobei');
  }
  if (c.kurasushi && active(today, '2026-09-04', '2026-09-13')) {
    Object.assign(c.kurasushi, { fairName:'北海フェア', startDate:'2026-09-04', endDate:'2026-09-13', items:KURA.map(([n,p,e]) => item(n,p,'2026-09-04',e,S.kura)), sourceUrl:S.kura, officialReleaseUrl:S.kura, status:'ok', message:null, campaignPhase:'active', dataScope:'national_verified_official_release', priceNote:'くら寿司公式プレスリリース掲載価格です。店舗により価格や取扱いが異なる場合があります。' });
    changed.push('kurasushi');
  }
  if (c.tokubei && active(today, '2026-09-01', '2026-11-03') && /生サーモン.*さんま.*かつお|秋の味覚祭り/.test(c.tokubei.fairName || '')) {
    const items = itemsFrom(TOKU,'2026-09-01','2026-11-03',S.tokuCompany);
    Object.assign(c.tokubei, { fairName:'生サーモン・さんま・かつお 秋の味覚祭り', startDate:'2026-09-01', endDate:'2026-11-03', items, status:'ok', message:null, dataScope:'local_verified_official_campaign', officialReleaseUrl:S.toku, productSourceUrl:S.tokuCompany, companyReleaseUrl:S.tokuCompany, priceNote:'にぎりの徳兵衛公式・運営会社公式発表の税込価格です。一部店舗では価格が異なります。' });
    c.tokubei.campaigns = [{ fairName:c.tokubei.fairName, startDate:c.tokubei.startDate, endDate:c.tokubei.endDate, items, sourceUrl:S.toku, imageUrl:c.tokubei.imageUrl || c.tokubei.representativeImageUrl || null, verified:true }, ...(Array.isArray(c.tokubei.campaigns) ? c.tokubei.campaigns.filter(x => x?.sourceUrl !== S.toku) : [])];
    changed.push('tokubei');
  }
  data.chains = (data.chains || []).map(x => c[x.chain] || x);
  return changed;
}

function validate(data, today = jstToday()) {
  if (today !== '2026-09-04') return;
  const c = byChain(data);
  assert.equal(c.hamazushi?.fairName,'はま寿司のにっぽん旨ねた祭り 第2弾');
  assert.ok((c.kappasushi?.items || []).length >= 30);
  assert.equal(c.uobei?.fairName,'秋の味覚フェア');
  assert.equal((c.uobei?.items || []).length,12);
  assert.equal(c.uobei?.representativeImagePage,S.uobei);
  assert.match(c.uobei?.representativeImageUrl || '',/\/20954\/243\//);
  assert.equal(c.kurasushi?.campaignPhase,'active');
  assert.equal((c.kurasushi?.items || []).length,8);
  assert.equal((c.tokubei?.items || []).length,23);
}

function selfTest() {
  const data = { chains:[{chain:'hamazushi',fairName:'期間限定メニュー',items:[{name:'九州産あじのたたき大葉つつみ',price:110}]},{chain:'kappasushi',items:[]},{chain:'uobei',fairName:'豪華ネタフェア',items:[],representativeImagePage:'https://prtimes.jp/main/html/rd/p/000000240.000020954.html'},{chain:'kurasushi',fairName:'北海フェア',items:[],campaignPhase:'upcoming'},{chain:'tokubei',fairName:'生サーモン・さんま・かつお 秋の味覚祭り',items:[]}] };
  assert.deepEqual(applyVerifiedCurrentOfficialCampaigns(data,'2026-09-04'),['hamazushi','kappasushi','uobei','kurasushi','tokubei']);
  validate(data,'2026-09-04');
  assert.equal(byChain(data).tokubei.items.find(x => x.name === '鮭豚汁（しゃけとんじる）')?.price,407);
  assert.equal(byChain(data).kappasushi.items.find(x => x.name === '月見牛肉いなり')?.price,190);
  console.log('Verified current official campaign override self-tests passed.');
}

async function main() {
  const data = JSON.parse(await fs.readFile(FAIR_PATH,'utf8')), today = jstToday();
  const changed = applyVerifiedCurrentOfficialCampaigns(data,today);
  validate(data,today);
  if (!changed.length) return console.log('No verified current official campaign override matched.');
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(FAIR_PATH,`${JSON.stringify(data,null,2)}\n`);
  console.log(`Applied verified current official campaigns: ${changed.join(', ')}`);
}
if (process.argv.includes('--self-test')) selfTest(); else await main();
