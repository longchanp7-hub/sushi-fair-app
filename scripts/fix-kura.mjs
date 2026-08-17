import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const STORE_URL = 'https://shop.kurasushi.co.jp/detail/609';
const PRESS_RELEASE_ROOT = 'https://www.kurasushi.co.jp/author/';

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return value ? new URL(value, baseUrl).href : null;
  } catch {
    return null;
  }
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findRanges(value = '') {
  const text = String(value);
  const pattern = /(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s*[-–—〜～]\s*(?:(20\d{2})[./-])?(\d{1,2})[./-](\d{1,2})/g;
  const ranges = [];
  for (const match of text.matchAll(pattern)) {
    const startYear = Number(match[1]);
    const endYear = Number(match[4] || match[1]);
    ranges.push({
      startDate: isoDate(startYear, Number(match[2]), Number(match[3])),
      endDate: isoDate(endYear, Number(match[5]), Number(match[6])),
      index: match.index,
      endIndex: match.index + match[0].length,
      raw: match[0],
    });
  }
  return ranges;
}

function parseRange(value) {
  const first = findRanges(value)[0];
  return first ? { startDate: first.startDate, endDate: first.endDate } : { startDate: null, endDate: null };
}

function jstTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isActive(range, today = jstTodayKey()) {
  return Boolean(range?.startDate && range.startDate <= today && (!range.endDate || today <= range.endDate));
}

function campaignRank(range, today = jstTodayKey()) {
  if (!range.startDate) return 99_999_999;
  const target = new Date(`${today}T00:00:00+09:00`).getTime();
  const start = new Date(`${range.startDate}T00:00:00+09:00`).getTime();
  const end = range.endDate ? new Date(`${range.endDate}T23:59:59+09:00`).getTime() : start;
  if (start <= target && target <= end) return 0;
  if (start > target) return 10_000 + Math.round((start - target) / 86_400_000);
  return 20_000 + Math.round((target - end) / 86_400_000);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SushiFairPersonalApp/1.0; +https://github.com/)',
        'accept-language': 'ja-JP,ja;q=0.9',
        'cache-control': 'no-cache',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeFairName(value = '') {
  return clean(value)
    .replace(/^.*?(?:詳細ページをみる|続きを読む|Close)\s*/i, '')
    .replace(/^[＼／\\/|・:：\-–—〜～\s]+/, '')
    .replace(/[＼／\\/|・:：\-–—〜～\s]+$/, '')
    .replace(/(?:開催|実施)[‼!！。]*$/, '')
    .trim();
}

function normalizeFairKey(value = '') {
  return sanitizeFairName(value)
    .replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g, '')
    .toLowerCase();
}

function fairCore(value = '') {
  return normalizeFairKey(value).replace(/(?:フェア|祭り|キャンペーン)$/u, '');
}

function sameFair(a, b) {
  const aKey = normalizeFairKey(a?.fairName || '');
  const bKey = normalizeFairKey(b?.fairName || '');
  if (!aKey || !bKey || aKey !== bKey) return false;
  if (a?.startDate && b?.startDate && a.startDate !== b.startDate) return false;
  if (a?.endDate && b?.endDate && a.endDate !== b.endDate) return false;
  return true;
}

function findFairName(block = '') {
  const source = clean(block);
  const candidates = [];
  const patterns = [
    /([^。！？!?]{2,80}?(?:フェア|祭り|キャンペーン))/g,
    /([^。！？!?]{2,80}?祭)(?=\s|$)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = sanitizeFairName(match[1]);
      if (!name || /イベント一覧|キャンペーン実施期間|フェア開催$/.test(name)) continue;
      if (name.length > 80) continue;
      candidates.push(name);
    }
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] || null;
}

function eventSectionText($) {
  const bodyText = clean($('body').text());
  const start = bodyText.indexOf('イベント');
  if (start < 0) return bodyText;
  const endMarkers = ['提供サービス', '決済サービス', '駐車場', '近隣店舗'];
  const ends = endMarkers
    .map(marker => bodyText.indexOf(marker, start + 4))
    .filter(index => index > start);
  const end = ends.length ? Math.min(...ends) : Math.min(bodyText.length, start + 12_000);
  return bodyText.slice(start, end);
}

