import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const SOURCES = {
  kappasushi: {
    companyId: '18731',
    companySuffix: '000018731',
    verifiedCurrentUrl: 'https://prtimes.jp/main/html/rd/p/000001186.000018731.html',
    officialFairUrl: 'https://www.kappasushi.jp/campaign_list/',
    fallbackFairName: 'かっぱ寿司期間限定フェア',
  },
  uobei: {
    companyId: '20954',
    companySuffix: '000020954',
    verifiedCurrentUrl: 'https://prtimes.jp/main/html/rd/p/000000240.000020954.html',
    officialFairUrl: 'https://www.uobei.info/menu/',
    fallbackFairName: '魚べい期間限定フェア',
  },
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function parseDateRange(text, defaultYear) {
  const value = clean(text);
  const full = value.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9～〜~\-–—]{0,20}[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (full) {
    const startYear = Number(full[1]);
    const startMonth = Number(full[2]);
    const endMonth = Number(full[5]);
    const endYear = Number(full[4] || (endMonth < startMonth ? startYear + 1 : startYear));
    return {
      startDate: isoDate(startYear, startMonth, Number(full[3])),
      endDate: isoDate(endYear, endMonth, Number(full[6])),
    };
  }
  const open = value.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日[^～〜~\-–—]{0,20}[～〜~\-–—]\s*(?:なくなり次第終了|売り切れ次第終了|予定数量に達し次第終了)/);
  if (open) {
    return {
      startDate: isoDate(Number(open[1] || defaultYear), Number(open[2]), Number(open[3])),
      endDate: null,
    };
  }
  return { startDate:null, endDate:null };
}

function findReleaseRange(lines, year) {
  for (let index = 0; index < Math.min(lines.length, 120); index += 1) {
    const line = lines[index];
    if (!/(?:開催|販売|キャンペーン)期間/.test(line) && !/[～〜~\-–—]/.test(line)) continue;
    for (const candidate of [line, ...lines.slice(index + 1, index + 3)]) {
      const range = parseDateRange(candidate, year);
      if (range.startDate) return range;
    }
  }
  return { startDate:null, endDate:null };
}

function isActive(range, today = jstTodayKey()) {
  return Boolean(range?.startDate && range.startDate <= today && (!range.endDate || today <= range.endDate));
}

function parsePricedLine(line) {
  const value = clean(line).replace(/^[-・●■◆◇▶▷※]+\s*/, '');
  if (!value || /販売期間|販売店舗|対象店舗|価格は異な|店舗により|セット内容|応募|クーポン/.test(value)) return null;
  const tax = value.match(/[（(]\s*税込\s*([\d,]+)\s*円\s*[）)]/);
  if (!tax || tax.index == null) return null;
  const price = Number(tax[1].replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) return null;
  let name = value.slice(0, tax.index).trim()
    .replace(/[／/]\s*(?:\d+|一|二|三|四|五)?\s*貫?\s*[\d,]+\s*円\s*$/, '')
    .replace(/\s+(?:\d+|一|二|三|四|五)\s*貫\s*[\d,]+\s*円\s*$/, '')
    .replace(/\s+[\d,]+\s*円\s*$/, '')
    .replace(/^(?:Image|画像)\s*/i, '')
    .trim();
  if (!name || name.length > 90) return null;
  return { name, price };
}

function normalizedName(value = '') {
  return clean(value)
    .replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g, '')
    .toLowerCase();
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${normalizedName(item.name)}|${item.price ?? ''}`;
    if (!item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findFairName(title, body, fallback) {
  const source = `${title} ${body.slice(0, 1600)}`;
  const quoted = [...source.matchAll(/[「『]([^」』]{2,80}?(?:フェア|祭り|キャンペーン))[」』]/g)]
    .map(match => clean(match[1]))
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  if (quoted.length) return quoted[0];
  const bare = clean(source).match(/([^。！？!?]{2,70}?(?:フェア|祭り|キャンペーン))/);
  return clean(bare?.[1] || fallback);
}

function parseRelease(html, chain, sourceUrl, today = jstTodayKey()) {
  const config = SOURCES[chain];
  const $ = cheerio.load(html);
  const lines = pageLines(html);
  const body = lines.join(' ');
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text() || lines[0] || '');
  const year = Number(body.match(/(20\d{2})\s*年/)?.[1] || today.slice(0, 4));
  const range = findReleaseRange(lines, year);
  if (!isActive(range, today)) return null;

  const correctBrand = chain === 'uobei'
    ? /魚べい/.test(body) && /全国の魚べい/.test(body)
    : /かっぱ寿司/.test(body) && /かっぱ寿司全店|全国/.test(body);
  if (!correctBrand) return null;

  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const product = parsePricedLine(lines[index]);
    if (!product) continue;
    items.push({
      ...product,
      startDate: range.startDate,
      endDate: range.endDate,
      saleStatus: 'active',
      scrapeStatus: 'ok',
    });
  }
  const unique = dedupeItems(items).slice(0, 40);
  if (!unique.length) return null;

  return {
    chain,
    fairName: findFairName(title, body, config.fallbackFairName),
    startDate: range.startDate,
    endDate: range.endDate,
    items: unique,
    sourceUrl: config.officialFairUrl,
    officialReleaseUrl: sourceUrl,
    imageUrl: absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl),
    status: 'ok',
    message: null,
    priceNote: '公式発表の掲載価格です。地域・店舗により価格や取扱いが異なる場合があります。',
    dataScope: 'national_official_release',
  };
}

function discoverReleaseUrls(indexHtml, config, indexUrl) {
  const urls = [];
  const $ = cheerio.load(indexHtml);
  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), indexUrl);
    if (href && href.includes('/main/html/rd/p/') && href.includes(`.${config.companySuffix}.html`)) urls.push(href);
  });

  const rawPattern = new RegExp(`(?:https:\\/\\/prtimes\\.jp)?\\/main\\/html\\/rd\\/p\\/\\d+\\.${config.companySuffix}\\.html`, 'g');
  for (const match of String(indexHtml).matchAll(rawPattern)) {
    const href = absoluteUrl(match[0], indexUrl);
    if (href) urls.push(href);
  }

  // Current exact release is a verified official-company fallback. It prevents a
  // presentation-only change on the company archive from making an active fair disappear.
  urls.push(config.verifiedCurrentUrl);
  return [...new Set(urls)];
}

async function findCurrentRelease(chain, today = jstTodayKey()) {
  const config = SOURCES[chain];
  const indexUrl = `https://prtimes.jp/main/html/searchrlp/company_id/${config.companyId}`;
  let urls = [config.verifiedCurrentUrl];
  try {
    urls = discoverReleaseUrls(await fetchHtml(indexUrl), config, indexUrl);
  } catch (error) {
    console.warn(`${chain} PR TIMES index unavailable; verified current release fallback will be used: ${error.message}`);
  }

  for (const url of urls.slice(0, 30)) {
    try {
      const release = parseRelease(await fetchHtml(url, 1), chain, url, today);
      if (release) return release;
    } catch {}
  }
  return null;
}

