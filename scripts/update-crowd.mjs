import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'crowd.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const stores = {
  sushiro: {
    name: 'スシロー 豊橋新栄店',
    reservationUrl: 'https://liff.line.me/1621199246-zJXb0Rx4/LINE-mini/ui/store/reservation/entry/?storeId=179&utm_source=01linemini_shoppage',
  },
  hamazushi: {
    name: 'はま寿司 豊橋新栄店',
    reservationUrl: 'https://www.hamazushi.com/app/',
  },
  kurasushi: {
    name: 'くら寿司 豊橋新栄店',
    statusUrl: 'https://shop.kurasushi.co.jp/detail/609',
    reservationUrl: 'https://shop.kurasushi.co.jp/detail/609',
  },
  kappasushi: {
    name: 'かっぱ寿司 豊橋飯村店',
    statusUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    reservationUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
  },
};

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'ja-JP,ja;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    nowMinutes: Number(map.hour) * 60 + Number(map.minute),
  };
}

function levelFromMinutes(minutes) {
  if (minutes == null) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

async function getKappa() {
  const store = stores.kappasushi;
  try {
    const html = await fetchText(store.statusUrl);
    const $ = cheerio.load(html);
    const text = clean($('body').text());

    if (/現在[、,]?お待ちのお客様はいらっしゃいません/.test(text)) {
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: 'low', waitGroups: 0, waitMinutes: 0,
        label: '待ちなし', detail: '現在、お待ちのお客様はいません',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    const both = text.match(/現在[^0-9]{0,20}(\d+)\s*組[^0-9]{0,30}(\d+)\s*分待ち/);
    if (both) {
      const waitGroups = Number(both[1]);
      const waitMinutes = Number(both[2]);
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: levelFromMinutes(waitMinutes), waitGroups, waitMinutes,
        label: `${waitGroups}組・約${waitMinutes}分待ち`, detail: '公式順番待ちページの表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    const groups = text.match(/現在[^0-9]{0,20}(\d+)\s*組/);
    if (groups) {
      const waitGroups = Number(groups[1]);
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high',
        waitGroups, waitMinutes: null, label: `${waitGroups}組待ち`, detail: '公式順番待ちページの表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    return {
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '待ち時間を取得できません', detail: '予約ページで確認してください',
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  } catch (error) {
    return {
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '取得エラー', detail: error.message,
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  }
}

async function getKura() {
  const store = stores.kurasushi;
  try {
    const html = await fetchText(store.statusUrl);
    const $ = cheerio.load(html);
    const text = clean($('body').text());
    const slot = text.match(/最短予約可能時間\s*([0-2]?\d:\d{2})\s*[～〜~\-–—]\s*([0-2]?\d:\d{2})/);
    if (!slot) {
      return {
        chain: 'kurasushi', storeName: store.name,
        method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
        label: '予約枠を取得できません', detail: '店舗ページで確認してください',
        reservationUrl: store.reservationUrl, status: 'warning',
      };
    }

    const earliestSlot = slot[1];
    const [h, m] = earliestSlot.split(':').map(Number);
    const now = jstParts();
    let estimatedMinutes = h * 60 + m - now.nowMinutes;
    if (estimatedMinutes < -30) estimatedMinutes += 1440;

    const plausibleSameDay = estimatedMinutes >= 0 && estimatedMinutes <= 240;
    return {
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot',
      level: plausibleSameDay ? levelFromMinutes(estimatedMinutes) : 'unknown',
      earliestSlot,
      estimatedMinutes: plausibleSameDay ? estimatedMinutes : null,
      label: plausibleSameDay ? `最短 ${earliestSlot}（約${estimatedMinutes}分後）` : `最短予約 ${earliestSlot}`,
      detail: '予約可能時刻からの推定で、実際の待ち時間とは異なる場合があります',
      reservationUrl: store.reservationUrl, status: 'ok',
    };
  } catch (error) {
    return {
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
      label: '取得エラー', detail: error.message,
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  }
}

function linkOnly(chain, store, detail) {
  return {
    chain,
    storeName: store.name,
    method: 'official_link', level: 'unknown',
    label: '公式予約で確認', detail,
    reservationUrl: store.reservationUrl, status: 'link_only',
  };
}

const crowd = [
  linkOnly('sushiro', stores.sushiro, 'LINEの公式受付・予約画面を開きます'),
  linkOnly('hamazushi', stores.hamazushi, '公式アプリで順番待ち・日時指定予約を確認します'),
  await getKura(),
  await getKappa(),
];

const output = {
  updatedAt: new Date().toISOString(),
  timezone: 'Asia/Tokyo',
  disclaimer: '混雑状況は参考値です。予約枠からの推定は実際の待ち時間と一致しない場合があります。',
  stores: crowd,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
for (const item of crowd) console.log(`${item.chain}: ${item.label}`);
