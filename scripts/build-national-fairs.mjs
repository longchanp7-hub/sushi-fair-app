import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const PREVIOUS_PATH = process.env.PREVIOUS_FAIRS || '';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const PR_TIMES = {
  kappasushi: { companyId: '18731', companySuffix: '000018731' },
  uobei: { companyId: '20954', companySuffix: '000020954' },
};

const ACTION_URLS = {
  sushiro: 'https://www.akindo-sushiro.co.jp/shop/',
  hamazushi: 'https://maps.hama-sushi.co.jp/jp/index.html',
  kurasushi: 'https://shop.kurasushi.co.jp/',
  kappasushi: 'https://www.kappasushi.jp/shop/',
  uobei: 'https://www.uobei.info/',
};

const FAIR_URLS = {
  sushiro: 'https://www.akindo-sushiro.co.jp/campaign/',
  hamazushi: 'https://www.hamazushi.com/menu/',
  kurasushi: 'https://www.kurasushi.co.jp/menu/',
  kappasushi: 'https://www.kappasushi.jp/campaign_list/',
  uobei: 'https://www.uobei.info/menu/',
};

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, baseUrl) {
  try { return value ? new URL(value, baseUrl).href : null; } catch { return null; }
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function jstTodayKey(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const m = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${m.year}-${m.month}-${m.day}`;
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
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 900 * attempt));
    }
  }
  throw lastError;
}

function parseDateRange(text, defaultYear) {
  const value = clean(text);
  const full = value.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9～〜~\-–—]{0,14}[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (full) {
    const startYear = Number(full[1]);
    const startMonth = Number(full[2]);
    const endMonth = Number(full[5]);
    const endYear = Number(full[4] || (endMonth < startMonth ? startYear + 1 : startYear));
    return { startDate: isoDate(startYear, startMonth, Number(full[3])), endDate: isoDate(endYear, endMonth, Number(full[6])) };
  }
  const short = value.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9～〜~\-–—]{0,14}[～〜~\-–—]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (short) {
    const startYear = Number(defaultYear);
    const startMonth = Number(short[1]);
    const endMonth = Number(short[3]);
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;
    return { startDate: isoDate(startYear, startMonth, Number(short[2])), endDate: isoDate(endYear, endMonth, Number(short[4])) };
  }
  const open = value.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日[^～〜~\-–—]{0,14}[～〜~\-–—]\s*(?:なくなり次第終了|売り切れ次第終了|予定数量に達し次第終了)/);
  if (open) {
    return { startDate: isoDate(Number(open[1] || defaultYear), Number(open[2]), Number(open[3])), endDate: null };
  }
  const startOnly = value.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return startOnly
    ? { startDate: isoDate(Number(startOnly[1] || defaultYear), Number(startOnly[2]), Number(startOnly[3])), endDate: null }
    : { startDate: null, endDate: null };
}

function isActive(range, today = jstTodayKey()) {
  if (!range?.startDate) return false;
  return range.startDate <= today && (!range.endDate || today <= range.endDate);
}

function parsePricedLine(line) {
  const value = clean(line)
    .replace(/^[-・●■◆◇▶▷※]+\s*/, '')
    .replace(/〖[^〗]{1,30}〗\s*/, match => match);
  if (!value || /販売期間|販売店舗|対象店舗|価格は異な|店舗により|セット内容|応募|クーポン/.test(value)) return null;
  const tax = value.match(/[（(]\s*税込\s*([\d,]+)\s*円\s*[）)]/);
  if (!tax) return null;
  const price = Number(tax[1].replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) return null;
  let name = value.slice(0, tax.index).trim();
  name = name
    .replace(/[／/]\s*(?:\d+|一|二|三|四|五)?\s*貫?\s*[\d,]+\s*円\s*$/, '')
    .replace(/\s+(?:\d+|一|二|三|四|五)\s*貫\s*[\d,]+\s*円\s*$/, '')
    .replace(/\s+[\d,]+\s*円\s*$/, '')
    .replace(/^(?:Image|画像)\s*/i, '')
    .trim();
  if (!name || name.length > 90 || /^(?:商品|価格|税込)$/.test(name)) return null;
  return { name, price };
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

function findReleaseRange(lines, fallbackYear) {
  for (let index = 0; index < Math.min(lines.length, 80); index += 1) {
    if (!/(?:開催|販売|キャンペーン)期間/.test(lines[index])) continue;
    for (const candidate of [lines[index], ...lines.slice(index + 1, index + 4)]) {
      const range = parseDateRange(candidate, fallbackYear);
      if (range.startDate) return range;
    }
  }
  const dated = lines.slice(0, 100).find(line => /[～〜~\-–—]/.test(line) && /月\s*\d{1,2}\s*日/.test(line));
  return dated ? parseDateRange(dated, fallbackYear) : { startDate: null, endDate: null };
}

function findFairName(text, fallback = '期間限定フェア') {
  const candidates = [...String(text).matchAll(/[「『]([^」』]{2,70}?(?:フェア|祭り|キャンペーン))[」』]/g)]
    .map(match => clean(match[1]))
    .filter(Boolean);
  if (candidates.length) return candidates.sort((a, b) => a.length - b.length)[0];
  const bare = clean(text).match(/([^。！？!?]{2,60}?(?:フェア|祭り|キャンペーン))/);
  return clean(bare?.[1] || fallback);
}

function parsePressRelease(html, { chain, sourceUrl, today = jstTodayKey() }) {
  const $ = cheerio.load(html);
  const lines = pageLines(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text() || lines[0] || '');
  const body = lines.join(' ');
  const yearMatch = body.match(/(20\d{2})\s*年/);
  const year = Number(yearMatch?.[1] || today.slice(0, 4));
  const range = findReleaseRange(lines, year);
  if (!isActive(range, today)) return null;
  const brandOk = chain === 'uobei'
    ? /魚べい/.test(body) && /全国の魚べい/.test(body)
    : /かっぱ寿司/.test(body) && /かっぱ寿司全店|全国/.test(body);
  if (!brandOk) return null;
  const fairName = findFairName(`${title} ${body.slice(0, 1200)}`, chain === 'uobei' ? '魚べい期間限定フェア' : 'かっぱ寿司期間限定フェア');
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const product = parsePricedLine(lines[index]);
    if (!product) continue;
    const nearby = lines.slice(index + 1, index + 5).find(line => /販売期間/.test(line));
    const itemRange = nearby ? parseDateRange(nearby, year) : { startDate: range.startDate, endDate: range.endDate };
    if (!itemRange.startDate) Object.assign(itemRange, range);
    if (itemRange.startDate && itemRange.startDate > today) continue;
    if (itemRange.endDate && itemRange.endDate < today) continue;
    items.push({ ...product, startDate:itemRange.startDate, endDate:itemRange.endDate, saleStatus:'active', scrapeStatus:'ok' });
  }
  const unique = dedupeItems(items).slice(0, 40);
  if (!unique.length) return null;
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl);
  return {
    chain, fairName, startDate:range.startDate, endDate:range.endDate, items:unique,
    sourceUrl: FAIR_URLS[chain], officialReleaseUrl: sourceUrl, imageUrl,
    status:'ok', message:null,
    priceNote:'公式発表の掲載価格です。地域・店舗により価格や取扱いが異なる場合があります。',
    dataScope:'national_official_release',
  };
}

async function fetchLatestPressRelease(chain, today = jstTodayKey()) {
  const config = PR_TIMES[chain];
  const indexUrl = `https://prtimes.jp/main/html/searchrlp/company_id/${config.companyId}`;
  const html = await fetchHtml(indexUrl);
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), indexUrl);
    const text = clean($(element).text());
    if (!href || !href.includes('/main/html/rd/p/') || !href.includes(`.${config.companySuffix}.html`)) return;
    if (chain === 'uobei' && !/魚べい/.test(text)) return;
    if (chain === 'kappasushi' && !/かっぱ寿司|かっぱの/.test(text)) return;
    links.push(href);
  });
  for (const url of [...new Set(links)].slice(0, 18)) {
    try {
      const parsed = parsePressRelease(await fetchHtml(url, 1), { chain, sourceUrl:url, today });
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}

function normalizeFairKey(value = '') {
  return clean(value).replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g, '').toLowerCase();
}