function cleanKuraItems(chain) {
  const seen = new Set();
  return {
    ...chain,
    items: (chain.items || []).filter(item => {
      const name = clean(item?.name || '');
      if (!name || /対象商品|キャンペーン対象|クーポン/.test(name)) return false;
      const key = `${normalizedName(name)}|${item.price ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

async function main() {
  const today = jstTodayKey();
  const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
  const byChain = Object.fromEntries((data.chains || []).map(chain => [chain.chain, chain]));

  byChain.kurasushi = cleanKuraItems(byChain.kurasushi || { chain:'kurasushi', items:[] });

  for (const chain of ['kappasushi', 'uobei']) {
    const release = await findCurrentRelease(chain, today);
    if (release) {
      byChain[chain] = {
        ...(byChain[chain] || {}),
        ...release,
        storeName: '選択地域',
        referenceStoreName: byChain[chain]?.referenceStoreName || null,
        officialActionLabel: '混雑・順番待ち・予約を公式で確認',
        officialActionUrl: byChain[chain]?.officialActionUrl || (chain === 'uobei' ? 'https://www.uobei.info/' : 'https://www.kappasushi.jp/shop/'),
        regionalModel: byChain[chain]?.regionalModel || {
          strategyKey: chain === 'uobei' ? 'priceClass' : 'menuType',
          label: chain === 'uobei' ? '通常／都心型／超都心型' : '店舗メニュータイプ',
          priceVariesByLocation: true,
        },
      };
    }
  }

  data.chains = ['sushiro', 'hamazushi', 'kurasushi', 'kappasushi', 'uobei']
    .map(chain => byChain[chain])
    .filter(Boolean);
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);

  const kappa = byChain.kappasushi;
  const uobei = byChain.uobei;
  console.log(`Fixed national releases: Kappa ${kappa?.items?.length || 0}, Uobei ${uobei?.items?.length || 0}, Kura ${byChain.kurasushi?.items?.length || 0}`);
}

function runSelfTests() {
  const uobeiHtml = `<!doctype html><html><head><meta property="og:title" content="希少ネタから大人気ネタまで集結「豪華ネタフェア」開催"></head><body>
    <p>株式会社は『豪華ネタフェア』を全国の魚べい、元気寿司で開催いたします。</p>
    <p>■開催期間 2026年8月4日(火)～なくなり次第終了</p>
    <p>■対象店舗 全国の魚べい、元気寿司</p>
    <h3>すけそう鱈／2貫100円（税込110円）</h3>
    <h3>のどぐろ／1貫180円（税込198円）</h3>
  </body></html>`;
  const uobei = parseRelease(uobeiHtml, 'uobei', SOURCES.uobei.verifiedCurrentUrl, '2026-08-25');
  assert.equal(uobei.fairName, '豪華ネタフェア');
  assert.deepEqual(uobei.items.map(item => [item.name, item.price]), [['すけそう鱈', 110], ['のどぐろ', 198]]);

  const kappaHtml = `<!doctype html><html><head><meta property="og:title" content="「かっぱの百十円満点祭り」開催！"></head><body>
    <p>かっぱ寿司は「かっぱの百十円満点祭り」をかっぱ寿司全店にて開催いたします。</p>
    <p>販売期間：2026年8月20日（木）～9月2日（水）予定</p>
    <h3>厳選びん長まぐろ　二貫100円（税込110円）</h3>
  </body></html>`;
  const kappa = parseRelease(kappaHtml, 'kappasushi', SOURCES.kappasushi.verifiedCurrentUrl, '2026-08-25');
  assert.equal(kappa.fairName, 'かっぱの百十円満点祭り');
  assert.equal(kappa.items[0].price, 110);

  const cleaned = cleanKuraItems({ items:[
    { name:'うなぎ(一貫)', price:110 },
    { name:'・対象商品：「うなぎ（一貫）」', price:110 },
  ]});
  assert.equal(cleaned.items.length, 1);
  console.log('National release fix self-tests passed.');
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
