import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const STORE_URL = 'https://shop.kurasushi.co.jp/detail/609';
const SPECIAL_CAMPAIGN_URL = 'https://www.kurasushi.co.jp/author/008143.html';

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

function jstYear() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric'
  }).format(new Date()));
}

function isActive(range) {
  const today = jstTodayKey();
  return Boolean(range?.startDate && range.startDate <= today && (!range.endDate || today <= range.endDate));
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

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SushiFairPersonalApp/1.0; +https://github.com/)',
        'accept-language': 'ja-JP,ja;q=0.9',
        'cache-control': 'no-cache'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseStoreCampaign(html) {
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

  if (!candidates.length) return null;
  candidates.sort((a, b) => campaignRank(a.range) - campaignRank(b.range));
  const selected = candidates[0];
  const fairName = clean(lines[selected.fairIndex].replace(/[＼／]/g, ''));
  const description = lines.slice(selected.fairIndex + 1, selected.blockEnd).join(' ');
  const names = [...description.matchAll(/[「『]([^」』]{2,60})[」』]/g)]
    .map(match => clean(match[1]))
    .filter(name => !/フェア|開催|期間限定/.test(name));
  const uniqueNames = [...new Set(names)];

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

  return {
    fairName,
    ...selected.range,
    items: (uniqueNames.length ? uniqueNames : [fairName]).map(name => ({ name, price: null })),
    sourceUrl: STORE_URL,
    imageUrl
  };
}

function parseOfficialSpecialCampaign(html) {
  const $ = cheerio.load(html);
  const text = clean($('body').text());
  const year = jstYear();
  const candidates = [];
  const pattern = /第\s*(\d+)\s*弾[\s\S]{0,450}?対象商品[：:]\s*[「『]([^」』]+)[」』]\s*(\d+)\s*円[\s\S]{0,300}?キャンペーン実施期間[：:]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^～〜]{0,30}[～〜]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

  for (const match of text.matchAll(pattern)) {
    const range = {
      startDate: isoDate(year, Number(match[4]), Number(match[5])),
      endDate: isoDate(year, Number(match[6]), Number(match[7]))
    };
    candidates.push({
      number: Number(match[1]),
      itemName: clean(match[2]),
      price: Number(match[3]),
      range
    });
  }

  const active = candidates.filter(candidate => isActive(candidate.range));
  if (!active.length) return null;
  active.sort((a, b) => a.number - b.number);
  const selected = active[active.length - 1];
  return {
    fairName: `創業50年祭 第${selected.number}弾`,
    ...selected.range,
    items: [{ name: selected.itemName, price: selected.price }],
    sourceUrl: SPECIAL_CAMPAIGN_URL,
    imageUrl: null
  };
}

async function main() {
  try {
    const storeHtml = await fetchHtml(STORE_URL);
    const storeCampaign = parseStoreCampaign(storeHtml);

    let selected = storeCampaign && isActive(storeCampaign) ? storeCampaign : null;

    // The store event feed can lag behind campaign changes. If the store event is already
    // expired, consult Kura's official campaign release and prefer an active campaign there.
    if (!selected) {
      try {
        const specialHtml = await fetchHtml(SPECIAL_CAMPAIGN_URL);
        selected = parseOfficialSpecialCampaign(specialHtml);
      } catch (error) {
        console.warn(`Kura official campaign fallback skipped: ${error.message}`);
      }
    }

    const data = JSON.parse(await fs.readFile(OUT, 'utf8'));

    if (!selected) {
      data.chains = (data.chains || []).map(chain => {
        if (chain.chain !== 'kurasushi') return chain;
        const expired = chain.endDate && chain.endDate < jstTodayKey();
        return expired ? {
          ...chain,
          fairName: '最新フェア確認中',
          startDate: null,
          endDate: null,
          items: [],
          sourceUrl: STORE_URL,
          storeUrl: STORE_URL,
          imageUrl: null,
          status: 'warning',
          message: '終了済みフェアは非表示にしました。公式ページの更新を確認中です。'
        } : chain;
      });
      await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
      console.warn('Kura current campaign not found; expired campaign hidden.');
      return;
    }

    data.chains = (data.chains || []).map(chain => chain.chain === 'kurasushi' ? {
      ...chain,
      storeName: '豊橋新栄店',
      fairName: selected.fairName,
      startDate: selected.startDate,
      endDate: selected.endDate,
      items: selected.items,
      sourceUrl: selected.sourceUrl,
      storeUrl: STORE_URL,
      imageUrl: selected.imageUrl,
      status: 'ok',
      message: null
    } : chain);

    await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated Kura: ${selected.fairName} (${selected.items.length} items)`);
  } catch (error) {
    // Kura alone must never stop other chains, but an expired Kura campaign should also
    // never remain presented as current.
    try {
      const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
      data.chains = (data.chains || []).map(chain => {
        if (chain.chain !== 'kurasushi') return chain;
        if (chain.endDate && chain.endDate < jstTodayKey()) {
          return {
            ...chain,
            fairName: '最新フェア確認中',
            startDate: null,
            endDate: null,
            items: [],
            status: 'warning',
            message: '終了済みフェアは非表示にしました。公式情報を再取得中です。'
          };
        }
        return chain;
      });
      await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    } catch {}
    console.warn(`Kura supplemental parser skipped: ${error.message}`);
  }
}

await main();
