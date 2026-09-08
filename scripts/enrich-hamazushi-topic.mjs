import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FAIR_PATH = path.join(ROOT, 'app', 'data', 'fairs.json');
const HAMAZUSHI_HOST = 'www.hamazushi.com';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const normalize = (value = '') => clean(value).normalize('NFKC')
  .replace(/[「」『』【】〖〗［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\\/|~〜～\-–—\s]/g, '')
  .toLowerCase();

function acceptableProductName(value) {
  const name = clean(value)
    .replace(/^[●◆■◇▶▷・※]+\s*/, '')
    .replace(/[、。,:：]+$/, '')
    .replace(/(?:を|は|が)?\s*期間限定で?$/, '')
    .trim();
  if (name.length < 2 || name.length > 70) return null;
  if (/フェア|祭り|まつり|キャンペーン|開催|販売期間|提供期間|対象店舗|全店|税込|価格|公式アカウント|Twitter|X\(|X（|ご優待券|お食事券|クーポン/.test(name)) return null;
  if (/^(?:商品|メニュー|その他|こちら|はま寿司)$/.test(name)) return null;
  return name;
}

export function extractSharedPriceProducts(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  const seen = new Set();

  $('p, li, dd').each((_, element) => {
    const text = clean($(element).text());
    if (!text || !/税込\s*[0-9,]+\s*円/.test(text)) return;

    const pricePattern = /([0-9,]+)\s*円\s*[（(]\s*税込\s*([0-9,]+)\s*円\s*[）)]/g;
    let previousEnd = 0;
    let match;
    while ((match = pricePattern.exec(text)) !== null) {
      const segment = text.slice(previousEnd, match.index);
      previousEnd = pricePattern.lastIndex;
      const price = Number(match[2].replace(/,/g, ''));
      if (!Number.isFinite(price) || price <= 0 || price > 10_000) continue;

      const quoted = [...segment.matchAll(/[「『]([^」』]{2,70})[」』]/g)]
        .map(item => acceptableProductName(item[1]))
        .filter(Boolean)
        .slice(-5);

      for (const name of quoted) {
        const key = `${normalize(name)}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ name, price });
      }
    }
  });

  return candidates;
}

async function fetchHtml(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== HAMAZUSHI_HOST) {
    throw new Error(`Unexpected Hamazushi campaign source: ${url}`);
  }
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function mergeExplicitSharedPrices(chain, candidates) {
  const items = Array.isArray(chain.items) ? [...chain.items] : [];
  const byName = new Map(items.map((item, index) => [normalize(item.name), index]));
  let added = 0;
  let corrected = 0;

  for (const candidate of candidates) {
    const key = normalize(candidate.name);
    const existingIndex = byName.get(key);
    if (existingIndex !== undefined) {
      const current = items[existingIndex];
      if (current.price !== candidate.price) {
        items[existingIndex] = {
          ...current,
          price: candidate.price,
          sourceUrl: chain.officialCampaignUrl,
          scrapeStatus: 'ok',
          saleStatus: chain.campaignPhase === 'upcoming' ? 'upcoming' : 'active',
        };
        corrected += 1;
      }
      continue;
    }

    const next = {
      name: candidate.name,
      price: candidate.price,
      startDate: chain.startDate || null,
      endDate: chain.endDate || null,
      saleStatus: chain.campaignPhase === 'upcoming' ? 'upcoming' : 'active',
      scrapeStatus: 'ok',
      sourceUrl: chain.officialCampaignUrl,
    };
    byName.set(key, items.length);
    items.push(next);
    added += 1;
  }

  return { items, added, corrected };
}

function runSelfTests() {
  const fixture = `<!doctype html><html><body>
    <p>本フェアでは、「厳選まぐろ中とろ」を期間限定で、100円（税込110円）でご提供します。さらに、「大葉真いか握り」、「厚切りつぶ貝」を100円（税込110円）でご提供します。</p>
    <p>フェア開催を記念して「Xキャンペーン」を実施します。賞品は3,000円です。</p>
  </body></html>`;
  const products = extractSharedPriceProducts(fixture);
  assert.deepEqual(products, [
    { name: '厳選まぐろ中とろ', price: 110 },
    { name: '大葉真いか握り', price: 110 },
    { name: '厚切りつぶ貝', price: 110 },
  ]);

  const merged = mergeExplicitSharedPrices({
    startDate: '2026-09-08',
    endDate: null,
    campaignPhase: 'active',
    officialCampaignUrl: 'https://www.hamazushi.com/topics/2026/example.html',
    items: [{ name: '厳選まぐろ中とろ', price: 176, sourceUrl: 'old' }],
  }, products);
  assert.equal(merged.corrected, 1);
  assert.equal(merged.added, 2);
  assert.equal(merged.items.find(item => item.name === '厳選まぐろ中とろ')?.price, 110);
  console.log('Hamazushi shared-price enrichment self-tests passed.');
}

async function main() {
  runSelfTests();
  const data = JSON.parse(await fs.readFile(FAIR_PATH, 'utf8'));
  const index = (data.chains || []).findIndex(chain => chain.chain === 'hamazushi');
  if (index < 0) throw new Error('Hamazushi chain row missing');
  const chain = data.chains[index];

  if (!chain.officialCampaignUrl || !/^https:\/\/www\.hamazushi\.com\/topics\//.test(chain.officialCampaignUrl)) {
    throw new Error('Hamazushi official campaign URL is missing or unexpected');
  }

  try {
    const html = await fetchHtml(chain.officialCampaignUrl);
    const candidates = extractSharedPriceProducts(html);
    const merged = mergeExplicitSharedPrices(chain, candidates);
    data.chains[index] = { ...chain, items: merged.items };
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(FAIR_PATH, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Hamazushi shared-price enrichment: ${candidates.length} explicit products, ${merged.added} added, ${merged.corrected} corrected.`);
  } catch (error) {
    console.warn(`::warning title=Hamazushi shared-price enrichment::${error.message}`);
    // Fail closed: do not mutate verified fair data when the official page cannot be fetched.
  }
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
