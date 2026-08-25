import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalized(value = '') {
  return clean(value)
    .replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g, '')
    .toLowerCase();
}

function absoluteUrl(value, baseUrl) {
  try { return value ? new URL(value, baseUrl).href : null; } catch { return null; }
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function fetchHtml(url) {
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

function parseJapaneseRange(text, defaultYear) {
  const value = clean(text);
  const full = value.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?\s*[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!full) return { startDate:null, endDate:null };
  const startYear = Number(full[1] || defaultYear);
  const startMonth = Number(full[2]);
  const endMonth = Number(full[5]);
  const endYear = Number(full[4] || (endMonth < startMonth ? startYear + 1 : startYear));
  return {
    startDate: isoDate(startYear, startMonth, Number(full[3])),
    endDate: isoDate(endYear, endMonth, Number(full[6])),
  };
}

function cleanKappaName(value = '') {
  let name = clean(value);
  if (!name || /では、|人気のネタから|対象商品|キャンペーン対象|クーポン|店舗により/.test(name)) return null;
  name = name
    .replace(/(?:一|二|三|四|五|六|七|八|九|十|\d+)\s*貫\s*[\d,]+\s*円\s*$/, '')
    .replace(/[\d,]+\s*円\s*$/, '')
    .trim();
  return name || null;
}

function cleanKappa(chain) {
  if (!chain) return chain;
  const seen = new Set();
  const items = [];
  for (const item of chain.items || []) {
    const name = cleanKappaName(item?.name || '');
    if (!name) continue;
    const key = `${normalized(name)}|${item.price ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...item, name });
  }
  return { ...chain, items };
}

function kuraProductLine(line) {
  const value = clean(line);
  if (!value || /対象商品|クーポン|販売期間|価格は|店舗により/.test(value)) return null;
  const match = value.match(/^(.{2,90}?)\s+([\d,]+)\s*円\s*$/);
  if (!match) return null;
  const price = Number(match[2].replace(/,/g, ''));
  const name = clean(match[1]);
  return name && Number.isFinite(price) && price > 0 ? { name, price } : null;
}

function parseKuraFairRelease(html, existing, sourceUrl) {
  const lines = pageLines(html);
  const year = Number(existing.startDate?.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const product = kuraProductLine(lines[index]);
    if (!product) continue;
    const periodLine = lines.slice(index + 1, index + 4).find(line => /販売期間/.test(line));
    if (!periodLine) continue;
    const range = parseJapaneseRange(periodLine, year);
    if (range.startDate !== existing.startDate || range.endDate !== existing.endDate) continue;
    items.push({ ...product, ...range, saleStatus:'active', scrapeStatus:'ok' });
  }

  const seen = new Set();
  const unique = items.filter(item => {
    const key = `${normalized(item.name)}|${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!unique.length) return null;

  const $ = cheerio.load(html);
  return {
    ...existing,
    items: unique,
    sourceUrl,
    imageUrl: absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl) || existing.imageUrl || null,
    status: 'ok',
    message: null,
    priceNote: '公式プレスリリース掲載価格です。店舗により価格が異なる場合があります。',
    dataScope: 'national_official_release',
  };
}

async function findKuraRelease(existing) {
  if (!existing?.fairName || !existing?.startDate || !existing?.endDate) return null;
  const year = Number(existing.startDate.slice(0, 4));
  const indexUrl = `https://www.kurasushi.co.jp/author/${year}.html`;
  const html = await fetchHtml(indexUrl);
  const $ = cheerio.load(html);
  const target = normalized(existing.fairName).replace(/フェア$/, '');
  const urls = [];

  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), indexUrl);
    const text = normalized($(element).text());
    if (!href || !/\/author\/\d+\.html/.test(href)) return;
    if (target && text.includes(target)) urls.push(href);
  });

  for (const url of [...new Set(urls)].slice(0, 8)) {
    try {
      const parsed = parseKuraFairRelease(await fetchHtml(url), existing, url);
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}

async function main() {
  const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
  const byChain = Object.fromEntries((data.chains || []).map(chain => [chain.chain, chain]));

  byChain.kappasushi = cleanKappa(byChain.kappasushi);

  try {
    const freshKura = await findKuraRelease(byChain.kurasushi);
    if (freshKura) byChain.kurasushi = freshKura;
  } catch (error) {
    console.warn(`Kura current release cleanup skipped: ${error.message}`);
  }

  data.chains = ['sushiro','hamazushi','kurasushi','kappasushi','uobei']
    .map(key => byChain[key])
    .filter(Boolean);
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Cleaned national products: Kura ${byChain.kurasushi?.items?.length || 0}/${byChain.kurasushi?.status || 'missing'}, Kappa ${byChain.kappasushi?.items?.length || 0}`);
}

function runSelfTests() {
  assert.equal(cleanKappaName('いかソーメン軍艦 生姜のせ二貫100円'), 'いかソーメン軍艦 生姜のせ');
  assert.equal(cleanKappaName('てんこ盛り海鮮マウンテン391円'), 'てんこ盛り海鮮マウンテン');
  assert.equal(cleanKappaName('「かっぱの百十円満点祭り」では、人気のネタから店内で仕上げる揚げ物まで、100円'), null);

  const fixture = `<!doctype html><html><head><meta property="og:image" content="/fair.jpg"></head><body>
    <p>うなぎ(一貫) 110円</p><p>販売期間：8月21日（金）～8月30日（日）</p>
    <p>〖浜名湖産〗うなぎ(一貫) 380円</p><p>販売期間：8月21日（金）～8月30日（日）</p>
    <p>濃厚えびまぜそば 580円</p><p>販売期間：8月21日（金）～9月17日（木）</p>
  </body></html>`;
  const parsed = parseKuraFairRelease(fixture, {
    chain:'kurasushi', fairName:'うなぎと肉フェア', startDate:'2026-08-21', endDate:'2026-08-30', items:[],
  }, 'https://www.kurasushi.co.jp/author/008391.html');
  assert.deepEqual(parsed.items.map(item => [item.name,item.price]), [['うなぎ(一貫)',110],['〖浜名湖産〗うなぎ(一貫)',380]]);
  assert.equal(parsed.status, 'ok');
  console.log('National product cleanup self-tests passed.');
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