async function enrichKura(chain, today = jstTodayKey()) {
  if (chain?.items?.some(item => item?.price != null)) return chain;
  const year = Number(chain?.startDate?.slice(0, 4) || today.slice(0, 4));
  const indexUrl = `https://www.kurasushi.co.jp/author/${year}.html`;
  const indexHtml = await fetchHtml(indexUrl);
  const $ = cheerio.load(indexHtml);
  const target = normalizeFairKey(chain?.fairName || '').replace(/フェア$/, '');
  const candidates = [];
  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), indexUrl);
    if (!href || !/\/author\/\d+\.html/.test(href)) return;
    const key = normalizeFairKey(clean($(element).text()));
    if (target && key.includes(target)) candidates.push(href);
  });
  for (const url of [...new Set(candidates)].slice(0, 5)) {
    try {
      const html = await fetchHtml(url, 1);
      const lines = pageLines(html);
      const items = [];
      const defaultYear = Number(chain.startDate?.slice(0, 4) || year);
      for (let index = 0; index < lines.length; index += 1) {
        const m = lines[index].match(/^(.{2,80}?)\s+([\d,]+)\s*円\s*$/);
        if (!m || /クーポン|割引|合計|セット/.test(m[1])) continue;
        const price = Number(m[2].replace(/,/g, ''));
        if (!Number.isFinite(price)) continue;
        const periodLine = lines.slice(index + 1, index + 4).find(line => /販売期間/.test(line));
        const range = periodLine ? parseDateRange(periodLine, defaultYear) : { startDate:chain.startDate, endDate:chain.endDate };
        if (range.startDate && range.startDate > today) continue;
        if (range.endDate && range.endDate < today) continue;
        items.push({ name:clean(m[1]), price, ...range, saleStatus:'active', scrapeStatus:'ok' });
      }
      const unique = dedupeItems(items).slice(0, 30);
      if (unique.length) {
        const $$ = cheerio.load(html);
        return {
          ...chain, items:unique, sourceUrl:url,
          imageUrl:absoluteUrl($$('meta[property="og:image"]').attr('content'), url) || chain.imageUrl || null,
          status:'ok', message:null,
          priceNote:'公式プレスリリース掲載価格です。店舗により価格が異なる場合があります。',
          dataScope:'national_official_release',
        };
      }
    } catch {}
  }
  return chain;
}

