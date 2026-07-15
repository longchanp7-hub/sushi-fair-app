import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const JST_YEAR = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
}).format(new Date()));

const STORES = {
  sushiro: {
    name: '豊橋磯辺店',
    sourceUrl: 'https://www.akindo-sushiro.co.jp/menu/menu_detail/?s_id=244',
    storeUrl: 'https://www.akindo-sushiro.co.jp/shop/',
  },
  hamazushi: {
    name: '豊橋新栄周辺',
    sourceUrl: 'https://www.hamazushi.com/menu/',
    storeUrl: 'https://maps.hama-sushi.co.jp/jp/index.html',
  },
  kurasushi: {
    name: '豊橋新栄店',
    sourceUrl: 'https://shop.kurasushi.co.jp/detail/609',
    storeUrl: 'https://shop.kurasushi.co.jp/detail/609',
  },
  kappasushi: {
    name: '豊橋飯村店',
    sourceUrl: 'https://www.kappasushi.jp/campaign_list/',
    storeUrl: 'https://www.kappasushi.jp/shop/0220',
  },
};

async function fetchHtml(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'cache-control': 'no-cache',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function clean(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return value ? new URL(value, baseUrl).href : null;
  } catch {
    return null;
  }
}

function countMatches(text, pattern) {
  return [...String(text).matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
}

function elementLines($, element) {
  if (!element?.length) return [];
  const html = $.html(element) || '';
  const withBreaks = html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|dt|dd|h[1-6]|section|article|span)>/gi, '\n');
  const fragment = cheerio.load(`<div>${withBreaks}</div>`);
  return fragment('div').first().text().split(/\n+/).map(clean).filter(Boolean);
}

function pageLines($) {
  const html = $('body').html() || '';
  const withBreaks = html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|dt|dd|h[1-6]|section|article|a)>/gi, '\n');
  const fragment = cheerio.load(`<div>${withBreaks}</div>`);
  return fragment('div').first().text().split(/\n+/).map(clean).filter(Boolean);
}

function parsePrice(text = '') {
  const taxIncluded = text.match(/税込\s*([\d,]+)円/);
  if (taxIncluded) return Number(taxIncluded[1].replace(/,/g, ''));
  const first = text.match(/([\d,]+)円/);
  return first ? Number(first[1].replace(/,/g, '')) : null;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseSlashRange(text, year = JST_YEAR) {
  const match = String(text).match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*[～〜~\-–—]\s*(\d{1,2})\/(\d{1,2})/);
  if (!match) return { startDate: null, endDate: null };
  return {
    startDate: isoDate(year, Number(match[1]), Number(match[2])),
    endDate: isoDate(year, Number(match[3]), Number(match[4])),
  };
}

