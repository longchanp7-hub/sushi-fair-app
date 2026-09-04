import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FAIR_PATH = path.join(ROOT, 'app', 'data', 'fairs.json');

const SOURCES = {
  hamazushi: 'https://www.hamazushi.com/topics/2026/0831000844.html',
  kappasushiMain: 'https://prtimes.jp/main/html/rd/p/000001211.000018731.html',
  kappasushiAutumn: 'https://prtimes.jp/main/html/rd/p/000001213.000018731.html',
  kappasushiMoon: 'https://prtimes.jp/main/html/rd/p/000001214.000018731.html',
  uobei: 'https://prtimes.jp/main/html/rd/p/000000243.000020954.html',
  kurasushi: 'https://www.kurasushi.co.jp/author/008437.html',
  tokubei: 'https://www.nigirinotokubei.com/info/11244/',
  tokubeiCompany: 'https://www.atom-corp.co.jp/fair/fair.php?fair_no=3827',
};

function jstTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function active(today, startDate, endDate = null) {
  return today >= startDate && (!endDate || today <= endDate);
}

function makeItem(name, price, startDate, endDate, sourceUrl) {
  return {
    name, price, startDate, endDate,
    saleStatus: 'active',
    scrapeStatus: 'ok',
    sourceUrl,
  };
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${String(item.name || '').replace(/\s+/g, '')}|${item.price}`;
    if (!item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chainMap(data) {
  return Object.fromEntries((data?.chains || []).map(chain => [chain.chain, chain]));
}

function applyHamazushi(byChain, today) {
  const fair = byChain.hamazushi;
  if (!fair || today < '2026-09-01') return false;
  const currentMenuSignature = (fair.items || []).some(item => /九州産.*あじのたたき.*大葉つつみ/.test(item?.name || ''));
  if (!currentMenuSignature) return false;
  fair.fairName = 'はま寿司のにっぽん旨ねた祭り 第2弾';
  fair.startDate = '2026-09-01';
  fair.endDate = null;
  fair.officialCampaignTitle = 'はま寿司のにっぽん旨ねた祭り 第2弾';
  fair.officialCampaignUrl = SOURCES.hamazushi;
  fair.fairNameSource = 'official_topic_page';
  fair.status = 'ok';
  fair.message = null;
  fair.campaignPhase = 'active';
  return true;
}

const KAPPA_MAIN = [
  ['大ぶりとろサーモン', 110],
  ['大ぶりとろサーモン 塩炙り', 150],
  ['北海道産さんま', 190],
  ['北海道産さんま塩炙り', 190],
  ['秋の彩りフェアプレート', 590],
  ['お値段そのまま50％増量 感動コーン', 110],
  ['お値段そのまま50％増量 えび天にぎり', 150],
  ['お値段そのまま50％増量 てりやきハンバーグ', 120],
  ['お値段そのままトッピング50％増量 コク旨醤油ラーメン', 430],
  ['シャリドーナツ きな粉（3個）', 110],
];

const KAPPA_AUTUMN = [
  ['大とろ', 340],
  ['大とろ塩炙り 柚子のせ', 340],
  ['贅沢いくらの茶碗蒸し', 430],
  ['北海道産 ほたて', 240],
  ['天然メアジ', 240],
  ['天然メアジ塩炙り', 240],
  ['醤油漬け焼き風サーモン', 190],
  ['とろ〆さば', 110],
  ['3種の貝食べ比べ（つぶ貝・大切り蝦夷あわび・赤貝）', 430],
  ['合鴨ロース', 120],
  ['合鴨ロース オニオンマヨ', 150],
  ['合鴨ロースのトリュフマヨのせ', 190],
  ['3種のトリュフマヨ寿司食べ比べ', 290],
  ['合鴨ロースサラダ', 390],
  ['まいたけ天にぎり', 150],
  ['まいたけとかつお出汁餡の茶碗蒸し', 340],
  ['季節の天ぷら盛り合わせ“秋”～天つゆ付き～', 540],
  ['贅沢 大えび天入りうどん“秋”', 540],
  ['紅茶ゼリー～バニラアイス添え～', 340],
  ['紅茶ゼリー～ホイップ添え～', 340],
  ['秋色プレミアムプリンパフェ 醤油キャラメルアイス仕立て', 490],
];

const KAPPA_MOON = [
  ['月見牛肉いなり', 190],
  ['卵黄とろろ軍艦', 150],
  ['卵黄納豆軍艦', 150],
  ['かっぱのシャリドーナツ きなこ（2個）', 110],
  ['かっぱのシャリドーナツ キャラメルシナモン（2個）', 110],
  ['ふわもちみたらし団子', 190],
];

function applyKappasushi(byChain, today) {
  const fair = byChain.kappasushi;
  if (!fair || !active(today, '2026-09-03', '2026-09-30')) return false;

  const mainItems = KAPPA_MAIN.map(([name, price]) =>
    makeItem(name, price, '2026-09-03', '2026-09-16', SOURCES.kappasushiMain));
  const autumnItems = KAPPA_AUTUMN.map(([name, price]) =>
    makeItem(name, price, '2026-09-03', null, SOURCES.kappasushiAutumn));
  const moonItems = KAPPA_MOON.map(([name, price]) =>
    makeItem(name, price, '2026-09-03', '2026-09-30', SOURCES.kappasushiMoon));

  fair.fairName = 'かっぱの秋の旨ネタ＆50％増量祭り／秋のおすすめ／お月見祭り';
  fair.startDate = '2026-09-03';
  fair.endDate = '2026-09-30';
  fair.items = uniqueItems([...mainItems, ...autumnItems, ...moonItems]);
  fair.sourceUrl = 'https://www.kappasushi.jp/campaign_list/';
  fair.officialReleaseUrl = SOURCES.kappasushiMain;
  fair.status = 'ok';
  fair.message = null;
  fair.campaignPhase = 'active';
  fair.dataScope = 'national_verified_official_campaigns';
  fair.priceNote = '公式発表の税込価格です。一部店舗では価格が異なる場合があります。';
  fair.campaigns = [
    {
      fairName: 'かっぱの秋の旨ネタ＆お値段そのまま50％増量祭り',
      startDate: '2026-09-03', endDate: '2026-09-16',
      sourceUrl: SOURCES.kappasushiMain, items: mainItems,
    },
    {
      fairName: 'かっぱの秋のおすすめ',
      startDate: '2026-09-03', endDate: null,
      sourceUrl: SOURCES.kappasushiAutumn, items: autumnItems,
    },
    {
      fairName: 'かっぱのお月見祭り',
      startDate: '2026-09-03', endDate: '2026-09-30',
      sourceUrl: SOURCES.kappasushiMoon, items: moonItems,
    },
  ];
  return true;
}

const UOBEI = [
  ['赤魚', 110],
  ['かつおたたき', 110],
  ['こういかげそ', 132],
  ['瀬戸内産茹で牡蠣', 198],
  ['紅鮭すじこ', 198],
  ['うにいかぐんかん', 198],
  ['プレミアム蒸しえび', 308],
  ['とろびん長はらも', 165],
  ['本鮪大とろ', 308],
  ['お得！まぐろ三昧', 451],
  ['混ぜて食べるマスカットパフェ', 418],
  ['苺のクランブルタルト', 264],
];

function applyUobei(byChain, today) {
  const fair = byChain.uobei;
  if (!fair || !active(today, '2026-08-25', '2026-09-30')) return false;
  fair.fairName = '秋の味覚フェア';
  fair.startDate = '2026-08-25';
  fair.endDate = null;
  fair.items = UOBEI.map(([name, price]) =>
    makeItem(name, price, '2026-08-25', null, SOURCES.uobei));
  fair.sourceUrl = 'https://www.uobei.info/menu/';
  fair.officialReleaseUrl = SOURCES.uobei;
  fair.status = 'ok';
  fair.message = null;
  fair.campaignPhase = 'active';
  fair.dataScope = 'national_verified_official_release';
  fair.priceNote = '公式発表の税込価格です。地域・店舗により価格が異なる場合があります。';
  return true;
}

const KURA = [
  ['厳選かに軍艦（一貫）', 110, '2026-09-13'],
  ['北海道サーモン', 270, '2026-09-13'],
  ['〖北海道産〗秋刀魚', 160, '2026-10-01'],
  ['〖北海道産〗たこ柔らか煮', 180, '2026-09-13'],
  ['生ずわいがに（一貫）', 350, '2026-09-13'],
  ['スパイシーサーモンマヨ', 140, '2026-09-13'],
  ['あぶりチーズドリア風', 120, '2026-09-13'],
  ['超熟成 金目鯛（一貫）', 110, '2026-09-27'],
];

function applyKurasushi(byChain, today) {
  const fair = byChain.kurasushi;
  if (!fair || !active(today, '2026-09-04', '2026-09-13')) return false;
  fair.fairName = '北海フェア';
  fair.startDate = '2026-09-04';
  fair.endDate = '2026-09-13';
  fair.items = KURA.map(([name, price, endDate]) =>
    makeItem(name, price, '2026-09-04', endDate, SOURCES.kurasushi));
  fair.sourceUrl = SOURCES.kurasushi;
  fair.officialReleaseUrl = SOURCES.kurasushi;
  fair.status = 'ok';
  fair.message = null;
  fair.campaignPhase = 'active';
  fair.dataScope = 'national_verified_official_release';
  fair.priceNote = 'くら寿司公式プレスリリース掲載価格です。店舗により価格や取扱いが異なる場合があります。';
  return true;
}

const TOKUBEI = [
  ['秋の特選五貫盛り', 1155],
  ['生サーモン食べ比べ三昧', 649],
  ['生サーモン', 407],
  ['生サーモン味噌炙り', 451],
  ['生サーモンごまぽん漬け', 451],
  ['さんま食べ比べ三昧', 649],
  ['さんま', 407],
  ['さんま炙り', 451],
  ['さんま天', 451],
  ['かつおのたたき ぬたのせ', 407],
  ['土佐巻き', 407],
  ['姫丼 漬けかつお', 407],
  ['さばガリロール', 341],
  ['焼き鯖の押し寿司', 451],
  ['まいたけ天', 253],
  ['揚げなす肉みそのせ', 253],
  ['サーモン塩麹軍艦', 198],
  ['大紋（おおもん）はた', 649],
  ['あまごの姿揚げ', 539],
  ['秋の茶碗蒸し', 429],
  ['秋の天ぷら盛り合わせ', 649],
  ['鮭と舞茸のあんかけだし巻き玉子', 605],
  ['鮭豚汁（しゃけとんじる）', 407],
];

function applyTokubei(byChain, today) {
  const fair = byChain.tokubei;
  if (!fair || !active(today, '2026-09-01', '2026-11-03')) return false;
  if (!/生サーモン.*さんま.*かつお|秋の味覚祭り/.test(fair.fairName || '')) return false;
  const items = TOKUBEI.map(([name, price]) =>
    makeItem(name, price, '2026-09-01', '2026-11-03', SOURCES.tokubeiCompany));
  fair.fairName = '生サーモン・さんま・かつお 秋の味覚祭り';
  fair.startDate = '2026-09-01';
  fair.endDate = '2026-11-03';
  fair.items = items;
  fair.status = 'ok';
  fair.message = null;
  fair.dataScope = 'local_verified_official_campaign';
  fair.officialReleaseUrl = SOURCES.tokubei;
  fair.productSourceUrl = SOURCES.tokubeiCompany;
  fair.companyReleaseUrl = SOURCES.tokubeiCompany;
  fair.priceNote = 'にぎりの徳兵衛公式・運営会社公式発表の税込価格です。一部店舗では価格が異なります。';
  fair.campaigns = [
    {
      fairName: fair.fairName,
      startDate: fair.startDate,
      endDate: fair.endDate,
      items,
      sourceUrl: SOURCES.tokubei,
      imageUrl: fair.imageUrl || fair.representativeImageUrl || null,
      verified: true,
    },
    ...(Array.isArray(fair.campaigns) ? fair.campaigns.filter(c => c?.sourceUrl !== SOURCES.tokubei) : []),
  ];
  return true;
}

export function applyVerifiedCurrentOfficialCampaigns(data, now = jstTodayKey()) {
  const byChain = chainMap(data);
  const changed = [];
  if (applyHamazushi(byChain, now)) changed.push('hamazushi');
  if (applyKappasushi(byChain, now)) changed.push('kappasushi');
  if (applyUobei(byChain, now)) changed.push('uobei');
  if (applyKurasushi(byChain, now)) changed.push('kurasushi');
  if (applyTokubei(byChain, now)) changed.push('tokubei');
  data.chains = (data.chains || []).map(chain => byChain[chain.chain] || chain);
  return changed;
}

function validate(data, today = jstTodayKey()) {
  const byChain = chainMap(data);
  if (today === '2026-09-04') {
    assert.equal(byChain.hamazushi?.fairName, 'はま寿司のにっぽん旨ねた祭り 第2弾');
    assert.equal(byChain.kappasushi?.status, 'ok');
    assert.ok((byChain.kappasushi?.items || []).length >= 30);
    assert.equal(byChain.uobei?.fairName, '秋の味覚フェア');
    assert.equal((byChain.uobei?.items || []).length, 12);
    assert.equal(byChain.kurasushi?.campaignPhase, 'active');
    assert.equal((byChain.kurasushi?.items || []).length, 8);
    assert.equal((byChain.tokubei?.items || []).length, 23);
  }
}

function selfTest() {
  const data = {
    chains: [
      { chain: 'hamazushi', fairName: '期間限定メニュー', items: [{ name: '九州産あじのたたき大葉つつみ', price: 110 }] },
      { chain: 'kappasushi', fairName: '期間限定', items: [] },
      { chain: 'uobei', fairName: '豪華ネタフェア', items: [] },
      { chain: 'kurasushi', fairName: '北海フェア', items: [{ name: '秋刀魚', price: 160 }], campaignPhase: 'upcoming' },
      { chain: 'tokubei', fairName: '生サーモン・さんま・かつお 秋の味覚祭り', items: [] },
    ],
  };
  const changed = applyVerifiedCurrentOfficialCampaigns(data, '2026-09-04');
  assert.deepEqual(changed, ['hamazushi', 'kappasushi', 'uobei', 'kurasushi', 'tokubei']);
  validate(data, '2026-09-04');
  assert.equal(chainMap(data).tokubei.items.find(item => item.name === '鮭豚汁（しゃけとんじる）')?.price, 407);
  assert.equal(chainMap(data).kappasushi.items.find(item => item.name === '月見牛肉いなり')?.price, 190);
  console.log('Verified current official campaign override self-tests passed.');
}

async function main() {
  const data = JSON.parse(await fs.readFile(FAIR_PATH, 'utf8'));
  const today = jstTodayKey();
  const changed = applyVerifiedCurrentOfficialCampaigns(data, today);
  validate(data, today);
  if (!changed.length) {
    console.log('No verified current official campaign override matched.');
    return;
  }
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(FAIR_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Applied verified current official campaigns: ${changed.join(', ')}`);
}

if (process.argv.includes('--self-test')) selfTest();
else await main();
