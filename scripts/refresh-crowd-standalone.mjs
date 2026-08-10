import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'app', 'data', 'crowd.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const stores = {
  sushiro: {
    chain: 'sushiro',
    name: 'スシロー 豊橋新栄店',
    crowdStoreId: 179,
    crowdApiUrl: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/api/stores?latitude=34.7634355&longitude=137.3656127&numresults=3',
    statusUrls: [
      'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179',
      'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/stores/area/?storeId=179',
    ],
    reservationUrl: 'https://liff.line.me/1621199246-zJXb0Rx4/LINE-mini/ui/store/reservation/entry/?storeId=179&utm_source=01linemini_shoppage',
    hoursSourceUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',
    hours: { 0:['10:30','23:00'],1:['11:00','23:00'],2:['11:00','23:00'],3:['11:00','23:00'],4:['11:00','23:00'],5:['11:00','23:00'],6:['10:30','23:00'] },
  },
  hamazushi: {
    chain: 'hamazushi',
    name: 'はま寿司 豊橋新栄店',
    statusUrls: [
      'https://my.hama-sushi.co.jp/shop/index/?search=1&shopId=148',
      'https://my.hamazushi.com/shop/index/?search=1&shopId=148',
    ],
    reservationUrl: 'https://www.hamazushi.com/app/',
    hoursSourceUrl: 'https://maps.hama-sushi.co.jp/jp/detail/4208.html',
    hours: { 0:['10:00','23:00'],1:['10:00','23:00'],2:['10:00','23:00'],3:['10:00','23:00'],4:['10:00','23:00'],5:['10:00','23:00'],6:['10:00','23:00'] },
  },
  kurasushi: {
    chain: 'kurasushi',
    name: 'くら寿司 豊橋新栄店',
    statusUrls: ['https://shop.kurasushi.co.jp/detail/609'],
    reservationUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hoursSourceUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hours: { 0:['10:20','23:00'],1:['11:00','23:00'],2:['11:00','23:00'],3:['11:00','23:00'],4:['11:00','23:00'],5:['11:00','23:00'],6:['10:20','23:00'] },
    parseOfficialHours: true,
  },
  kappasushi: {
    chain: 'kappasushi',
    name: 'かっぱ寿司 豊橋飯村店',
    statusUrls: ['https://yoyaku.kappasushi.jp/shop/detail/shop_id/988'],
    reservationUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    hoursSourceUrl: 'https://www.kappasushi.jp/shop/0220',
    hours: { 0:['10:00','23:00'],1:['10:30','23:00'],2:['10:30','23:00'],3:['10:30','23:00'],4:['10:30','23:00'],5:['10:30','23:00'],6:['10:00','23:30'] },
    specialHours: [
      {
        from: '2026-08-09',
        to: '2026-08-16',
        hours: ['10:00', '23:30'],
        note: 'お盆期間は土曜日の営業時間に準拠',
        sourceUrl: 'https://www.kappasushi.jp/202608/oshirase',
      },
    ],
  },
};

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function decodeScriptEscapes(value = '') {
  return String(value)
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

function htmlToText(html = '') {
  return clean(decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return { requestedUrl: url, finalUrl: response.url, html, text: htmlToText(html) };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9',
      accept: 'application/json,text/plain,*/*',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  return {
    year, month, day,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[map.weekday],
    nowMinutes: Number(map.hour) * 60 + Number(map.minute),
  };
}

function minutesFromTime(value) {
  const [h, m] = String(value).replace('：', ':').split(':').map(Number);
  return h * 60 + m;
}

function normalizeTime(value) {
  const [hour, minute] = String(value).replace('：', ':').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 29 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseOfficialHoursForToday(text, now = jstParts()) {
  const source = clean(text);
  if (!source) return null;
  const separator = '[.:/]';
  const exactDate = new RegExp(
    `${now.year}\\s*${separator}\\s*0?${now.month}\\s*${separator}\\s*0?${now.day}(?:\\s*日)?[^0-9]{0,24}([0-2]?\\d[:：]\\d{2})\\s*[-–—〜～]\\s*([0-2]?\\d[:：]\\d{2})`
  );
  const exact = source.match(exactDate);
  if (exact) {
    const openTime = normalizeTime(exact[1]);
    const closeTime = normalizeTime(exact[2]);
    if (openTime && closeTime) return { hours:[openTime, closeTime], kind:'official_override', note:'公式店舗ページの本日指定営業時間' };
  }

  const weekdayName = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'][now.weekday];
  const weekdayPattern = new RegExp(`${weekdayName}[^0-9]{0,20}([0-2]?\\d[:：]\\d{2})\\s*[-–—〜～]\\s*([0-2]?\\d[:：]\\d{2})`);
  const weekday = source.match(weekdayPattern);
  if (weekday) {
    const openTime = normalizeTime(weekday[1]);
    const closeTime = normalizeTime(weekday[2]);
    if (openTime && closeTime) return { hours:[openTime, closeTime], kind:'official', note:'公式店舗ページから取得' };
  }
  return null;
}

function resolveHours(store, pageText = '', date = new Date()) {
  const now = jstParts(date);
  const special = (store.specialHours || []).find(entry => entry.from <= now.dateKey && now.dateKey <= entry.to);
  if (special) {
    return {
      hours: special.hours,
      kind: 'special',
      note: special.note,
      sourceUrl: special.sourceUrl || store.hoursSourceUrl,
      now,
    };
  }

  if (store.parseOfficialHours) {
    const official = parseOfficialHoursForToday(pageText, now);
    if (official) return { ...official, sourceUrl: store.hoursSourceUrl, now };
  }

  return {
    hours: store.hours[now.weekday] || null,
    kind: 'regular',
    note: null,
    sourceUrl: store.hoursSourceUrl,
    now,
  };
}

function businessStatus(store, hoursInfo = resolveHours(store)) {
  const [openTime, closeTime] = hoursInfo.hours || [];
  if (!openTime || !closeTime) {
    return {
      state:'unknown', openTime:null, closeTime:null, hoursLabel:'営業時間は公式サイトで確認',
      hoursKind:hoursInfo.kind || 'unknown', hoursNote:hoursInfo.note || null,
      hoursSourceUrl:hoursInfo.sourceUrl || store.hoursSourceUrl,
    };
  }
  const open = minutesFromTime(openTime);
  const close = minutesFromTime(closeTime);
  const state = hoursInfo.now.nowMinutes < open ? 'before_open' : hoursInfo.now.nowMinutes >= close ? 'after_close' : 'open';
  return {
    state, openTime, closeTime, hoursLabel:`${openTime}〜${closeTime}`,
    hoursKind:hoursInfo.kind, hoursNote:hoursInfo.note || null,
    hoursSourceUrl:hoursInfo.sourceUrl || store.hoursSourceUrl,
  };
}

function withBusiness(result, business) {
  return {
    ...result,
    businessState: business.state,
    openTime: business.openTime,
    closeTime: business.closeTime,
    hoursLabel: business.hoursLabel,
    hoursKind: business.hoursKind,
    hoursNote: business.hoursNote,
    hoursSourceUrl: business.hoursSourceUrl,
  };
}

function hoursDescription(business) {
  const prefix = ['special','official_override'].includes(business.hoursKind) ? '本日の営業時間' : '通常営業時間';
  return `${prefix} ${business.hoursLabel}${business.hoursNote ? `（${business.hoursNote}）` : ''}`;
}

function outsideHours(store, business, extra = '') {
  const label = business.state === 'before_open'
    ? `営業時間前（${business.openTime}開店）`
    : business.state === 'after_close' ? '営業時間外' : '営業時間確認中';
  return withBusiness({
    chain: store.chain,
    storeName: store.name,
    method: 'official_link',
    level: 'unknown',
    label,
    detail: extra || hoursDescription(business),
    reservationUrl: store.reservationUrl,
    status: 'ok',
  }, business);
}

function levelFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

function waitFromNumbers({ waitMinutes = null, waitGroups = null } = {}) {
  const normalizedMinutes = Number.isFinite(waitMinutes) && waitMinutes >= 0 && waitMinutes <= 240
    ? Number(waitMinutes)
    : null;
  const normalizedGroups = Number.isFinite(waitGroups) && waitGroups >= 0 && waitGroups <= 200
    ? Number(waitGroups)
    : null;
  if (normalizedMinutes === null && normalizedGroups === null) return null;
  return { waitMinutes:normalizedMinutes, waitGroups:normalizedGroups };
}

function parsePublicWait(text) {
  const source = clean(text);
  const minutePatterns = [
    /現在の待ち状況[^0-9]{0,80}(?:約)?\s*(\d{1,3})\s*分/,
    /現在の待ち時間[^0-9]{0,60}(\d{1,3})\s*分/,
    /待ち時間(?:の目安)?[^0-9]{0,60}(\d{1,3})\s*分/,
    /ただいま[^0-9]{0,70}(\d{1,3})\s*分待ち/,
  ];
  for (const pattern of minutePatterns) {
    const match = source.match(pattern);
    const result = match ? waitFromNumbers({ waitMinutes:Number(match[1]) }) : null;
    if (result) return result;
  }
  const groupPatterns = [
    /現在[^0-9]{0,50}(\d{1,3})\s*組(?:待ち|お待ち)/,
    /ただいま[^0-9]{0,50}(\d{1,3})\s*組(?:待ち|お待ち)/,
  ];
  for (const pattern of groupPatterns) {
    const match = source.match(pattern);
    const result = match ? waitFromNumbers({ waitGroups:Number(match[1]) }) : null;
    if (result) return result;
  }
  return null;
}

function parseEmbeddedWait(html) {
  const source = decodeScriptEscapes(decodeEntities(html));
  const visible = parsePublicWait(htmlToText(source));
  if (visible) return visible;

  const minuteKeys = [
    /["'](?:wait(?:ing)?(?:Time|Minutes)|wait_time|waiting_time|waiting_minutes|estimatedWaitMinutes|estimated_wait_minutes)["']\s*:\s*["']?(\d{1,3})/gi,
    /\b(?:wait(?:ing)?(?:Time|Minutes)|wait_time|waiting_time|waiting_minutes)\s*=\s*["']?(\d{1,3})/gi,
  ];
  for (const pattern of minuteKeys) {
    for (const match of source.matchAll(pattern)) {
      const result = waitFromNumbers({ waitMinutes:Number(match[1]) });
      if (result) return result;
    }
  }

  const groupKeys = [
    /["'](?:wait(?:ing)?Groups|waiting_groups|queueCount|queue_count|numberOfGroups)["']\s*:\s*["']?(\d{1,3})/gi,
    /\b(?:waitingGroups|queueCount|numberOfGroups)\s*=\s*["']?(\d{1,3})/gi,
  ];
  for (const pattern of groupKeys) {
    for (const match of source.matchAll(pattern)) {
      const result = waitFromNumbers({ waitGroups:Number(match[1]) });
      if (result) return result;
    }
  }
  return null;
}

function integerInRange(value, min, max) {
  const source = String(value ?? '').trim();
  if (!/^-?\d+$/.test(source)) return null;
  const number = Number(source);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

function normalizeSushiroWait({ waitMinutes, waitGroups, waitTimeCap, waitShowType }) {
  const cap = integerInRange(waitTimeCap, 1, 240) ?? 240;
  const rawMinutes = integerInRange(waitMinutes, -1, 999);
  const rawGroups = integerInRange(waitGroups, -1, 200);
  const showType = integerInRange(waitShowType, 0, 2);
  if (showType === null) return null;

  let minutes = rawMinutes !== null && rawMinutes >= 0 ? Math.min(rawMinutes, cap) : null;
  let groups = rawGroups !== null && rawGroups >= 0 ? rawGroups : null;
  if (showType === 1) minutes = null;
  if (showType === 0) groups = null;

  const wait = waitFromNumbers({ waitMinutes:minutes, waitGroups:groups });
  if (!wait) return null;
  return {
    ...wait,
    waitMinutesAtLeast: rawMinutes !== null && rawMinutes > cap,
    waitShowType: showType,
    sourceSeat: 'table',
  };
}

function parseSushiroStoreData(payload, expectedStoreId = 179) {
  if (!Array.isArray(payload)) return null;
  const store = payload.find(item => Number(item?.id) === Number(expectedStoreId));
  if (!store) return null;
  if (String(store.storeStatus || '').toUpperCase() !== 'OPEN') return null;
  if (store.netTicketStatus && String(store.netTicketStatus).toUpperCase() !== 'ONLINE') return null;

  let waitGroups = integerInRange(store.waitingGroupTable, -1, 200);
  const fallbackGroups = integerInRange(store.waitingGroup, -1, 200);
  if (waitGroups !== null && waitGroups < 0 && fallbackGroups !== null && fallbackGroups >= 0) {
    waitGroups = fallbackGroups;
  }

  return normalizeSushiroWait({
    waitMinutes: store.wait,
    waitGroups,
    waitTimeCap: store.waitTimeCap,
    waitShowType: store.waitShowType,
  });
}

function htmlInputValue(html = '', id = '') {
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(html).match(new RegExp(`<input\\b[^>]*\\bid=["']${escapedId}["'][^>]*>`, 'i'))?.[0];
  if (!tag) return null;
  const value = tag.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return value ? decodeEntities(value[1] ?? value[2] ?? value[3] ?? '') : null;
}

function parseSushiroWaitPage(html, expectedStoreId = 179) {
  if (String(htmlInputValue(html, 'storeId')) !== String(expectedStoreId)) return null;
  if (String(htmlInputValue(html, 'storeStatus') || '').toUpperCase() !== 'OPEN') return null;
  const ticketStatus = htmlInputValue(html, 'netTicketStatus');
  if (ticketStatus && String(ticketStatus).toUpperCase() !== 'ONLINE') return null;

  let waitGroups = integerInRange(htmlInputValue(html, 'waitGroupTable'), -1, 200);
  const fallbackGroups = integerInRange(htmlInputValue(html, 'waitGroup'), -1, 200);
  if (waitGroups !== null && waitGroups < 0 && fallbackGroups !== null && fallbackGroups >= 0) {
    waitGroups = fallbackGroups;
  }

  return normalizeSushiroWait({
    waitMinutes: htmlInputValue(html, 'waitTimeTable'),
    waitGroups,
    waitTimeCap: htmlInputValue(html, 'waitTimeCap'),
    waitShowType: htmlInputValue(html, 'waitShowType'),
  });
}

function actualWaitResult(store, business, wait, detail) {
  const normalized = waitFromNumbers(wait);
  if (!normalized) throw new Error('Invalid wait data');

  const waitMinutes = normalized.waitMinutes;
  const waitGroups = normalized.waitGroups;
  const waitMinutesAtLeast = Boolean(wait.waitMinutesAtLeast && waitMinutes !== null);
  const level = waitMinutes !== null
    ? levelFromMinutes(waitMinutes)
    : waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high';

  let label = '待ち時間を取得できません';
  if (waitMinutes === 0 && waitGroups === 0) {
    label = '待ちなし';
  } else if (waitMinutesAtLeast) {
    label = waitGroups !== null && waitGroups > 0
      ? `${waitGroups}組・${waitMinutes}分以上`
      : `${waitMinutes}分以上`;
  } else if (waitMinutes !== null && waitGroups !== null) {
    if (waitGroups === 0) label = waitMinutes === 0 ? '待ちなし' : `約${waitMinutes}分待ち`;
    else if (waitMinutes === 0) label = `${waitGroups}組待ち`;
    else label = `${waitGroups}組・約${waitMinutes}分待ち`;
  } else if (waitMinutes !== null) {
    label = waitMinutes === 0 ? '待ちなし' : `約${waitMinutes}分待ち`;
  } else if (waitGroups !== null) {
    label = waitGroups === 0 ? '待ちなし' : `${waitGroups}組待ち`;
  }

  return withBusiness({
    chain:store.chain, storeName:store.name, method:'actual_wait',
    level, waitMinutes, waitGroups, waitMinutesAtLeast,
    ...(wait.sourceSeat ? { sourceSeat:wait.sourceSeat } : {}),
    ...(wait.waitShowType !== undefined ? { waitShowType:wait.waitShowType } : {}),
    label, detail, reservationUrl:store.reservationUrl, status:'ok',
  }, business);
}

async function fetchFirstPages(urls = []) {
  const pages = [];
  for (const url of urls) {
    try { pages.push(await fetchPage(url)); } catch {}
  }
  return pages;
}

async function getSushiroOrHama(store) {
  const business = businessStatus(store);
  if (business.state !== 'open') return outsideHours(store, business);

  if (store.chain === 'sushiro' && store.crowdApiUrl) {
    try {
      const payload = await fetchJson(store.crowdApiUrl);
      const wait = parseSushiroStoreData(payload, store.crowdStoreId);
      if (wait) {
        return actualWaitResult(
          store,
          business,
          wait,
          'スシロー公式受付システムの公開店舗データから取得（来店予約・テーブル席）'
        );
      }
    } catch {}
  }

  const pages = await fetchFirstPages(store.statusUrls);
  for (const page of pages) {
    const sushiroWait = store.chain === 'sushiro'
      ? parseSushiroWaitPage(page.html, store.crowdStoreId)
      : null;
    const wait = sushiroWait || parsePublicWait(page.text) || parseEmbeddedWait(page.html);
    if (wait) {
      const detail = sushiroWait
        ? 'スシロー公式受付ページの公開表示値から取得（来店予約・テーブル席）'
        : '公式受付・予約ページの公開表示から取得';
      return actualWaitResult(store, business, wait, detail);
    }
  }

  const detail = store.chain === 'sushiro'
    ? '公式受付システムから現在待ちを取得できませんでした。推測値は表示せず、公式予約画面へのリンクだけを表示します。'
    : '順番待ち・時間指定予約がログイン後の機能中心で、公開ページから現在待ちを安定取得できる値は確認できていません。';
  return withBusiness({
    chain:store.chain, storeName:store.name, method:'official_link', level:'unknown',
    label:'公式予約で確認', detail, reservationUrl:store.reservationUrl, status:'link_only',
  }, business);
}

async function getKura() {
  const store = stores.kurasushi;
  let page = null;
  try { page = await fetchPage(store.statusUrls[0]); } catch {}
  const business = businessStatus(store, resolveHours(store, page?.text || ''));
  const match = page?.text.match(/最短予約可能時間\s*([0-2]?\d[:：]\d{2})\s*[～〜~\-–—]\s*([0-2]?\d[:：]\d{2})/);
  const earliestSlot = normalizeTime(match?.[1] || '') || null;
  const reservationLabel = earliestSlot ? `予約枠：最短 ${earliestSlot}` : '予約枠：取得できません';
  const reservationDetail = '日時指定の予約枠と、店頭の現在待ち・順番待ちは別の指標です。';

  if (business.state !== 'open') {
    const base = outsideHours(store, business);
    return {
      ...base,
      method:'reservation_slot',
      detail: business.state === 'before_open'
        ? `店頭混雑は営業時間前のため不明です。${reservationLabel}ですが、これを店頭混雑度には換算しません。`
        : `${reservationLabel}。予約枠と本日の店頭混雑は分けて表示しています。`,
      reservationLabel, reservationDetail,
    };
  }

  return withBusiness({
    chain:'kurasushi', storeName:store.name, method:'reservation_slot', level:'unknown',
    earliestSlot, estimatedMinutes:null,
    label:'店頭混雑は取得できません',
    detail:`${reservationLabel}。日時指定予約の空き状況だけでは、現在の店頭待ち時間は判断しません。`,
    reservationLabel, reservationDetail,
    reservationUrl:store.reservationUrl, status:earliestSlot ? 'ok' : 'warning',
  }, business);
}

async function getKappa() {
  const store = stores.kappasushi;
  const business = businessStatus(store);
  if (business.state !== 'open') {
    return outsideHours(store, business, `${hoursDescription(business)}。店頭待ち人数は営業時間外のため混雑判定に使用しません`);
  }
  try {
    const page = await fetchPage(store.statusUrls[0]);
    if (/現在[、,\s]*お待ちのお客様はいらっしゃいません/.test(page.text)) {
      return actualWaitResult(store, business, { waitGroups:0, waitMinutes:0 }, '現在、お待ちのお客様はいません');
    }
    const both = page.text.match(/現在[^0-9]{0,40}(\d+)\s*組[^0-9]{0,50}(\d+)\s*分待ち/);
    if (both) {
      return actualWaitResult(store, business, { waitGroups:Number(both[1]), waitMinutes:Number(both[2]) }, '公式順番待ちページの現在表示');
    }
    const wait = parsePublicWait(page.text) || parseEmbeddedWait(page.html);
    if (wait) return actualWaitResult(store, business, wait, '公式順番待ちページの現在表示');
  } catch {}
  return withBusiness({
    chain:'kappasushi', storeName:store.name, method:'actual_wait', level:'unknown',
    waitGroups:null, waitMinutes:null, label:'待ち時間を取得できません', detail:'公式順番待ちページで確認してください',
    reservationUrl:store.reservationUrl, status:'warning',
  }, business);
}

async function safeCollect(store, collector) {
  try { return await collector(); } catch (error) {
    const business = businessStatus(store);
    return withBusiness({
      chain:store.chain, storeName:store.name, method:'official_link', level:'unknown',
      label:'取得できません', detail:`この店舗だけ取得に失敗しました（${error?.message || 'unknown error'}）`,
      reservationUrl:store.reservationUrl, status:'warning',
    }, business);
  }
}

function runSelfTests() {
  const monday = new Date('2026-08-10T06:00:00.000Z');
  const kappa = resolveHours(stores.kappasushi, '', monday);
  assert.deepEqual(kappa.hours, ['10:00','23:30']);
  assert.equal(kappa.kind, 'special');

  const thursday = new Date('2026-08-13T06:00:00.000Z');
  const kuraText = '営業時間 月曜日 11:00-23:00 2026/8/13 木曜日 10:20-23:00 2026/8/14 金曜日 10:20-23:00';
  const kura = resolveHours(stores.kurasushi, kuraText, thursday);
  assert.deepEqual(kura.hours, ['10:20','23:00']);
  assert.equal(kura.kind, 'official_override');

  assert.deepEqual(parsePublicWait('現在の待ち状況 約 25分'), { waitMinutes:25, waitGroups:null });
  assert.equal(parsePublicWait('最短予約可能時間 15:30～15:40'), null);
  assert.deepEqual(parseEmbeddedWait('<script>window.state={"waitingMinutes":18}</script>'), { waitMinutes:18, waitGroups:null });

  const sushiroApiWait = parseSushiroStoreData([{
    id:179, storeStatus:'OPEN', netTicketStatus:'ONLINE', wait:12, waitTimeCap:180,
    waitShowType:2, waitingGroup:3, waitingGroupTable:3,
  }], 179);
  assert.deepEqual(sushiroApiWait, {
    waitMinutes:12, waitGroups:3, waitMinutesAtLeast:false, waitShowType:2, sourceSeat:'table',
  });

  const sushiroHtmlWait = parseSushiroWaitPage(`
    <input id="storeId" value="179">
    <input id="storeStatus" value="OPEN">
    <input id="netTicketStatus" value="ONLINE">
    <input id="waitTimeTable" value="0">
    <input id="waitTimeCap" value="180">
    <input id="waitShowType" value="2">
    <input id="waitGroup" value="0">
    <input id="waitGroupTable" value="0">
  `, 179);
  assert.deepEqual(sushiroHtmlWait, {
    waitMinutes:0, waitGroups:0, waitMinutesAtLeast:false, waitShowType:2, sourceSeat:'table',
  });
  console.log('Crowd parser self-tests passed.');
}

async function main() {
  const results = await Promise.all([
    safeCollect(stores.sushiro, () => getSushiroOrHama(stores.sushiro)),
    safeCollect(stores.hamazushi, () => getSushiroOrHama(stores.hamazushi)),
    safeCollect(stores.kurasushi, getKura),
    safeCollect(stores.kappasushi, getKappa),
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    source: 'github-actions-snapshot',
    disclaimer: '実待ちを公式公開している店舗だけ待ち時間・待ち組数を表示します。くら寿司の日時指定予約枠は店頭待ちとは別に扱い、混雑度へ換算しません。営業時間外の0組表示も混雑判定に使用しません。',
    stores: results,
  };

  await fs.mkdir(path.dirname(OUT), { recursive:true });
  await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  for (const store of results) console.log(`${store.chain}: ${store.label} / ${store.businessState}`);
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
