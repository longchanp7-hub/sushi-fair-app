import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'crowd.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const stores = {
  sushiro: {
    chain: 'sushiro',
    name: 'スシロー 豊橋新栄店',
    statusUrl: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179',
    reservationUrl: 'https://liff.line.me/1621199246-zJXb0Rx4/LINE-mini/ui/store/reservation/entry/?storeId=179&utm_source=01linemini_shoppage',
    hoursSourceUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',
    hours: { 0:['10:30','23:00'],1:['11:00','23:00'],2:['11:00','23:00'],3:['11:00','23:00'],4:['11:00','23:00'],5:['11:00','23:00'],6:['10:30','23:00'] },
  },
  hamazushi: {
    chain: 'hamazushi',
    name: 'はま寿司 豊橋新栄店',
    statusUrl: 'https://my.hamazushi.com/shop/index/?search=1&shopId=148',
    reservationUrl: 'https://www.hamazushi.com/app/',
    hoursSourceUrl: 'https://maps.hama-sushi.co.jp/jp/detail/4208.html',
    hours: { 0:['10:00','23:00'],1:['10:00','23:00'],2:['10:00','23:00'],3:['10:00','23:00'],4:['10:00','23:00'],5:['10:00','23:00'],6:['10:00','23:00'] },
  },
  kurasushi: {
    chain: 'kurasushi',
    name: 'くら寿司 豊橋新栄店',
    statusUrl: 'https://shop.kurasushi.co.jp/detail/609',
    reservationUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hoursSourceUrl: 'https://shop.kurasushi.co.jp/detail/609',
    hours: { 0:['10:20','23:00'],1:['11:00','23:00'],2:['11:00','23:00'],3:['11:00','23:00'],4:['11:00','23:00'],5:['11:00','23:00'],6:['10:20','23:00'] },
  },
  kappasushi: {
    chain: 'kappasushi',
    name: 'かっぱ寿司 豊橋飯村店',
    statusUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    reservationUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    hoursSourceUrl: 'https://www.kappasushi.jp/shop/0220',
    hours: { 0:['10:00','23:00'],1:['10:30','23:00'],2:['10:30','23:00'],3:['10:30','23:00'],4:['10:30','23:00'],5:['10:30','23:00'],6:['10:00','23:30'] },
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

function htmlToText(html = '') {
  return clean(decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

async function fetchPageText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return htmlToText(await response.text());
}

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    weekday: ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[map.weekday],
    nowMinutes: Number(map.hour) * 60 + Number(map.minute),
  };
}

function minutesFromTime(value) {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
}

function businessStatus(store) {
  const now = jstParts();
  const [openTime, closeTime] = store.hours[now.weekday] || [];
  if (!openTime || !closeTime) return { state:'unknown', openTime:null, closeTime:null, hoursLabel:'営業時間は公式サイトで確認' };
  const open = minutesFromTime(openTime);
  const close = minutesFromTime(closeTime);
  const state = now.nowMinutes < open ? 'before_open' : now.nowMinutes >= close ? 'after_close' : 'open';
  return { state, openTime, closeTime, hoursLabel:`${openTime}〜${closeTime}` };
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
    detail: extra || `通常営業時間 ${business.hoursLabel}`,
    reservationUrl: store.reservationUrl,
    status: 'ok',
  }, store, business);
}

function levelFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

function parsePublicWait(text) {
  const minutePatterns = [
    /現在の待ち時間[^0-9]{0,40}(\d{1,3})\s*分/,
    /待ち時間(?:の目安)?[^0-9]{0,40}(\d{1,3})\s*分/,
    /ただいま[^0-9]{0,50}(\d{1,3})\s*分待ち/,
  ];
  for (const pattern of minutePatterns) {
    const match = text.match(pattern);
    if (match) {
      const waitMinutes = Number(match[1]);
      if (Number.isFinite(waitMinutes) && waitMinutes >= 0 && waitMinutes <= 240) return { waitMinutes, waitGroups:null };
    }
  }
  const groupPatterns = [
    /現在[^0-9]{0,40}(\d{1,3})\s*組(?:待ち|お待ち)/,
    /ただいま[^0-9]{0,40}(\d{1,3})\s*組(?:待ち|お待ち)/,
  ];
  for (const pattern of groupPatterns) {
    const match = text.match(pattern);
    if (match) {
      const waitGroups = Number(match[1]);
      if (Number.isFinite(waitGroups) && waitGroups >= 0 && waitGroups <= 200) return { waitMinutes:null, waitGroups };
    }
  }
  return null;
}

