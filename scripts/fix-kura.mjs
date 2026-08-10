import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');
const STORE_URL = 'https://shop.kurasushi.co.jp/detail/609';
const SPECIAL_CAMPAIGN_URL = 'https://www.kurasushi.co.jp/author/008143.html';

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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
  return first ? { startDate:first.startDate, endDate:first.endDate } : { startDate:null, endDate:null };
}

function jstTodayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function jstYear() {
  return Number(jstTodayKey().slice(0, 4));
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

function quotedItems(block = '', fairName = '') {
  const names = [...String(block).matchAll(/[「『]([^」』]{2,70})[」』]/g)]
    .map(match => clean(match[1]))
    .filter(name => name && name !== fairName)
    .filter(name => !/フェア|祭り|キャンペーン|開催|実施期間/.test(name));
  return [...new Set(names)];
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

function findEventMedia($, fairName) {
  let sourceUrl = STORE_URL;
  let imageUrl = null;
  let selectedContainer = null;

  $('a[href]').each((_, element) => {
    if (selectedContainer) return;
    const link = $(element);
    const href = link.attr('href');
    if (!href) return;
    let node = link;
    for (let depth = 0; depth < 6 && node.length; depth += 1) {
      const text = clean(node.text());
      if (text.includes(fairName)) {
        selectedContainer = node;
        try { sourceUrl = new URL(href, STORE_URL).href; } catch {}
        return;
      }
      node = node.parent();
    }
  });

  if (selectedContainer?.length) {
    const image = selectedContainer.find('img').first();
    const rawImage = image.attr('src') || image.attr('data-src') || image.attr('data-lazy-src');
    if (rawImage) {
      try { imageUrl = new URL(rawImage, STORE_URL).href; } catch {}
    }
  }

  return { sourceUrl, imageUrl };
}

function parseStoreCampaign(html) {
  const $ = cheerio.load(html);
  const eventText = eventSectionText($);
  const ranges = findRanges(eventText);
  const candidates = [];

  ranges.forEach((range, index) => {
    const next = ranges[index + 1];
    const block = eventText.slice(range.endIndex, next?.index ?? eventText.length);
    const fairName = findFairName(block);
    if (!fairName) return;
    const names = quotedItems(block, fairName);
    candidates.push({
      fairName,
      startDate: range.startDate,
      endDate: range.endDate,
      items: (names.length ? names : [fairName]).map(name => ({ name, price:null })),
      description: clean(block),
    });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => campaignRank(a) - campaignRank(b));
  const selected = candidates[0];
  const media = findEventMedia($, selected.fairName);
  return { ...selected, ...media };
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
      endDate: isoDate(year, Number(match[6]), Number(match[7])),
    };
    candidates.push({
      number: Number(match[1]),
      itemName: clean(match[2]),
      price: Number(match[3]),
      range,
    });
  }

  const active = candidates.filter(candidate => isActive(candidate.range));
  if (!active.length) return null;
  active.sort((a, b) => a.number - b.number);
  const selected = active[active.length - 1];
  return {
    fairName: `創業50年祭 第${selected.number}弾`,
    ...selected.range,
    items: [{ name:selected.itemName, price:selected.price }],
    sourceUrl: SPECIAL_CAMPAIGN_URL,
    imageUrl: null,
    dataQuality: 'complete',
  };
}

function applySelectedCampaign(data, selected) {
  const titleOnly = selected.items.length === 1 && selected.items[0]?.name === selected.fairName;
  data.chains = (data.chains || []).map(chain => chain.chain === 'kurasushi' ? {
    ...chain,
    storeName: '豊橋新栄店',
    fairName: selected.fairName,
    startDate: selected.startDate,
    endDate: selected.endDate,
    items: selected.items,
    sourceUrl: selected.sourceUrl || STORE_URL,
    storeUrl: STORE_URL,
    imageUrl: selected.imageUrl || null,
    status: titleOnly ? 'warning' : 'ok',
    message: titleOnly
      ? '開催中フェア名と期間は取得済みですが、個別商品の自動取得はできていません。公式ページで確認してください。'
      : null,
  } : chain);
}

function hideExpiredKura(data, message) {
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
      message,
    } : chain;
  });
}

function runSelfTests() {
  const fixture = `<!doctype html><html><body>
    <section><h2>イベント</h2><div><a href="https://www.kurasushi.co.jp/topic/mediterranean-tuna">
    <img src="/images/tuna.jpg"><span>2026.08.07 - 2026.08.19</span><h3>地中海本まぐろフェア</h3>
    <p>＼「地中海本まぐろフェア開催‼」／ 地中海本まぐろ大とろ登場！</p></a></div></section>
    <h2>提供サービス</h2></body></html>`;
  const parsed = parseStoreCampaign(fixture);
  assert.equal(parsed.fairName, '地中海本まぐろフェア');
  assert.equal(parsed.startDate, '2026-08-07');
  assert.equal(parsed.endDate, '2026-08-19');
  assert.equal(parsed.sourceUrl, 'https://www.kurasushi.co.jp/topic/mediterranean-tuna');
  assert.equal(parseRange('2026/8/7 - 8/19').endDate, '2026-08-19');
  console.log('Kura parser self-tests passed.');
}

async function main() {
  try {
    const storeHtml = await fetchHtml(STORE_URL);
    const storeCampaign = parseStoreCampaign(storeHtml);
    let selected = storeCampaign && isActive(storeCampaign) ? storeCampaign : null;

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
      hideExpiredKura(data, '終了済みフェアは非表示にしました。公式ページの更新を確認中です。');
      await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
      console.warn('Kura current campaign not found; expired campaign hidden.');
      return;
    }

    applySelectedCampaign(data, selected);
    await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated Kura: ${selected.fairName} (${selected.items.length} items)`);
  } catch (error) {
    try {
      const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
      hideExpiredKura(data, '終了済みフェアは非表示にしました。公式情報を再取得中です。');
      await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
    } catch {}
    console.warn(`Kura supplemental parser skipped: ${error.message}`);
  }
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
