import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'crowd.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

// Regular opening hours confirmed on each chain's official store page.
// Special holiday / temporary hours can differ, so the UI identifies these as regular hours.
const stores = {
  sushiro: {
    name: 'スシロー 豊橋新栄店',
    reservationUrl: 'https://liff.line.me/1621199246-zJXb0Rx4/LINE-mini/ui/store/reservation/entry/?storeId=179&utm_source=01linemini_shoppage',
    hoursSourceUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',
    hours: {
      0: ['10:30', '23:00'],
      1: ['11:00', '23:00'],
      2: ['11:00', '23:00'],
      3: ['11:00', '23:00'],
      4: ['11:00', '23:00'],
      5: ['11:00', '23:00'],
      6: ['10:30', '23:00'],
    },
  },
  hamazushi: {
    name: 'はま寿司 豊橋新栄店',
    reservationUrl: 'https://www.hamazushi.com/app/',
    hoursSourceUrl: 'https://maps.hama-sushi.co.jp/jp/detail/4208.html',
    hours: {
      0: ['10:00', '23:00'],
      1: ['10:00', '23:00'],
      2: ['10:00', '23:00'],
      3: ['10:00', '23:00'],
      4: ['10:00', '23:00'],
      5: ['10:00', '23:00'],
      6: ['10:00', '23:00'],
    },
  },
  kurasushi: {
    name: 'くら寿司 豊橋新栄店',
    statusUrl: 'https://shop.kurasushi.co.jp/detail/609',
    reservationUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hoursSourceUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hours: {
      0: ['10:20', '23:00'],
      1: ['11:00', '23:00'],
      2: ['11:00', '23:00'],
      3: ['11:00', '23:00'],
      4: ['11:00', '23:00'],
      5: ['11:00', '23:00'],
      6: ['10:20', '23:00'],
    },
  },
  kappasushi: {
    name: 'かっぱ寿司 豊橋飯村店',
    statusUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    reservationUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    hoursSourceUrl: 'https://www.kappasushi.jp/shop/0220',
    hours: {
      0: ['10:00', '23:00'],
      1: ['10:30', '23:00'],
      2: ['10:30', '23:00'],
      3: ['10:30', '23:00'],
      4: ['10:30', '23:00'],
      5: ['10:30', '23:00'],
      6: ['10:00', '23:30'],
    },
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
  const weekdayText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', weekday: 'short',
  }).format(date);
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[weekdayText];
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    nowMinutes: Number(map.hour) * 60 + Number(map.minute),
  };
}

