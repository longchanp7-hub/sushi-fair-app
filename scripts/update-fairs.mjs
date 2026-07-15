import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const USER_AGENT = 'Mozilla/5.0 (compatible; SushiFairPersonalApp/1.0; +https://github.com/)';

const STORES = {
  sushiro: {
    name: '豊橋磯辺店',
    sourceUrl: 'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=244',
    storeUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=244'
  },
  hamazushi: {
    name: '豊橋曙店',
    sourceUrl: 'https://www.hamazushi.com/menu/',
    storeUrl: 'https://maps.hama-sushi.co.jp/jp/detail/5457.html'
  },
  kurasushi: {
    name: '豊橋新栄店',
    sourceUrl: 'https://shop.kurasushi.co.jp/detail/609',
    storeUrl: 'https://shop.kurasushi.co.jp/detail/609'
  },
  kappasushi: {
    name: '豊橋飯村店',
    sourceUrl: 'https://www.kappasushi.jp/menu2',
    storeUrl: 'https://www.kappasushi.jp/shop/0220'
  }
};

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'ja-JP,ja;q=0.9' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function clean(text = '') { return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
function absoluteUrl(value, baseUrl) { try { return value ? new URL(value, baseUrl).href : null; } catch { return null; } }
function officialImage($, pageUrl) {
  const raw = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || $('meta[property="twitter:image"]').attr('content');
  if (raw) return absoluteUrl(raw, pageUrl);
  const img = $('main img, article img, .campaign img, .event img, .menu img').filter((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    return src && !/logo|icon|sprite/i.test(src);
  }).first();
  return absoluteUrl(img.attr('src') || img.attr('data-src'), pageUrl);
}
function parsePrice(text = '') { const m = text.match(/([\d,]+)円/); return m ? Number(m[1].replace(/,/g,'')) : null; }
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
function parseJapaneseRange(text, year = new Date().getFullYear()) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})[^\d]{0,12}[～〜-][^\d]{0,12}(\d{1,2})\/(\d{1,2})/);
  if (!m) return { startDate: null, endDate: null };
  return { startDate: isoDate(year, Number(m[1]), Number(m[2])), endDate: isoDate(year, Number(m[3]), Number(m[4])) };
}
function parseDotRange(text) {
  const m = text.match(/(20\d{2})\.(\d{2})\.(\d{2})\s*[-–—]\s*(20\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return { startDate: null, endDate: null };
  return { startDate: `${m[1]}-${m[2]}-${m[3]}`, endDate: `${m[4]}-${m[5]}-${m[6]}` };
}
function dedupeItems(items) {
  const seen = new Set();
  return items.filter(x => {
    const key = `${x.name}|${x.price ?? ''}`;
    if (!x.name || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function nearestProductBlock($, element, mustContain = /円/) {
  let node = $(element);
  for (let i = 0; i < 7 && node.length; i++, node = node.parent()) {
    const text = clean(node.text());
    if (text.length >= 8 && text.length <= 650 && mustContain.test(text)) return node;
  }
  return $(element).parent();
}

async function scrapeSushiro() {
  const store = STORES.sushiro;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const items = [];
  $('*').filter((_, el) => /\[?\d{1,2}\/\d{1,2}.*[～〜].*\d{1,2}\/\d{1,2}/.test($(el).text()) && $(el).children().length === 0).each((_, el) => {
    const block = nearestProductBlock($, el, /円\(税込\)|円/);
    const text = clean(block.text());
    const price = parsePrice(text);
    const range = parseJapaneseRange(text, new Date().getFullYear());
    const lines = text.split('\n').map(clean).filter(Boolean);
    const name = lines.find(line => line.length <= 50 && !/円|kcal|販売予定|完売|期間内|お持ち帰り|\d{1,2}\/\d{1,2}/.test(line));
    if (name && price && range.startDate) items.push({ name, price, ...range });
  });
  const uniq = dedupeItems(items).slice(0, 30);
  const dates = uniq.map(x => x.endDate).filter(Boolean).sort();
  return {
    chain: 'sushiro', storeName: store.name, fairName: 'フェア商品', imageUrl: officialImage($, store.sourceUrl),
    startDate: uniq.map(x => x.startDate).filter(Boolean).sort()[0] || null,
    endDate: dates.at(-1) || null,
    items: uniq.map(({name, price}) => ({name, price})), sourceUrl: store.sourceUrl, storeUrl: store.storeUrl,
    status: uniq.length ? 'ok' : 'warning', message: uniq.length ? null : 'フェア商品の自動抽出結果が0件でした。'
  };
}

function extractSectionItems($, headingPattern) {
  const heading = $('h1,h2,h3,h4,.ttl,.title').filter((_, el) => headingPattern.test(clean($(el).text()))).first();
  if (!heading.length) return [];
  let container = heading.closest('section,article,div');
  for (let i = 0; i < 4; i++) {
    const txt = clean(container.text());
    if ((txt.match(/円/g) || []).length >= 2 && txt.length < 20000) break;
    container = container.parent();
  }
  const items = [];
  container.find('*').filter((_, el) => /\d[\d,]*円/.test($(el).text()) && $(el).children().length === 0).each((_, el) => {
    const block = nearestProductBlock($, el, /円/);
    const text = clean(block.text());
    const price = parsePrice(text);
    const lines = text.split('\n').map(clean).filter(Boolean);
    const name = lines.find(line => line.length <= 60 && !/円|税込|写真|イメージ|お持ち帰り|販売|店舗/.test(line));
    if (name && price) items.push({ name, price });
  });
  return dedupeItems(items).slice(0, 30);
}

async function scrapeHamazushi() {
  const store = STORES.hamazushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const items = extractSectionItems($, /期間限定/);
  let fairName = '期間限定メニュー';
  try {
    const top = cheerio.load(await fetchHtml('https://www.hamazushi.com/'));
    const text = clean(top('body').text());
    const m = text.match(/「([^」]{4,45}祭り)」/);
    if (m) fairName = m[1];
  } catch {}
  return { chain:'hamazushi', storeName:store.name, fairName, imageUrl:officialImage($, store.sourceUrl), startDate:null, endDate:null, items, sourceUrl:store.sourceUrl, storeUrl:store.storeUrl, status:items.length?'ok':'warning', message:items.length?null:'期間限定商品の自動抽出結果が0件でした。' };
}

async function scrapeKurasushi() {
  const store = STORES.kurasushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const text = clean($('body').text());
  const eventMatch = text.match(/(20\d{2}\.\d{2}\.\d{2}\s*[-–—]\s*20\d{2}\.\d{2}\.\d{2})\s*\n?\s*([^\n]{2,60}フェア)/);
  const fairName = eventMatch?.[2]?.trim() || '開催中イベント';
  const range = parseDotRange(eventMatch?.[1] || text);
  let eventText = '';
  const idx = text.indexOf(fairName);
  if (idx >= 0) eventText = text.slice(idx, idx + 700);
  const names = [...eventText.matchAll(/「([^」]{2,40})」/g)].map(m => m[1]);
  const items = [...new Set(names)].slice(0, 20).map(name => ({ name, price:null }));
  return { chain:'kurasushi', storeName:store.name, fairName, imageUrl:officialImage($, store.sourceUrl), ...range, items, sourceUrl:store.sourceUrl, storeUrl:store.storeUrl, status:fairName!=='開催中イベント'?'ok':'warning', message:fairName!=='開催中イベント'?null:'店舗イベント名を自動取得できませんでした。' };
}

async function scrapeKappasushi() {
  const store = STORES.kappasushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const items = extractSectionItems($, /期間限定ネタ|期間限定メニュー/);
  return { chain:'kappasushi', storeName:store.name, fairName:'期間限定メニュー', imageUrl:officialImage($, store.sourceUrl), startDate:null, endDate:null, items, sourceUrl:store.sourceUrl, storeUrl:store.storeUrl, status:items.length?'ok':'warning', message:items.length?null:'期間限定商品の自動抽出結果が0件でした。' };
}

async function readPrevious() {
  try { return JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { return { chains: [] }; }
}

const scrapers = [scrapeSushiro, scrapeHamazushi, scrapeKurasushi, scrapeKappasushi];
const previous = await readPrevious();
const chains = [];
for (const scraper of scrapers) {
  try {
    const result = await scraper();
    if (result.items.length === 0) {
      const old = previous.chains?.find(x => x.chain === result.chain && x.items?.length);
      chains.push(old ? { ...old, status:'warning', message:'今回の自動取得に失敗したため、前回データを表示しています。' } : result);
    } else chains.push(result);
  } catch (error) {
    const chain = scraper.name.replace('scrape','').toLowerCase();
    const old = previous.chains?.find(x => x.chain === chain);
    if (old) chains.push({ ...old, status:'warning', message:`今回の更新に失敗したため前回データを表示: ${error.message}` });
    else chains.push({ chain, storeName: STORES[chain]?.name || '', fairName:'取得エラー', startDate:null, endDate:null, items:[], sourceUrl:STORES[chain]?.sourceUrl || '#', storeUrl:STORES[chain]?.storeUrl || '#', status:'error', message:error.message });
  }
}

const output = { updatedAt: new Date().toISOString(), timezone:'Asia/Tokyo', chains };
await fs.writeFile(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Updated ${OUT}`);
for (const c of chains) console.log(`${c.chain}: ${c.items.length} items (${c.status})`);