function parseDotRange(text) {
  const full = String(text).match(/(20\d{2})[./](\d{1,2})[./](\d{1,2})\s*[～〜~\-–—]\s*(20\d{2})[./](\d{1,2})[./](\d{1,2})/);
  if (full) {
    return {
      startDate: isoDate(Number(full[1]), Number(full[2]), Number(full[3])),
      endDate: isoDate(Number(full[4]), Number(full[5]), Number(full[6])),
    };
  }
  const short = String(text).match(/(20\d{2})[./](\d{1,2})[./](\d{1,2})\s*[～〜~\-–—]\s*(\d{1,2})[./](\d{1,2})/);
  if (short) {
    return {
      startDate: isoDate(Number(short[1]), Number(short[2]), Number(short[3])),
      endDate: isoDate(Number(short[1]), Number(short[4]), Number(short[5])),
    };
  }
  const startOnly = String(text).match(/(20\d{2})[./](\d{1,2})[./](\d{1,2})\s*[～〜~\-–—]/);
  if (startOnly) {
    return {
      startDate: isoDate(Number(startOnly[1]), Number(startOnly[2]), Number(startOnly[3])),
      endDate: null,
    };
  }
  return { startDate: null, endDate: null };
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const name = clean(item.name);
    if (!name) return false;
    const key = `${name}|${item.price ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    item.name = name;
    return true;
  });
}

function firstUsefulImage($, root, pageUrl) {
  const target = root?.length ? root : $('body');
  const image = target.find('img').filter((_, element) => {
    const src = $(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-lazy-src');
    const alt = clean($(element).attr('alt') || '');
    return src && !/logo|icon|sprite|arrow|close|phone/i.test(src) && !/ロゴ|アイコン/.test(alt);
  }).first();
  const src = image.attr('src') || image.attr('data-src') || image.attr('data-lazy-src');
  if (src) return absoluteUrl(src, pageUrl);
  const meta = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
  return absoluteUrl(meta, pageUrl);
}

function findCompactProductBlock($, start, pricePattern = /[\d,]+円/) {
  let node = $(start);
  for (let level = 0; level < 9 && node.length; level += 1, node = node.parent()) {
    const text = clean(node.text());
    const priceCount = countMatches(text, pricePattern);
    if (text.length >= 5 && text.length <= 900 && priceCount >= 1 && priceCount <= 2) return node;
  }
  return $(start).parent();
}

function productNameFromBlock($, block, priceText = '') {
  const lines = elementLines($, block);
  const priceIndex = lines.findIndex(line => line.includes(priceText) || /[\d,]+円/.test(line));
  const candidates = (priceIndex >= 0 ? lines.slice(0, priceIndex) : lines)
    .filter(line => line.length <= 80)
    .filter(line => !/期間限定|メニュー|税込|kcal|写真|イメージ|お持ち帰り|販売|店舗|提供エリア|売切れ|完売/.test(line))
    .filter(line => !/^\d+$/.test(line));
  if (!candidates.length) return null;
  return clean(candidates.slice(-2).join(''));
}

async function scrapeSushiro() {
  const store = STORES.sushiro;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const items = [];
  let imageUrl = null;

  $('img[alt]').each((_, element) => {
    const name = clean($(element).attr('alt') || '');
    if (!name || /スシロー|ロゴ|メニュー|電話|店舗|アプリ|TOP|PAGE/.test(name)) return;

    let node = $(element);
    let block = null;
    for (let level = 0; level < 9 && node.length; level += 1, node = node.parent()) {
      const text = clean(node.text());
      if (/[\d,]+円/.test(text) && /\d{1,2}\/\d{1,2}.*[～〜].*\d{1,2}\/\d{1,2}/s.test(text) && text.length < 1500) {
        block = node;
        break;
      }
    }
    if (!block) return;

    const text = clean(block.text());
    const price = parsePrice(text);
    const range = parseSlashRange(text);
    if (!price || !range.startDate) return;

    const src = $(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-lazy-src');
    imageUrl ||= absoluteUrl(src, store.sourceUrl);
    items.push({ name, price, ...range });
  });

  const unique = dedupeItems(items).slice(0, 40);
  const starts = unique.map(item => item.startDate).filter(Boolean).sort();
  const ends = unique.map(item => item.endDate).filter(Boolean).sort();

  return {
    chain: 'sushiro',
    storeName: store.name,
    fairName: 'フェア商品',
    startDate: starts[0] || null,
    endDate: ends.at(-1) || null,
    items: unique.map(({ name, price }) => ({ name, price })),
    sourceUrl: store.sourceUrl,
    storeUrl: store.storeUrl,
    imageUrl: imageUrl || firstUsefulImage($, $('body'), store.sourceUrl),
    status: unique.length ? 'ok' : 'warning',
    message: unique.length ? null : 'フェア商品の自動抽出結果が0件でした。',
  };
}

function findCategoryRoot($, pattern) {
  const heading = $('h1,h2,h3,h4,h5').filter((_, element) => {
    const label = clean(`${$(element).text()} ${$(element).find('img').map((__, img) => $(img).attr('alt') || '').get().join(' ')}`);
    return pattern.test(label);
  }).first();
  if (!heading.length) return null;

  const siblingHtml = [];
  let sibling = heading.next();
  while (sibling.length && !sibling.is('h1,h2,h3,h4,h5')) {
    siblingHtml.push($.html(sibling));
    sibling = sibling.next();
  }
  if (siblingHtml.length) {
    const fragment = cheerio.load(`<section>${siblingHtml.join('')}</section>`);
    const text = clean(fragment('section').text());
    if (countMatches(text, /[\d,]+円/) >= 2) return { $: fragment, root: fragment('section') };
  }

  let container = heading.closest('section,article,div');
  for (let level = 0; level < 6 && container.length; level += 1, container = container.parent()) {
    const text = clean(container.text());
    if (countMatches(text, /[\d,]+円/) >= 2 && text.length < 40000) return { $, root: container };
  }
  return null;
}

function extractPricedItems(context) {
  if (!context) return [];
  const { $, root } = context;
  const items = [];

  root.find('*').filter((_, element) => {
    const own = clean($(element).clone().children().remove().end().text());
    return /[\d,]+円/.test(own);
  }).each((_, element) => {
    const own = clean($(element).clone().children().remove().end().text());
    const block = findCompactProductBlock($, element);
    const text = clean(block.text());
    const price = parsePrice(text);
    const name = productNameFromBlock($, block, own);
    if (name && price && !/合計|セット価格|税込価格/.test(name)) items.push({ name, price });
  });

  return dedupeItems(items).slice(0, 40);
}

async function scrapeHamazushi() {
  const store = STORES.hamazushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const context = findCategoryRoot($, /期間限定/);
  const items = extractPricedItems(context);

  return {
    chain: 'hamazushi',
    storeName: store.name,
    fairName: '期間限定メニュー',
    startDate: null,
    endDate: null,
    items,
    sourceUrl: store.sourceUrl,
    storeUrl: store.storeUrl,
    imageUrl: firstUsefulImage(context?.$ || $, context?.root || $('body'), store.sourceUrl),
    status: items.length ? 'ok' : 'warning',
    message: items.length ? null : '期間限定商品の自動抽出結果が0件でした。',
  };
}

async function scrapeKurasushi() {
  const store = STORES.kurasushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const lines = pageLines($);
  const eventIndex = lines.findIndex(line => line === 'イベント');
  const dateIndex = lines.findIndex((line, index) => index > eventIndex && /20\d{2}\.\d{1,2}\.\d{1,2}\s*[-–—]\s*20\d{2}\.\d{1,2}\.\d{1,2}/.test(line));

  let fairName = '開催中イベント';
  let range = { startDate: null, endDate: null };
  let description = '';

  if (dateIndex >= 0) {
    range = parseDotRange(lines[dateIndex]);
    fairName = lines.slice(dateIndex + 1).find(line => /フェア|祭り|キャンペーン/.test(line)) || fairName;
    const start = lines.indexOf(fairName, dateIndex + 1);
    const end = lines.findIndex((line, index) => index > start && /続きを読む|イベント一覧/.test(line));
    description = lines.slice(start + 1, end > start ? end : start + 8).join(' ');
  }

  const quoted = [...description.matchAll(/「([^」]{2,50})」/g)].map(match => clean(match[1]));
  const items = dedupeItems(quoted
    .filter(name => !/フェア|開催|期間限定/.test(name))
    .map(name => ({ name, price: null })))
    .slice(0, 20);

  return {
    chain: 'kurasushi',
    storeName: store.name,
    fairName: clean(fairName.replace(/[＼／「」]/g, '')),
    ...range,
    items,
    sourceUrl: store.sourceUrl,
    storeUrl: store.storeUrl,
    imageUrl: firstUsefulImage($, $('body'), store.sourceUrl),
    status: fairName !== '開催中イベント' ? 'ok' : 'warning',
    message: fairName !== '開催中イベント' ? null : '店舗イベント名を自動取得できませんでした。',
  };
}

function isCurrentCampaign(range) {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())}T00:00:00+09:00`);
  const start = range.startDate ? new Date(`${range.startDate}T00:00:00+09:00`) : null;
  const end = range.endDate ? new Date(`${range.endDate}T23:59:59+09:00`) : null;
  return (!start || start <= today) && (!end || end >= today);
}