async function enrichSushiroDates(chain) {
  if (!chain?.sourceUrl || !chain?.items?.length) return chain;
  try {
    const lines = pageLines(await fetchHtml(chain.sourceUrl, 1));
    const year = Number(jstTodayKey().slice(0, 4));
    const items = chain.items.map(item => {
      const index = lines.findIndex(line => clean(line) === clean(item.name));
      if (index < 0) return { ...item, saleStatus:'active', scrapeStatus:'ok' };
      const rangeLine = lines.slice(index + 1, index + 8).find(line => /\d{1,2}\/\d{1,2}.*[～〜~\-–—].*\d{1,2}\/\d{1,2}/.test(line));
      const m = rangeLine?.match(/(\d{1,2})\/(\d{1,2}).*?[～〜~\-–—].*?(\d{1,2})\/(\d{1,2})/);
      if (!m) return { ...item, saleStatus:'active', scrapeStatus:'ok' };
      return { ...item, startDate:isoDate(year,Number(m[1]),Number(m[2])), endDate:isoDate(year,Number(m[3]),Number(m[4])), saleStatus:'active', scrapeStatus:'ok' };
    });
    return { ...chain, items };
  } catch { return chain; }
}

function mergeSushiroMissing(current, previous, today = jstTodayKey()) {
  if (!previous?.items?.length) return current;
  const names = new Set((current.items || []).map(item => clean(item.name)));
  const carried = previous.items.filter(item => {
    if (!item?.name || names.has(clean(item.name))) return false;
    if (!item.endDate || item.endDate < today) return false;
    return true;
  }).map(item => ({ ...item, scrapeStatus:'not_listed_reference_store', availabilityNote:'代表店舗で今回未掲載ですが、公式販売期間内のため全国フェア候補として保持しています。' }));
  return { ...current, items:dedupeItems([...(current.items || []), ...carried]) };
}

function decorateChain(chain, today = jstTodayKey()) {
  const strategy = {
    sushiro:{ key:'representativeStoreId', label:'店舗別メニュー・価格' },
    hamazushi:{ key:'regionCode', label:'地域区分＋都市型価格' },
    kurasushi:{ key:'priceTier', label:'店舗価格帯＋提供エリア' },
    kappasushi:{ key:'menuType', label:'店舗メニュータイプ' },
    uobei:{ key:'priceClass', label:'通常／都心型／超都心型' },
  }[chain.chain];
  const scope = chain.dataScope || (chain.chain === 'sushiro' ? 'reference_store_menu_overlay' : chain.chain === 'hamazushi' ? 'official_menu_with_regional_variation' : 'national_fair_with_regional_variation');
  return {
    ...chain,
    referenceStoreName:chain.storeName || chain.referenceStoreName || null,
    storeName:'選択地域', dataScope:scope,
    sourceUrl:chain.sourceUrl || FAIR_URLS[chain.chain],
    officialActionLabel:'混雑・順番待ち・予約を公式で確認',
    officialActionUrl:ACTION_URLS[chain.chain],
    regionalModel:{ strategyKey:strategy.key, label:strategy.label, priceVariesByLocation:true },
    items:(chain.items || []).map(item => ({ ...item, saleStatus:item.endDate && item.endDate < today ? 'ended' : (item.saleStatus || 'active'), scrapeStatus:item.scrapeStatus || 'ok' })),
  };
}