function parseStoreCampaign(html, today = jstTodayKey()) {
  const $ = cheerio.load(html);
  const eventText = eventSectionText($);
  const ranges = findRanges(eventText);
  const candidates = [];

  ranges.forEach((range, index) => {
    const next = ranges[index + 1];
    const block = eventText.slice(range.endIndex, next?.index ?? eventText.length);
    const fairName = findFairName(block);
    if (!fairName) return;
    candidates.push({
      fairName,
      startDate: range.startDate,
      endDate: range.endDate,
      items: [],
      description: clean(block),
      sourceUrl: STORE_URL,
      imageUrl: null,
    });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => campaignRank(a, today) - campaignRank(b, today));
  return candidates[0];
}

function pressReleaseIndexUrl(year) {
  return `${PRESS_RELEASE_ROOT}${year}.html`;
}

function findPressReleaseUrl(indexHtml, fairName, baseUrl) {
  const $ = cheerio.load(indexHtml);
  const target = normalizeFairKey(fairName);
  const core = fairCore(fairName);
  const candidates = [];

  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), baseUrl);
    if (!href || !/\/author\/\d+\.html(?:$|[?#])/.test(href)) return;
    const text = clean(`${$(element).text()} ${$(element).find('img[alt]').map((__, image) => $(image).attr('alt') || '').get().join(' ')}`);
    const key = normalizeFairKey(text);
    if (!key) return;

    let score = 99;
    if (target && key.includes(target)) score = 0;
    else if (core.length >= 4 && key.includes(core) && /(フェア|祭り|キャンペーン)/.test(text)) score = 1;
    if (score < 99) candidates.push({ href, score, textLength: text.length });
  });

  candidates.sort((a, b) => a.score - b.score || a.textLength - b.textLength);
  return candidates[0]?.href || null;
}

function pageLines($) {
  const html = $('body').html() || '';
  const withBreaks = html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|dt|dd|h[1-6]|section|article|tr|td|figure|figcaption)>/gi, '\n');
  const fragment = cheerio.load(`<div>${withBreaks}</div>`);
  return fragment('div').first().text().split(/\n+/).map(clean).filter(Boolean);
}

function parseJapaneseRange(text, defaultYear) {
  const value = clean(text);
  const full = value.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?\s*[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (full) {
    const startYear = Number(defaultYear);
    const startMonth = Number(full[1]);
    const endMonth = Number(full[4]);
    const endYear = Number(full[3] || (endMonth < startMonth ? startYear + 1 : startYear));
    return {
      startDate: isoDate(startYear, startMonth, Number(full[2])),
      endDate: isoDate(endYear, endMonth, Number(full[5])),
    };
  }

  const openEnded = value.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?\s*[～〜~\-–—]\s*$/);
  if (openEnded) {
    return {
      startDate: isoDate(Number(defaultYear), Number(openEnded[1]), Number(openEnded[2])),
      endDate: null,
    };
  }

  return { startDate: null, endDate: null };
}

function parsePricedProductLine(line) {
  const value = clean(line);
  if (!value || /^※/.test(value) || /販売期間|価格は|税込価格/.test(value)) return null;
  const firstPrice = value.match(/([\d,]+)\s*円/);
  if (!firstPrice || firstPrice.index == null) return null;
  const name = clean(value.slice(0, firstPrice.index))
    .replace(/^[・●■◆◇▶▷]+\s*/, '')
    .replace(/[：:]$/, '')
    .trim();
  if (!name || name.length > 100 || /^(?:商品名|価格|対象商品)$/.test(name)) return null;
  const taxIncluded = value.match(/税込\s*([\d,]+)\s*円/);
  const price = Number((taxIncluded?.[1] || firstPrice[1]).replace(/,/g, ''));
  return Number.isFinite(price) && price > 0 ? { name, price } : null;
}