function stripCampaignDate(text) {
  return clean(String(text)
    .replace(/20\d{2}[./]\d{1,2}[./]\d{1,2}\s*[～〜~\-–—]\s*(?:20\d{2}[./])?\d{1,2}[./]\d{1,2}(?:まで予定|迄|まで)?/g, '')
    .replace(/20\d{2}[./]\d{1,2}[./]\d{1,2}\s*[～〜~\-–—]\s*なくなり次第終了/g, '')
    .replace(/数量限定なくなり次第終了/g, '')
    .replace(/ご予約承り中/g, ''));
}

async function scrapeKappasushi() {
  const store = STORES.kappasushi;
  const html = await fetchHtml(store.sourceUrl);
  const $ = cheerio.load(html);
  const campaigns = [];

  $('a').each((_, element) => {
    const text = clean(`${$(element).text()} ${$(element).find('img').map((__, img) => $(img).attr('alt') || '').get().join(' ')}`);
    if (!text || !/(とろの日|祭り|フェア|うに|いくら|まぐろ|寿司|夏のおすすめ)/.test(text)) return;
    if (/食べ放題|ランチ|ポイント|割引|プレゼント|商品券|デリバリー|アプリ会員/.test(text)) return;
    const range = parseDotRange(text);
    if ((range.startDate || range.endDate) && !isCurrentCampaign(range)) return;
    const name = stripCampaignDate(text);
    const href = absoluteUrl($(element).attr('href'), store.sourceUrl);
    const image = $(element).find('img').first();
    const imageUrl = absoluteUrl(image.attr('src') || image.attr('data-src') || image.attr('data-lazy-src'), store.sourceUrl);
    campaigns.push({ name, price: parsePrice(text), href, imageUrl, ...range });
  });

  const unique = dedupeItems(campaigns).slice(0, 8);
  const primary = unique[0];

  return {
    chain: 'kappasushi',
    storeName: store.name,
    fairName: primary?.name || '期間限定キャンペーン',
    startDate: primary?.startDate || null,
    endDate: primary?.endDate || null,
    items: unique.map(({ name, price }) => ({ name, price })),
    sourceUrl: primary?.href || store.sourceUrl,
    storeUrl: store.storeUrl,
    imageUrl: primary?.imageUrl || firstUsefulImage($, $('body'), store.sourceUrl),
    status: unique.length ? 'ok' : 'warning',
    message: unique.length ? null : '開催中キャンペーンの自動抽出結果が0件でした。',
  };
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUT, 'utf8'));
  } catch {
    return { chains: [] };
  }
}

