export const CHAIN_IDS = Object.freeze([
  'sushiro','hamazushi','kurasushi','kappasushi','uobei','totomaru','musashimaru','tokubei',
]);

export const OFFICIAL_SOURCES = Object.freeze({
  sushiro: {
    campaignIndex: 'https://www.akindo-sushiro.co.jp/campaign/',
    menu: 'https://www.akindo-sushiro.co.jp/menu/',
    stores: 'https://www.akindo-sushiro.co.jp/shop/',
  },
  hamazushi: {
    menu: 'https://www.hamazushi.com/menu/',
    topics: 'https://www.hamazushi.com/topics/',
    stores: 'https://maps.hama-sushi.co.jp/jp/index.html',
    currentTopic: 'https://www.hamazushi.com/topics/2026/0907000856.html',
  },
  kurasushi: {
    releases: 'https://www.kurasushi.co.jp/author/2026.html',
    menu: 'https://www.kurasushi.co.jp/menu/',
    stores: 'https://shop.kurasushi.co.jp/',
    currentRelease: 'https://www.kurasushi.co.jp/author/008437.html',
  },
  kappasushi: {
    campaigns: 'https://www.kappasushi.jp/campaign_list/',
    stores: 'https://www.kappasushi.jp/shop2',
    currentMain: 'https://prtimes.jp/main/html/rd/p/000001211.000018731.html',
    currentAutumn: 'https://prtimes.jp/main/html/rd/p/000001213.000018731.html',
    currentMoon: 'https://prtimes.jp/main/html/rd/p/000001214.000018731.html',
  },
  uobei: {
    menu: 'https://www.uobei.info/menu/',
    stores: 'https://www.uobei.info/store/',
    currentRelease: 'https://prtimes.jp/main/html/rd/p/000000243.000020954.html',
    currentHero: 'https://prcdn.freetls.fastly.net/release_image/20954/243/20954-243-f4d244da98b9421a28f5fbd4f82cf5d1-600x600.png',
  },
  totomaru: {
    home: 'https://totomaru.ec-design.co.jp/',
    news: 'https://totomaru.ec-design.co.jp/news',
    products: 'https://totomaru.ec-design.co.jp/products',
    shops: 'https://totomaru.ec-design.co.jp/shops',
    legacyMenu: 'https://www.comline.co.jp/totomaru/menu/',
    legacyStores: 'https://www.comline.co.jp/shoplist/',
  },
  musashimaru: {
    menu: 'https://www.634-jp.com/musashimaru-menu.html',
    stores: 'https://www.634-jp.com/musashimaru-shop.html',
    brand: 'https://www.634-jp.com/musashimaru.html',
  },
  tokubei: {
    info: 'https://www.nigirinotokubei.com/info/',
    stores: 'https://www.nigirinotokubei.com/shop/',
    currentRelease: 'https://www.nigirinotokubei.com/info/11244/',
    currentCompanyRelease: 'https://www.atom-corp.co.jp/fair/fair.php?fair_no=3827',
  },
});

export const ALLOWED_SOURCE_HOSTS = Object.freeze(new Set([
  'www.akindo-sushiro.co.jp','cmsimage.akindo-sushiro.co.jp',
  'www.hamazushi.com','maps.hama-sushi.co.jp',
  'www.kurasushi.co.jp','shop.kurasushi.co.jp',
  'www.kappasushi.jp','prtimes.jp','prcdn.freetls.fastly.net',
  'www.uobei.info',
  'www.comline.co.jp','totomaru.ec-design.co.jp','cos.ec-design.co.jp',
  'www.634-jp.com',
  'www.nigirinotokubei.com','www.atom-corp.co.jp','origin.digitalpr.jp',
]));

export function sourceHostAllowed(url) {
  try { return ALLOWED_SOURCE_HOSTS.has(new URL(url).hostname); }
  catch { return false; }
}

export function source(chain, key) {
  const value = OFFICIAL_SOURCES?.[chain]?.[key];
  if (!value) throw new Error(`Unknown official source: ${chain}.${key}`);
  return value;
}