function itemIsActive(item, today) {
  return (!item.startDate || item.startDate <= today) && (!item.endDate || today <= item.endDate);
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${clean(item.name)}|${item.price ?? ''}`;
    if (!item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseOfficialFairRelease(html, storeCampaign, sourceUrl, today = jstTodayKey()) {
  const $ = cheerio.load(html);
  const lines = pageLines($);
  const start = lines.findIndex(line => /■?\s*販売概要/.test(line) && /商品名|価格|販売期間/.test(line));
  if (start < 0) return null;

  let end = lines.findIndex((line, index) => index > start && /^■/.test(line));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end);
  const year = Number(storeCampaign.startDate?.slice(0, 4) || today.slice(0, 4));
  const items = [];

  for (let index = 0; index < section.length; index += 1) {
    const product = parsePricedProductLine(section[index]);
    if (!product) continue;

    const nearby = section.slice(index + 1, index + 5);
    const periodLine = nearby.find(line => /(?:販売|売)期間/.test(line));
    const range = periodLine ? parseJapaneseRange(periodLine, year) : { startDate: null, endDate: null };
    const item = { ...product, ...range };
    if (itemIsActive(item, today)) items.push(item);
  }

  const unique = dedupeItems(items).slice(0, 30);
  if (!unique.length) return null;

  const imageUrl = absoluteUrl(
    $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'),
    sourceUrl,
  );

  return {
    ...storeCampaign,
    items: unique,
    sourceUrl,
    imageUrl,
    dataQuality: 'complete',
    priceNote: '公式プレスリリース掲載価格です。店舗により価格が異なる場合があります。',
  };
}

function reusablePreviousItems(previousChain, selected, today) {
  if (!previousChain || !sameFair(previousChain, selected)) return [];
  if (previousChain.endDate && previousChain.endDate < today) return [];

  return dedupeItems((previousChain.items || []).filter(item => {
    if (!item?.name || item.price == null) return false;
    if (!item.startDate && !item.endDate) return false;
    return itemIsActive(item, today);
  }));
}

function applySelectedCampaign(data, selected, today = jstTodayKey()) {
  data.chains = (data.chains || []).map(chain => {
    if (chain.chain !== 'kurasushi') return chain;

    const freshItems = (selected.items || []).filter(item => item?.name && item.price != null);
    const reusedItems = freshItems.length ? [] : reusablePreviousItems(chain, selected, today);
    const items = freshItems.length ? freshItems : reusedItems;
    const reused = !freshItems.length && reusedItems.length > 0;

    return {
      ...chain,
      storeName: '豊橋新栄店',
      fairName: selected.fairName,
      startDate: selected.startDate,
      endDate: selected.endDate,
      items,
      sourceUrl: selected.sourceUrl || STORE_URL,
      storeUrl: STORE_URL,
      imageUrl: selected.imageUrl || null,
      priceNote: items.length
        ? (selected.priceNote || chain.priceNote || '公式掲載価格です。店舗により価格が異なる場合があります。')
        : null,
      status: items.length && !reused ? 'ok' : 'warning',
      message: reused
        ? '公式プレスリリースの再取得に失敗したため、同一フェアで前回確認済みの商品を表示しています。'
        : items.length
          ? null
          : '開催中フェア名と期間は取得済みですが、個別商品の自動取得はできていません。公式ページで確認してください。',
    };
  });
}

function hideExpiredKura(data, message, today = jstTodayKey()) {
  data.chains = (data.chains || []).map(chain => {
    if (chain.chain !== 'kurasushi') return chain;
    const expired = chain.endDate && chain.endDate < today;
    return expired ? {
      ...chain,
      fairName: '最新フェア確認中',
      startDate: null,
      endDate: null,
      items: [],
      sourceUrl: STORE_URL,
      storeUrl: STORE_URL,
      imageUrl: null,
      priceNote: null,
      status: 'warning',
      message,
    } : chain;
  });
}

function validateKuraOutput(data, today = jstTodayKey()) {
  const chain = (data.chains || []).find(item => item.chain === 'kurasushi');
  if (!chain) throw new Error('Kura chain is missing from fairs data');
  if (chain.endDate && chain.endDate < today && (chain.items || []).length) {
    throw new Error('Expired Kura fair must not retain products');
  }
  if ((chain.items || []).some(item => normalizeFairKey(item?.name || '') === normalizeFairKey(chain.fairName || '') && item?.price == null)) {
    throw new Error('Kura fair title must not be published as a dummy product');
  }
  if (chain.status === 'ok' && !(chain.items || []).every(item => item?.name && Number.isFinite(Number(item.price)))) {
    throw new Error('Kura ok status requires priced products');
  }
}

function runSelfTests() {
  const storeFixture = `<!doctype html><html><body>
    <section><h2>イベント</h2><div><a href="https://www.kurasushi.co.jp/topic/mediterranean-tuna">
    <span>2026.08.07 - 2026.08.19</span><h3>地中海本まぐろフェア</h3>
    <p>＼「地中海本まぐろフェア開催‼」／ 地中海本まぐろ大とろ登場！</p></a></div></section>
    <h2>提供サービス</h2></body></html>`;
  const store = parseStoreCampaign(storeFixture, '2026-08-18');
  assert.equal(store.fairName, '地中海本まぐろフェア');
  assert.equal(store.startDate, '2026-08-07');
  assert.equal(store.endDate, '2026-08-19');
  assert.deepEqual(store.items, []);
  assert.equal(parseRange('2026/8/7 - 8/19').endDate, '2026-08-19');

  const indexFixture = `<!doctype html><html><body>
    <a href="/author/008300.html">別のニュース</a>
    <a href="/author/008315.html">碧く澄み渡る海でじっくり育てた「地中海本まぐろ」フェア -8月7日より販売-</a>
  </body></html>`;
  assert.equal(
    findPressReleaseUrl(indexFixture, store.fairName, 'https://www.kurasushi.co.jp/author/2026.html'),
    'https://www.kurasushi.co.jp/author/008315.html',
  );

  const releaseFixture = `<!doctype html><html><head><meta property="og:image" content="/images/fair.png"></head><body>
    <h6>■販売概要 商品名 / 価格 / 販売期間</h6>
    <p>※店舗により価格は異なります。</p>
    <p>地中海大とろ（一貫） 380円</p><p>販売期間：8月7日（金）～8月19日（水）</p>
    <p>〖鹿児島県産〗活〆かんぱち 300円</p><p>販売期間：8月7日（金）～8月30日（日）</p>
    <h6>■超熟成シリーズより、カレイが新登場！</h6>
    <p>超熟成 かれい 115円</p><p>販売期間：8月7日（金）～</p>
  </body></html>`;
  const release = parseOfficialFairRelease(
    releaseFixture,
    store,
    'https://www.kurasushi.co.jp/author/008315.html',
    '2026-08-18',
  );
  assert.deepEqual(release.items.map(item => [item.name, item.price]), [
    ['地中海大とろ（一貫）', 380],
    ['〖鹿児島県産〗活〆かんぱち', 300],
  ]);
  assert.equal(release.items[0].endDate, '2026-08-19');
  assert.equal(release.imageUrl, 'https://www.kurasushi.co.jp/images/fair.png');

  const endDayData = { chains: [{
    chain: 'kurasushi', fairName: store.fairName, startDate: store.startDate, endDate: store.endDate,
    items: release.items, status: 'ok',
  }] };
  hideExpiredKura(endDayData, 'expired', '2026-08-19');
  assert.equal(endDayData.chains[0].items.length, 2, 'fair remains valid through its end date');

  const afterEndData = structuredClone(endDayData);
  hideExpiredKura(afterEndData, 'expired', '2026-08-20');
  assert.equal(afterEndData.chains[0].items.length, 0, 'products are removed the day after fair end');
  assert.equal(afterEndData.chains[0].fairName, '最新フェア確認中');

  const nextFairData = { chains: [{
    chain: 'kurasushi', fairName: store.fairName, startDate: store.startDate, endDate: store.endDate,
    items: release.items, status: 'ok',
  }] };
  applySelectedCampaign(nextFairData, {
    fairName: '次のまぐろフェア', startDate: '2026-08-20', endDate: '2026-09-02',
    items: [], sourceUrl: STORE_URL, imageUrl: null,
  }, '2026-08-20');
  assert.equal(nextFairData.chains[0].items.length, 0, 'old products must not cross into a new fair');
  assert.equal(nextFairData.chains[0].fairName, '次のまぐろフェア');

  const sameFairFallbackData = { chains: [{
    chain: 'kurasushi', fairName: store.fairName, startDate: store.startDate, endDate: store.endDate,
    items: release.items, status: 'ok',
  }] };
  applySelectedCampaign(sameFairFallbackData, store, '2026-08-18');
  assert.equal(sameFairFallbackData.chains[0].items.length, 2, 'dated products may be reused only within the same active fair');
  assert.equal(sameFairFallbackData.chains[0].status, 'warning');
  validateKuraOutput(sameFairFallbackData, '2026-08-18');
  validateKuraOutput(afterEndData, '2026-08-20');

  console.log('Kura parser self-tests passed.');
}

async function main() {
  const today = jstTodayKey();
  let data = JSON.parse(await fs.readFile(OUT, 'utf8'));

  try {
    const storeHtml = await fetchHtml(STORE_URL);
    const storeCampaign = parseStoreCampaign(storeHtml, today);
    let selected = storeCampaign && isActive(storeCampaign, today) ? storeCampaign : null;

    if (selected) {
      try {
        const year = Number(selected.startDate?.slice(0, 4) || today.slice(0, 4));
        const indexUrl = pressReleaseIndexUrl(year);
        const indexHtml = await fetchHtml(indexUrl);
        const releaseUrl = findPressReleaseUrl(indexHtml, selected.fairName, indexUrl);
        if (releaseUrl) {
          const releaseHtml = await fetchHtml(releaseUrl);
          const release = parseOfficialFairRelease(releaseHtml, selected, releaseUrl, today);
          if (release?.items?.length) selected = release;
          else console.warn(`Kura press release found but priced fair products were not parsed: ${releaseUrl}`);
        } else {
          console.warn(`Kura press release not found for: ${selected.fairName}`);
        }
      } catch (error) {
        console.warn(`Kura press release enrichment skipped: ${error.message}`);
      }
    }

    if (!selected) {
      hideExpiredKura(data, '終了済みフェアは非表示にしました。公式ページの更新を確認中です。', today);
      validateKuraOutput(data, today);
      await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
      console.warn('Kura current campaign not found; expired campaign hidden.');
      return;
    }

    applySelectedCampaign(data, selected, today);
    validateKuraOutput(data, today);
    await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    const kura = data.chains.find(chain => chain.chain === 'kurasushi');
    console.log(`Updated Kura: ${kura.fairName} (${kura.items.length} items, ${kura.status})`);
  } catch (error) {
    hideExpiredKura(data, '終了済みフェアは非表示にしました。公式情報を再取得中です。', today);
    validateKuraOutput(data, today);
    await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    console.warn(`Kura supplemental parser skipped: ${error.message}`);
  }
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
