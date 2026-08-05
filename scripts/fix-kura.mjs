import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const STORE_URL = 'https://shop.kurasushi.co.jp/detail/609';

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseRange(value) {
  const text = String(value);
  const full = text.match(/(20\d{2})[./](\d{1,2})[./](\d{1,2})\s*[-–—〜～]\s*(20\d{2})[./](\d{1,2})[./](\d{1,2})/);
  if (full) {
    return {
      startDate: isoDate(Number(full[1]), Number(full[2]), Number(full[3])),
      endDate: isoDate(Number(full[4]), Number(full[5]), Number(full[6]))
    };
  }

  const short = text.match(/(20\d{2})[./](\d{1,2})[./](\d{1,2})\s*[-–—〜～]\s*(\d{1,2})[./](\d{1,2})/);
  if (short) {
    return {
      startDate: isoDate(Number(short[1]), Number(short[2]), Number(short[3])),
      endDate: isoDate(Number(short[1]), Number(short[4]), Number(short[5]))
    };
  }

  return { startDate: null, endDate: null };
}

function jstTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function campaignRank(range) {
  if (!range.startDate) return 99_999_999;
  const today = new Date(`${jstTodayKey()}T00:00:00+09:00`).getTime();
  const start = new Date(`${range.startDate}T00:00:00+09:00`).getTime();
  const end = range.endDate ? new Date(`${range.endDate}T23:59:59+09:00`).getTime() : start;
  if (start <= today && today <= end) return 0;
  if (start > today) return 10_000 + Math.round((start - today) / 86_400_000);
  return 20_000 + Math.round((today - end) / 86_400_000);
}

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(STORE_URL, {
      signal: controller.signal,
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
    const scanStart = eventIndex >= 0 ? eventIndex + 1 : 0;

    const candidates = [];
    for (let index = scanStart; index < lines.length; index += 1) {
      const range = parseRange(lines[index]);
      if (!range.startDate) continue;
      const nextDateIndex = lines.findIndex((line, i) => i > index && parseRange(line).startDate);
      const blockEnd = nextDateIndex > index ? nextDateIndex : Math.min(lines.length, index + 20);
      const fairIndex = lines.findIndex((line, i) => i > index && i < blockEnd && /フェア|祭り|キャンペーン/.test(line));
      if (fairIndex < 0) continue;
      candidates.push({ index, fairIndex, blockEnd, range });
    }

    if (!candidates.length) throw new Error('Kura event campaign not found');
    candidates.sort((a, b) => campaignRank(a.range) - campaignRank(b.range));
    const selected = candidates[0];
    const fairName = clean(lines[selected.fairIndex].replace(/[＼／]/g, ''));
    const description = lines.slice(selected.fairIndex + 1, selected.blockEnd).join(' ');

    const names = [...description.matchAll(/[「『]([^」』]{2,60})[」』]/g)]
      .map(match => clean(match[1]))
      .filter(name => !/フェア|開催|期間限定/.test(name));
    const uniqueNames = [...new Set(names)];
    const items = (uniqueNames.length ? uniqueNames : [fairName])
      .map(name => ({ name, price: null }));

    let imageUrl = null;
    const eventSection = $('body').find('*')
      .filter((_, element) => clean($(element).text()) === 'イベント')
      .first()
      .closest('section,div');
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
      ...selected.range,
      items,
      sourceUrl: STORE_URL,
      storeUrl: STORE_URL,
      imageUrl,
      status: 'ok',
      message: null
    } : chain);

    await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated Kura: ${fairName} (${items.length} items)`);
  } catch (error) {
    // くら寿司だけ取れなくても、他3社の更新と公開は止めない。
    console.warn(`Kura supplemental parser skipped: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

await main();