async function readPrevious() {
  if (!PREVIOUS_PATH) return null;
  try { return JSON.parse(await fs.readFile(PREVIOUS_PATH, 'utf8')); } catch { return null; }
}

async function build() {
  const today = jstTodayKey();
  const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
  const previous = await readPrevious();
  const previousByChain = Object.fromEntries((previous?.chains || []).map(chain => [chain.chain, chain]));
  const byChain = Object.fromEntries((data.chains || []).map(chain => [chain.chain, chain]));
  if (byChain.sushiro) {
    byChain.sushiro = await enrichSushiroDates(byChain.sushiro);
    byChain.sushiro = mergeSushiroMissing(byChain.sushiro, previousByChain.sushiro, today);
  }
  if (byChain.kurasushi) byChain.kurasushi = await enrichKura(byChain.kurasushi, today);
  try {
    const kappa = await fetchLatestPressRelease('kappasushi', today);
    if (kappa) byChain.kappasushi = { ...byChain.kappasushi, ...kappa };
  } catch (error) { console.warn(`Kappa national release enrichment skipped: ${error.message}`); }
  try {
    const uobei = await fetchLatestPressRelease('uobei', today);
    if (uobei) byChain.uobei = uobei;
  } catch (error) { console.warn(`Uobei release enrichment skipped: ${error.message}`); }
  if (!byChain.uobei && previousByChain.uobei) byChain.uobei = { ...previousByChain.uobei, status:'warning', message:'魚べい公式リリースの再取得に失敗したため前回確認済みデータを表示しています。' };
  if (!byChain.uobei) byChain.uobei = { chain:'uobei', storeName:'選択地域', fairName:'最新フェア確認中', startDate:null, endDate:null, items:[], sourceUrl:'https://www.uobei.info/menu/', imageUrl:null, status:'warning', message:'魚べいの公式フェア情報を取得中です。' };
  const order = ['sushiro','hamazushi','kurasushi','kappasushi','uobei'];
  const output = {
    schemaVersion:2, updatedAt:new Date().toISOString(), timezone:'Asia/Tokyo',
    locationModel:{ mode:'manual_prefecture_city', gps:false, storage:'localStorage' },
    chains:order.map(key => decorateChain(byChain[key], today)).filter(Boolean),
  };
  await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Built nationwide fairs: ${output.chains.map(c => `${c.chain}:${c.items.length}`).join(', ')}`);
}

function runSelfTests() {
  assert.deepEqual(parseDateRange('販売期間：2026年8月20日（木）～9月2日（水）予定', 2026), { startDate:'2026-08-20', endDate:'2026-09-02' });
  const p1 = parsePricedLine('厳選びん長まぐろ　二貫100円（税込110円）');
  assert.equal(p1.name, '厳選びん長まぐろ'); assert.equal(p1.price, 110);
  const p2 = parsePricedLine('すけそう鱈／2貫100円（税込110円）');
  assert.equal(p2.name, 'すけそう鱈'); assert.equal(p2.price, 110);
  const sample = `<!doctype html><html><head><meta property="og:title" content="豪華ネタフェア"></head><body><p>株式会社は全国の魚べい、元気寿司で『豪華ネタフェア』を開催します。</p><p>■開催期間 2026年8月4日(火)～なくなり次第終了</p><p>■対象店舗 全国の魚べい、元気寿司</p><p>すけそう鱈／2貫100円（税込110円）</p><p>のどぐろ／1貫180円（税込198円）</p></body></html>`;
  const parsed = parsePressRelease(sample, { chain:'uobei', sourceUrl:'https://example.test/release', today:'2026-08-25' });
  assert.equal(parsed.fairName, '豪華ネタフェア'); assert.equal(parsed.items.length, 2);
  console.log('Nationwide fair self-tests passed.');
}

if (process.argv.includes('--self-test')) runSelfTests();
else await build();