const scrapers = [scrapeSushiro, scrapeHamazushi, scrapeKurasushi, scrapeKappasushi];
const previous = await readPrevious();
const chains = [];

for (const scraper of scrapers) {
  try {
    const result = await scraper();
    if (!result.items.length) {
      const old = previous.chains?.find(chain => chain.chain === result.chain && chain.items?.length);
      chains.push(old ? {
        ...old,
        storeName: result.storeName || old.storeName,
        sourceUrl: result.sourceUrl || old.sourceUrl,
        storeUrl: result.storeUrl || old.storeUrl,
        status: 'warning',
        message: result.message || '今回の自動取得に失敗したため、前回データを表示しています。',
      } : result);
    } else {
      chains.push(result);
    }
  } catch (error) {
    const chainName = scraper.name.replace('scrape', '').toLowerCase();
    const old = previous.chains?.find(chain => chain.chain === chainName);
    if (old) {
      chains.push({
        ...old,
        status: 'warning',
        message: `今回の更新に失敗したため前回データを表示しています: ${error.message}`,
      });
    } else {
      chains.push({
        chain: chainName,
        storeName: STORES[chainName]?.name || '',
        fairName: '取得エラー',
        startDate: null,
        endDate: null,
        items: [],
        sourceUrl: STORES[chainName]?.sourceUrl || '#',
        storeUrl: STORES[chainName]?.storeUrl || '#',
        status: 'error',
        message: error.message,
      });
    }
  }
}

const output = {
  updatedAt: new Date().toISOString(),
  timezone: 'Asia/Tokyo',
  chains,
};

await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Updated ${OUT}`);
for (const chain of chains) {
  console.log(`${chain.chain}: ${chain.items.length} items (${chain.status})`);
}
