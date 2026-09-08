import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { source } from './source-registry.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FAIR_PATH = path.join(ROOT, 'app', 'data', 'fairs.json');
const TOPICS = source('hamazushi', 'topics');
const MENU = source('hamazushi', 'menu');
const FALLBACK_TOPIC = source('hamazushi', 'currentTopic');
const HOME = new URL('/', TOPICS).href;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const MAX_CANDIDATES = 24;
const MAX_UPCOMING_DAYS = 7;

const clean = (value = '') => String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const absoluteUrl = (value, base) => {
  try { return value ? new URL(value, base).href : null; } catch { return null; }
};
const isoDate = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const normalize = (value = '') => clean(value).normalize('NFKC')
  .replace(/[「」『』【】〖〗［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\\/|~〜～\-–—\s]/g, '')
  .toLowerCase();

function jstTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayDistance(iso, today) {
  return Math.round(
    (new Date(`${iso}T00:00:00+09:00`) - new Date(`${today}T00:00:00+09:00`)) / 86_400_000,
  );
}

function campaignPhase(range, today = jstTodayKey()) {
  if (range?.endDate && range.endDate < today) return 'ended';
  if (range?.startDate && range.startDate > today) return 'upcoming';
  return 'active';
}

async function fetchHtml(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
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
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

function pageLines(html) {
  const $ = cheerio.load(html);
  const body = $('body').html() || '';
  const withBreaks = body
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|dt|dd|h[1-6]|section|article|tr|td|figure|figcaption|a)>/gi, '\n');
  const fragment = cheerio.load(`<div>${withBreaks}</div>`);
  return fragment('div').first().text().split(/\n+/).map(clean).filter(Boolean);
}

function parseStartDate(value, today = jstTodayKey()) {
  const text = clean(value);
  const full = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?[^。！？]{0,24}(?:より|から|開始|スタート)/);
  if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?[^。！？]{0,24}(?:より|から|開始|スタート)/);
  if (!short) return null;
  const month = Number(short[1]);
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));
  const year = month + 6 < todayMonth ? todayYear + 1 : todayYear;
  return isoDate(year, month, Number(short[2]));
}

function parseUntilDate(value, startDate) {
  if (!startDate) return null;
  const text = clean(value);
  const slash = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*[（(][^）)]*[）)])?[^。！？]{0,16}まで(?:販売|提供)?/);
  const japanese = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?[^。！？]{0,16}まで(?:販売|提供)?/);
  const match = slash || japanese;
  if (!match) return null;
  const startYear = Number(startDate.slice(0, 4));
  const startMonth = Number(startDate.slice(5, 7));
  const month = Number(match[1]);
  return isoDate(month < startMonth ? startYear + 1 : startYear, month, Number(match[2]));
}

function fairNameFrom(title, body) {
  const sourceText = `${clean(title)} ${clean(body).slice(0, 2400)}`;
  const quoted = [...sourceText.matchAll(/[「『]([^」』]{4,100}?(?:フェア|祭り|まつり))[」』]/g)]
    .map(match => clean(match[1]))
    .filter(value => /はま寿司|旨ねた|まぐろ|中とろ|寿司/.test(value))
    .filter(value => !/X|Twitter|キャンペーン応募|ご優待券/.test(value));
  if (quoted.length) return quoted.sort((a, b) => b.length - a.length)[0];
  const bare = sourceText.match(/(はま寿司[^。！？!?]{2,90}?(?:フェア|祭り|まつり))/);
  return clean(bare?.[1] || '');
}

function taxIncludedPrice(value) {
  const text = clean(value);
  const tax = text.match(/税込\s*([0-9,]+)\s*円/);
  if (tax) return Number(tax[1].replace(/,/g, ''));
  const parenthetical = text.match(/[（(]\s*税込\s*([0-9,]+)\s*円\s*[）)]/);
  if (parenthetical) return Number(parenthetical[1].replace(/,/g, ''));
  const plain = text.match(/([0-9,]+)\s*円/);
  return plain ? Number(plain[1].replace(/,/g, '')) : null;
}