function minutesFromTime(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function businessStatus(store, date = new Date()) {
  const now = jstParts(date);
  const [openTime, closeTime] = store.hours?.[now.weekday] || [];
  if (!openTime || !closeTime) {
    return {
      state: 'unknown', openTime: null, closeTime: null,
      hoursLabel: '営業時間は公式サイトで確認',
      nowMinutes: now.nowMinutes, openMinutes: null, closeMinutes: null,
    };
  }

  const openMinutes = minutesFromTime(openTime);
  const closeMinutes = minutesFromTime(closeTime);
  const state = now.nowMinutes < openMinutes
    ? 'before_open'
    : now.nowMinutes >= closeMinutes
      ? 'after_close'
      : 'open';

  return {
    state,
    openTime,
    closeTime,
    hoursLabel: `${openTime}〜${closeTime}`,
    nowMinutes: now.nowMinutes,
    openMinutes,
    closeMinutes,
  };
}

function levelFromMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

function levelName(level) {
  return ({ low: '空き', medium: 'やや混雑', high: '混雑', very_high: 'かなり混雑', unknown: '確認' })[level] || '確認';
}

function withBusiness(result, store, business) {
  return {
    ...result,
    businessState: business.state,
    openTime: business.openTime,
    closeTime: business.closeTime,
    hoursLabel: business.hoursLabel,
    hoursSourceUrl: store.hoursSourceUrl,
  };
}

function closedResult(chain, store, business, detail = '') {
  if (business.state === 'before_open') {
    return withBusiness({
      chain,
      storeName: store.name,
      method: 'official_link',
      level: 'unknown',
      label: `営業時間前（${business.openTime}開店）`,
      detail: detail || `通常営業時間 ${business.hoursLabel}`,
      reservationUrl: store.reservationUrl,
      status: 'ok',
    }, store, business);
  }

  return withBusiness({
    chain,
    storeName: store.name,
    method: 'official_link',
    level: 'unknown',
    label: '営業時間外',
    detail: detail || `本日の通常営業時間 ${business.hoursLabel}`,
    reservationUrl: store.reservationUrl,
    status: 'ok',
  }, store, business);
}

async function getKappa() {
  const store = stores.kappasushi;
  const business = businessStatus(store);

  try {
    const html = await fetchText(store.statusUrl);
    const $ = cheerio.load(html);
    const text = clean($('body').text());

    // The current wait count is not meaningful before opening or after closing.
    if (business.state !== 'open') {
      return closedResult('kappasushi', store, business,
        business.state === 'before_open'
          ? `通常営業時間 ${business.hoursLabel}。店頭待ち人数は営業時間前のため混雑判定に使用しません`
          : `本日の通常営業時間 ${business.hoursLabel}。店頭待ち人数は営業時間外のため混雑判定に使用しません`);
    }

    if (/現在[、,]?お待ちのお客様はいらっしゃいません/.test(text)) {
      return withBusiness({
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: 'low', waitGroups: 0, waitMinutes: 0,
        label: '待ちなし', detail: '現在、お待ちのお客様はいません',
        reservationUrl: store.reservationUrl, status: 'ok',
      }, store, business);
    }

    const both = text.match(/現在[^0-9]{0,20}(\d+)\s*組[^0-9]{0,30}(\d+)\s*分待ち/);
    if (both) {
      const waitGroups = Number(both[1]);
      const waitMinutes = Number(both[2]);
      return withBusiness({
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: levelFromMinutes(waitMinutes), waitGroups, waitMinutes,
        label: `${waitGroups}組・約${waitMinutes}分待ち`, detail: '公式順番待ちページの表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      }, store, business);
    }

    const groups = text.match(/現在[^0-9]{0,20}(\d+)\s*組/);
    if (groups) {
      const waitGroups = Number(groups[1]);
      return withBusiness({
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high',
        waitGroups, waitMinutes: null, label: `${waitGroups}組待ち`, detail: '公式順番待ちページの表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      }, store, business);
    }

    return withBusiness({
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '待ち時間を取得できません', detail: '予約ページで確認してください',
      reservationUrl: store.reservationUrl, status: 'warning',
    }, store, business);
  } catch (error) {
    if (business.state !== 'open') return closedResult('kappasushi', store, business);
    return withBusiness({
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '取得エラー', detail: error.message,
      reservationUrl: store.reservationUrl, status: 'warning',
    }, store, business);
  }
}

async function getKura() {
  const store = stores.kurasushi;
  const business = businessStatus(store);

  try {
    const html = await fetchText(store.statusUrl);
    const $ = cheerio.load(html);
    const text = clean($('body').text());
    const slot = text.match(/最短予約可能時間\s*([0-2]?\d:\d{2})\s*[～〜~\-–—]\s*([0-2]?\d:\d{2})/);

    if (!slot) {
      if (business.state !== 'open') {
        return closedResult('kurasushi', store, business,
          business.state === 'before_open'
            ? `通常営業時間 ${business.hoursLabel}。予約枠を取得できないため混雑度は判定していません`
            : `本日の通常営業時間 ${business.hoursLabel}`);
      }
      return withBusiness({
        chain: 'kurasushi', storeName: store.name,
        method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
        label: '予約枠を取得できません', detail: '店舗ページで確認してください',
        reservationUrl: store.reservationUrl, status: 'warning',
      }, store, business);
    }

    const earliestSlot = slot[1];
    const slotMinutes = minutesFromTime(earliestSlot);

    if (business.state === 'before_open') {
      const validForToday = slotMinutes >= business.openMinutes && slotMinutes <= business.closeMinutes;
      if (validForToday) {
        const delayFromOpen = slotMinutes - business.openMinutes;
        const level = levelFromMinutes(delayFromOpen);
        return withBusiness({
          chain: 'kurasushi', storeName: store.name,
          method: 'reservation_slot', level,
          earliestSlot,
          estimatedMinutes: delayFromOpen,
          label: `${levelName(level)}（営業時間前）`,
          detail: `開店 ${business.openTime}／最短予約 ${earliestSlot}。開店時刻から予約可能時刻まで約${delayFromOpen}分のため、予約状況から推定しています`,
          reservationUrl: store.reservationUrl, status: 'ok',
        }, store, business);
      }

      return withBusiness({
        chain: 'kurasushi', storeName: store.name,
        method: 'reservation_slot', level: 'unknown', earliestSlot, estimatedMinutes: null,
        label: `営業時間前（${business.openTime}開店）`,
        detail: `最短予約 ${earliestSlot}。営業時間前のため混雑度は確定できません`,
        reservationUrl: store.reservationUrl, status: 'ok',
      }, store, business);
    }

    if (business.state === 'after_close') {
      return withBusiness({
        chain: 'kurasushi', storeName: store.name,
        method: 'reservation_slot', level: 'unknown', earliestSlot, estimatedMinutes: null,
        label: '営業時間外',
        detail: `本日の通常営業時間 ${business.hoursLabel}。表示中の予約枠は店頭の現在混雑とは分けて扱います`,
        reservationUrl: store.reservationUrl, status: 'ok',
      }, store, business);
    }

    const estimatedMinutes = slotMinutes - business.nowMinutes;
    const plausibleSameDay = estimatedMinutes >= 0 && slotMinutes <= business.closeMinutes;
    const level = plausibleSameDay ? levelFromMinutes(estimatedMinutes) : 'unknown';
    return withBusiness({
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot',
      level,
      earliestSlot,
      estimatedMinutes: plausibleSameDay ? estimatedMinutes : null,
      label: plausibleSameDay ? `最短 ${earliestSlot}（約${estimatedMinutes}分後）` : `最短予約 ${earliestSlot}`,
      detail: plausibleSameDay
        ? '予約可能時刻からの推定で、実際の店頭待ち時間とは異なる場合があります'
        : '予約枠の時刻を現在の店頭待ち時間へ安全に換算できないため、混雑度は判定していません',
      reservationUrl: store.reservationUrl, status: 'ok',
    }, store, business);
  } catch (error) {
    if (business.state !== 'open') return closedResult('kurasushi', store, business);
    return withBusiness({
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
      label: '取得エラー', detail: error.message,
      reservationUrl: store.reservationUrl, status: 'warning',
    }, store, business);
  }
}

function linkOnly(chain, store, detail) {
  const business = businessStatus(store);
  if (business.state !== 'open') {
    return closedResult(chain, store, business,
      business.state === 'before_open'
        ? `${detail}。通常営業時間 ${business.hoursLabel}`
        : `本日の通常営業時間 ${business.hoursLabel}`);
  }

  return withBusiness({
    chain,
    storeName: store.name,
    method: 'official_link', level: 'unknown',
    label: '公式予約で確認', detail,
    reservationUrl: store.reservationUrl, status: 'link_only',
  }, store, business);
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
  disclaimer: '混雑状況は参考値です。通常営業時間を考慮し、営業時間前の予約枠推定は「営業時間前」と明示します。祝日・臨時営業時間は公式情報をご確認ください。',
  stores: crowd,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
for (const item of crowd) console.log(`${item.chain}: ${item.label} / ${item.businessState} / ${item.hoursLabel}`);