async function getSushiroOrHama(store) {
  const business = businessStatus(store);
  if (business.state !== 'open') return outsideHours(store, business, `通常営業時間 ${business.hoursLabel}`);
  try {
    const text = await fetchPageText(store.statusUrl);
    const wait = parsePublicWait(text);
    if (wait?.waitMinutes != null) {
      return withBusiness({
        chain: store.chain, storeName: store.name, method:'actual_wait',
        level: levelFromMinutes(wait.waitMinutes), waitMinutes:wait.waitMinutes, waitGroups:null,
        label:`約${wait.waitMinutes}分待ち`, detail:'公式受付・予約ページの公開表示から取得',
        reservationUrl:store.reservationUrl, status:'ok',
      }, store, business);
    }
    if (wait?.waitGroups != null) {
      const level = wait.waitGroups <= 2 ? 'low' : wait.waitGroups <= 6 ? 'medium' : 'high';
      return withBusiness({
        chain: store.chain, storeName: store.name, method:'actual_wait',
        level, waitMinutes:null, waitGroups:wait.waitGroups,
        label:`${wait.waitGroups}組待ち`, detail:'公式受付・予約ページの公開表示から取得',
        reservationUrl:store.reservationUrl, status:'ok',
      }, store, business);
    }
  } catch {}

  const detail = store.chain === 'sushiro'
    ? 'スシロー公式アプリには現在待ち時間の表示がありますが、公開ページから自動取得できる値は確認できていません。'
    : 'はま寿司は順番待ち・時間指定予約がログイン後の機能中心で、公開ページから現在待ちを自動取得できる値は確認できていません。';
  return withBusiness({
    chain:store.chain, storeName:store.name, method:'official_link', level:'unknown',
    label:'公式予約で確認', detail, reservationUrl:store.reservationUrl, status:'link_only',
  }, store, business);
}

async function getKura() {
  const store = stores.kurasushi;
  const business = businessStatus(store);
  let earliestSlot = null;
  try {
    const text = await fetchPageText(store.statusUrl);
    const match = text.match(/最短予約可能時間\s*([0-2]?\d:\d{2})\s*[～〜~\-–—]\s*([0-2]?\d:\d{2})/);
    earliestSlot = match?.[1] || null;
  } catch {}

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
  }, store, business);
}

async function getKappa() {
  const store = stores.kappasushi;
  const business = businessStatus(store);
  if (business.state !== 'open') {
    return outsideHours(store, business, `通常営業時間 ${business.hoursLabel}。店頭待ち人数は営業時間外のため混雑判定に使用しません`);
  }
  try {
    const text = await fetchPageText(store.statusUrl);
    if (/現在[、,\s]*お待ちのお客様はいらっしゃいません/.test(text)) {
      return withBusiness({
        chain:'kappasushi', storeName:store.name, method:'actual_wait', level:'low',
        waitGroups:0, waitMinutes:0, label:'待ちなし', detail:'現在、お待ちのお客様はいません',
        reservationUrl:store.reservationUrl, status:'ok',
      }, store, business);
    }
    const both = text.match(/現在[^0-9]{0,30}(\d+)\s*組[^0-9]{0,40}(\d+)\s*分待ち/);
    if (both) {
      const waitGroups = Number(both[1]);
      const waitMinutes = Number(both[2]);
      return withBusiness({
        chain:'kappasushi', storeName:store.name, method:'actual_wait', level:levelFromMinutes(waitMinutes),
        waitGroups, waitMinutes, label:`${waitGroups}組・約${waitMinutes}分待ち`, detail:'公式順番待ちページの現在表示',
        reservationUrl:store.reservationUrl, status:'ok',
      }, store, business);
    }
    const groups = text.match(/現在[^0-9]{0,30}(\d+)\s*組/);
    if (groups) {
      const waitGroups = Number(groups[1]);
      const level = waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high';
      return withBusiness({
        chain:'kappasushi', storeName:store.name, method:'actual_wait', level,
        waitGroups, waitMinutes:null, label:`${waitGroups}組待ち`, detail:'公式順番待ちページの現在表示',
        reservationUrl:store.reservationUrl, status:'ok',
      }, store, business);
    }
  } catch {}
  return withBusiness({
    chain:'kappasushi', storeName:store.name, method:'actual_wait', level:'unknown',
    waitGroups:null, waitMinutes:null, label:'待ち時間を取得できません', detail:'公式順番待ちページで確認してください',
    reservationUrl:store.reservationUrl, status:'warning',
  }, store, business);
}

const results = await Promise.all([
  getSushiroOrHama(stores.sushiro),
  getSushiroOrHama(stores.hamazushi),
  getKura(),
  getKappa(),
]);

const output = {
  updatedAt: new Date().toISOString(),
  timezone: 'Asia/Tokyo',
  source: 'github-actions-snapshot',
  disclaimer: '混雑状況は参考値です。くら寿司の日時指定予約枠は店頭待ちとは別に扱い、混雑度へ直接換算しません。各店の通常営業時間も考慮します。',
  stores: results,
};

await fs.mkdir(path.dirname(OUT), { recursive:true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
for (const store of results) console.log(`${store.chain}: ${store.label} / ${store.businessState}`);
