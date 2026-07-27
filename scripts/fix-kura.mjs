import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const STORE_URL = 'https://shop.kurasushi.co.jp/detail/609';

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function toIso(value) {
  const match = String(value).match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

const response = await fetch(STORE_URL, {
  headers: {
    'user-agent': 'Mozilla/5.0 (compatible; SushiFairPersonalApp/1.0; +https://github.com/)',
    'accept-language': 'ja-JP,ja;q=0.9'
  }
});
if (!response.ok) throw new Error(`Kura store page HTTP ${response.status}`);

const html = await response.text();
const $ = cheerio.load(html);
const lines = $('body').text().split(/\n+/).map(clean).filter(Boolean);
const eventIndex = lines.findIndex(line => line === 'イベント');
const dateIndex = lines.findIndex((line, index) => index > eventIndex && /20\d{2}\.\d{1,2}\.\d{1,2}\s*[-–—]\s*20\d{2}\.\d{1,2}\.\d{1,2}/.test(line));
if (eventIndex < 0 || dateIndex < 0) throw new Error('Kura event section/date not found');

const fairIndex = lines.findIndex((line, index) => index > dateIndex && /フェア|祭り|キャンペーン/.test(line));
if (fairIndex < 0) throw new Error('Kura fair title not found');

const fairName = clean(lines[fairIndex].replace(/[＼／]/g, ''));
const [startText, endText] = lines[dateIndex].split(/\s*[-–—]\s*/);
const endIndex = lines.findIndex((line, index) => index > fairIndex && /続きを読む|イベント一覧|提供サービス/.test(line));
const description = lines.slice(fairIndex + 1, endIndex > fairIndex ? endIndex : fairIndex + 10).join(' ');

const names = [...description.matchAll(/[「『]([^」』]{2,60})[」』]/g)]
  .map(match => clean(match[1]))
  .filter(name => !/フェア|開催|期間限定/.test(name));
const uniqueNames = [...new Set(names)];
const items = uniqueNames.length
  ? uniqueNames.map(name => ({ name, price: null }))
  : [{ name: fairName, price: null }];

let imageUrl = null;
const eventSection = $('body').find('*').filter((_, element) => clean($(element).text()) === 'イベント').first().closest('section,div');
const image = eventSection.find('img').first();
const rawImage = image.attr('src') || image.attr('data-src') || image.attr('data-lazy-src');
if (rawImage) {
  try { imageUrl = new URL(rawImage, STORE_URL).href; } catch {}
}

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
data.chains = (data.chains || []).map(chain => chain.chain === 'kurasushi' ? {
  ...chain,
  storeName: '豊橋新栄店',
  fairName,
  startDate: toIso(startText),
  endDate: toIso(endText),
  items,
  sourceUrl: STORE_URL,
  storeUrl: STORE_URL,
  imageUrl,
  status: 'ok',
  message: null
} : chain);

await fs.writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated Kura: ${fairName} (${items.length} items)`);