function firstPriceIndex(value) {
  const text = String(value);
  const tax = text.search(/(?:[0-9,]+\s*円\s*)?[（(]?\s*税込\s*[0-9,]+\s*円/);
  if (tax >= 0) return tax;
  return text.search(/[0-9,]+\s*円/);
}

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

function namesBeforePrice(line) {
  const index = firstPriceIndex(line);
  if (index < 0) return [];
  const before = clean(String(line).slice(0, index));
  const quoted = [...before.matchAll(/[「『]([^」』]{2,70})[」』]/g)]
    .map(match => acceptableProductName(match[1]))
    .filter(Boolean);
  if (quoted.length) return quoted.slice(-4);
  if (/^[●◆■◇▶▷・]/.test(before)) {
    const name = acceptableProductName(before);
    return name ? [name] : [];
  }
  return [];
}

function addItem(target, seen, {
  name, price, sourceUrl, startDate, endDate, today, note = null,
}) {
  const safeName = acceptableProductName(name);
  if (!safeName || !Number.isFinite(price) || price <= 0 || price > 10_000) return;
  if (endDate && endDate < today) return;
  const key = `${normalize(safeName)}|${price}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({
    name: safeName,
    price,
    startDate,
    endDate,
    saleStatus: 'active',
    scrapeStatus: 'ok',
    sourceUrl,
    ...(note ? { availabilityNote: note } : {}),
  });
}

function parseItems(html, sourceUrl, startDate, today = jstTodayKey()) {
  const lines = pageLines(html);
  const items = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const segment = [line];
    for (let next = index + 1; next < Math.min(lines.length, index + 4); next += 1) {
      if (/^[●◆■◇▶▷・]/.test(lines[next])) break;
      segment.push(lines[next]);
    }
    const vicinity = segment.join(' ');
    const endDate = parseUntilDate(vicinity, startDate);
    const note = /お持ち帰り(?:不可|できません|いただけません)/.test(vicinity)
      ? 'お持ち帰り不可。店舗・数量などの販売条件は公式告知を確認してください。'
      : null;

    const sameLinePrice = taxIncludedPrice(line);
    if (sameLinePrice) {
      for (const name of namesBeforePrice(line)) {
        addItem(items, seen, { name, price: sameLinePrice, sourceUrl, startDate, endDate, today, note });
      }
    }

    const bullet = line.match(/^[●◆■◇▶▷・]\s*(.{2,90})$/);
    if (!bullet || taxIncludedPrice(line)) continue;
    const name = acceptableProductName(bullet[1]);
    if (!name) continue;
    const priceLine = lines.slice(index + 1, index + 4).find(value => taxIncludedPrice(value));
    const price = priceLine ? taxIncludedPrice(priceLine) : null;
    if (!price) continue;
    addItem(items, seen, { name, price, sourceUrl, startDate, endDate, today, note });
  }

  return items.slice(0, 40);
}

export function parseTopic(html, sourceUrl, today = jstTodayKey()) {
  const $ = cheerio.load(html);
  const title = clean(
    $('meta[property="og:title"]').attr('content')
    || $('h1').first().text()
    || $('title').text(),
  );
  const body = clean($('body').text());
  if (!/はま寿司/.test(`${title} ${body.slice(0, 3000)}`)) return null;

  const fairName = fairNameFrom(title, body);
  if (!fairName) return null;
  if (/お持ち帰り|テイクアウト|福袋|おせち|TVCM|CM公開|Xキャンペーン|フォロー&リポスト|クーポン|ご優待/.test(title)) return null;

  const startDate = parseStartDate(`${title} ${body.slice(0, 3500)}`, today);
  if (!startDate) return null;
  const delta = dayDistance(startDate, today);
  if (delta > MAX_UPCOMING_DAYS) return null;

  const phase = startDate > today ? 'upcoming' : 'active';
  const items = parseItems(html, sourceUrl, startDate, today);
  if (items.length < 3) return null;

  const imageUrl = absoluteUrl(
    $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'),
    sourceUrl,
  );
  return {
    fairName,
    officialCampaignTitle: fairName,
    sourceUrl,
    startDate,
    endDate: null,
    campaignPhase: phase,
    items,
    imageUrl,
  };
}

export function discoverTopicLinks(html, baseUrl, year = Number(jstTodayKey().slice(0, 4))) {
  const $ = cheerio.load(html);
  const found = new Map();

  function add(raw, label = '') {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || !new RegExp(`/topics/${year}/\\d+\\.html(?:$|[?#])`).test(url)) return;
    const score = (
      (/フェア|祭り|まつり|旨ねた|中とろ|まぐろ|寿司/.test(label) ? 30 : 0)
      + (/開催|期間限定/.test(label) ? 10 : 0)
    );
    found.set(url, Math.max(found.get(url) ?? -1, score));
  }

  $('a[href]').each((_, element) => {
    const node = $(element);
    const label = clean(`${node.text()} ${node.find('img[alt]').map((__, img) => $(img).attr('alt') || '').get().join(' ')}`);
    add(node.attr('href'), label);
  });

  const rawPattern = new RegExp(`(?:https?:\\/\\/www\\.hamazushi\\.com)?\\/topics\\/${year}\\/\\d+\\.html`, 'g');
  for (const match of String(html).matchAll(rawPattern)) add(match[0], '');

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
    .map(([url]) => url);
}

export function selectCurrent(candidates, today = jstTodayKey()) {
  const viable = candidates.filter(candidate => {
    if (!candidate?.startDate) return false;
    const phase = campaignPhase(candidate, today);
    return phase === 'active' || (phase === 'upcoming' && dayDistance(candidate.startDate, today) <= MAX_UPCOMING_DAYS);
  });
  viable.sort((a, b) => {
    const aPhase = campaignPhase(a, today);
    const bPhase = campaignPhase(b, today);
    if (aPhase !== bPhase) return aPhase === 'active' ? -1 : 1;
    return aPhase === 'active'
      ? String(b.startDate).localeCompare(String(a.startDate))
      : String(a.startDate).localeCompare(String(b.startDate));
  });
  return viable[0] || null;
}

async function discoverCurrentTopic(today = jstTodayKey()) {
  const year = Number(today.slice(0, 4));
  const archive = new URL(`${year}.html`, TOPICS).href;
  const urls = new Set();

  for (const indexUrl of [HOME, archive]) {
    try {
      for (const url of discoverTopicLinks(await fetchHtml(indexUrl), indexUrl, year)) urls.add(url);
    } catch (error) {
      console.warn(`Hamazushi topic index unavailable (${indexUrl}): ${error.message}`);
    }
  }
  const candidateUrls = [FALLBACK_TOPIC, ...urls].filter((url, index, all) => all.indexOf(url) === index);

  const candidates = [];
  for (const url of candidateUrls.slice(0, MAX_CANDIDATES)) {
    try {
      const parsed = parseTopic(await fetchHtml(url, 1), url, today);
      if (parsed) candidates.push(parsed);
    } catch (error) {
      console.warn(`Hamazushi topic skipped (${url}): ${error.message}`);
    }
  }
  return selectCurrent(candidates, today);
}

function applyTopic(chain, topic) {
  const upcoming = topic.campaignPhase === 'upcoming';
  return {
    ...chain,
    fairName: topic.fairName,
    startDate: topic.startDate,
    endDate: topic.endDate,
    items: topic.items,
    sourceUrl: MENU,
    officialCampaignTitle: topic.officialCampaignTitle,
    officialCampaignUrl: topic.sourceUrl,
    fairNameSource: 'official_topic_page',
    campaignPhase: topic.campaignPhase,
    imageUrl: topic.imageUrl || chain.imageUrl || null,
    representativeImageUrl: topic.imageUrl || chain.representativeImageUrl || chain.imageUrl || null,
    representativeImageSource: topic.imageUrl ? 'official_topic_og' : (chain.representativeImageSource || 'official_food_or_fair_image'),
    representativeImageProduct: topic.items[0]?.name || chain.representativeImageProduct || null,
    representativeImagePage: topic.sourceUrl,
    dataScope: 'national_official_topic',
    status: upcoming ? 'warning' : 'ok',
    message: upcoming ? `公式発表済み。${topic.startDate.slice(5).replace('-', '/')}開始予定のフェアです。` : null,
    priceNote: 'はま寿司公式トピックス掲載の税込価格です。店舗により価格・取扱い・販売条件が異なる場合があります。',
  };
}

function runSelfTests() {
  const fixture = `<!doctype html><html><head>
    <meta property="og:title" content="とろけるような味わいの中とろが今だけ100円（税込110円）！「はま寿司の中とろ100円と大漁！旨ねた祭り」開催！">
    <meta property="og:image" content="/assets/current.jpg">
  </head><body>
    <h1>「はま寿司の中とろ100円と大漁！旨ねた祭り」開催！</h1>
    <p>はま寿司は、9月8日（火）より「はま寿司の中とろ100円と大漁！旨ねた祭り」を全国の店舗で開催します。</p>
    <p>「厳選まぐろ中とろ」を期間限定で、100円（税込110円）でご提供します。</p>
    <p>「大葉真いか握り」、「厚切りつぶ貝」を100円（税込110円）でご提供します。</p>
    <p>●炙り厳選まぐろ中とろゆず塩</p><p>100円（税込110円）</p><p>※9/15（火）まで販売</p>
    <p>●宮城県産さんま 160円（税込176円）</p>
    <p>●アカイカ 大分県産かぼすおろし 160円（税込176円） ※お持ち帰り不可</p>
  </body></html>`;
  const parsed = parseTopic(fixture, 'https://www.hamazushi.com/topics/2026/0907000856.html', '2026-09-09');
  assert.equal(parsed.fairName, 'はま寿司の中とろ100円と大漁！旨ねた祭り');
  assert.equal(parsed.startDate, '2026-09-08');
  assert.equal(parsed.campaignPhase, 'active');
  assert.ok(parsed.items.some(item => item.name === '厳選まぐろ中とろ' && item.price === 110));
  assert.ok(parsed.items.some(item => item.name === '大葉真いか握り' && item.price === 110));
  assert.ok(parsed.items.some(item => item.name === '厚切りつぶ貝' && item.price === 110));
  assert.equal(parsed.items.find(item => item.name === '炙り厳選まぐろ中とろゆず塩')?.endDate, '2026-09-15');

  const links = discoverTopicLinks(
    '<a href="/topics/2026/0907000856.html"><img alt="中とろ100円と大漁！旨ねた祭り"></a>',
    'https://www.hamazushi.com/',
    2026,
  );
  assert.deepEqual(links, ['https://www.hamazushi.com/topics/2026/0907000856.html']);

  const selected = selectCurrent([
    { startDate: '2026-09-01', endDate: null },
    { startDate: '2026-09-08', endDate: null },
  ], '2026-09-09');
  assert.equal(selected.startDate, '2026-09-08');
  console.log('Hamazushi current-topic self-tests passed.');
}

async function main() {
  runSelfTests();
  const data = JSON.parse(await fs.readFile(FAIR_PATH, 'utf8'));
  const index = (data.chains || []).findIndex(chain => chain.chain === 'hamazushi');
  if (index < 0) throw new Error('Hamazushi chain row missing');

  try {
    const topic = await discoverCurrentTopic();
    if (!topic) {
      data.chains[index] = {
        ...data.chains[index],
        status: 'warning',
        message: 'はま寿司の現行公式フェアトピックを確認できませんでした。品質ゲートで前回検証済みデータへのフォールバック可否を判定します。',
      };
      console.warn('::warning title=Hamazushi official topic::No current/upcoming official fair topic could be verified');
    } else {
      data.chains[index] = applyTopic(data.chains[index], topic);
      console.log(`Hamazushi official topic: ${topic.fairName} (${topic.startDate}, ${topic.items.length} items)`);
    }
  } catch (error) {
    data.chains[index] = {
      ...data.chains[index],
      status: 'warning',
      message: `はま寿司の公式フェア取得に失敗しました。品質ゲートで前回検証済みデータへのフォールバック可否を判定します: ${error.message}`,
    };
    console.warn(`::warning title=Hamazushi official topic::${error.message}`);
  }

  data.updatedAt = new Date().toISOString();
  await fs.writeFile(FAIR_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
