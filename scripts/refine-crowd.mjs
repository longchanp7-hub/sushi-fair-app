import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'crowd.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const publicStatusPages = {
  sushiro: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179',
  hamazushi: 'https://my.hamazushi.com/shop/index/?search=1&shopId=148',
};

function levelFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

function clean(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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
    const html = await response.text();
    const $ = cheerio.load(html);
    return clean($('body').text());
  } finally {
    clearTimeout(timer);
  }
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
      if (Number.isFinite(waitMinutes) && waitMinutes >= 0 && waitMinutes <= 240) {
        return { waitMinutes, waitGroups: null };
      }
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
      if (Number.isFinite(waitGroups) && waitGroups >= 0 && waitGroups <= 200) {
        return { waitMinutes: null, waitGroups };
      }
    }
  }
  return null;
}

function normalizeKura(store) {
  if (!store || store.chain !== 'kurasushi') return store;

  const reservationLabel = store.earliestSlot
    ? `予約枠：最短 ${store.earliestSlot}`
    : '予約枠：取得できません';

  const common = {
    ...store,
    level: 'unknown',
    estimatedMinutes: null,
    reservationLabel,
    reservationDetail: '日時指定の予約枠と、店頭の現在待ち・順番待ちは別の指標です。',
  };

  if (store.businessState === 'before_open') {
    return {
      ...common,
      label: `営業時間前（${store.openTime || '開店時刻'}開店）`,
      detail: `店頭混雑は営業時間前のため不明です。${reservationLabel}ですが、これを店頭混雑度には換算しません。`,
      status: 'ok',
    };
  }

  if (store.businessState === 'after_close') {
    return {
      ...common,
      label: '営業時間外',
      detail: `${reservationLabel}。予約枠と本日の店頭混雑は分けて表示しています。`,
      status: 'ok',
    };
  }

  if (store.businessState === 'open') {
    return {
      ...common,
      label: '店頭混雑は取得できません',
      detail: `${reservationLabel}。日時指定予約の空き状況だけでは、現在の店頭待ち時間は判断しません。`,
      status: store.earliestSlot ? 'ok' : 'warning',
    };
  }

  return {
    ...common,
    label: '店頭混雑は確認できません',
    detail: `${reservationLabel}。公式ページで最新状況をご確認ください。`,
  };
}

async function probeChain(store) {
  if (!store || !publicStatusPages[store.chain]) return store;
  if (store.businessState !== 'open') return store;

  try {
    const text = await fetchPageText(publicStatusPages[store.chain]);
    const wait = parsePublicWait(text);
    if (wait?.waitMinutes != null) {
      return {
        ...store,
        method: 'actual_wait',
        level: levelFromMinutes(wait.waitMinutes),
        waitMinutes: wait.waitMinutes,
        waitGroups: wait.waitGroups,
        label: `約${wait.waitMinutes}分待ち`,
        detail: '公式受付・予約ページの公開表示から取得',
        status: 'ok',
      };
    }
    if (wait?.waitGroups != null) {
      const level = wait.waitGroups <= 2 ? 'low' : wait.waitGroups <= 6 ? 'medium' : 'high';
      return {
        ...store,
        method: 'actual_wait',
        level,
        waitMinutes: null,
        waitGroups: wait.waitGroups,
        label: `${wait.waitGroups}組待ち`,
        detail: '公式受付・予約ページの公開表示から取得',
        status: 'ok',
      };
    }

    if (store.chain === 'sushiro') {
      return {
        ...store,
        level: 'unknown',
        label: '公式予約で確認',
        detail: 'スシロー公式アプリには現在待ち時間の表示がありますが、公開ページから自動取得できる値はまだ確認できていません。',
        status: 'link_only',
      };
    }

    return {
      ...store,
      level: 'unknown',
      label: '公式予約で確認',
      detail: 'はま寿司の順番待ち・時間指定予約はログイン後の機能が中心で、公開ページから現在待ちを自動取得できる値は確認できていません。',
      status: 'link_only',
    };
  } catch (error) {
    return {
      ...store,
      level: 'unknown',
      label: '公式予約で確認',
      detail: `${store.chain === 'sushiro' ? 'スシロー' : 'はま寿司'}の公開待ち情報を自動確認できませんでした。公式予約画面で確認してください。`,
      status: 'link_only',
      probeError: String(error.message || error),
    };
  }
}

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
const stores = [];
for (const store of data.stores || []) {
  if (store.chain === 'kurasushi') {
    stores.push(normalizeKura(store));
  } else if (store.chain === 'sushiro' || store.chain === 'hamazushi') {
    stores.push(await probeChain(store));
  } else {
    stores.push(store);
  }
}

data.stores = stores;
data.disclaimer = '混雑状況は参考値です。くら寿司の日時指定予約枠は店頭待ちとは別に扱い、混雑度へ直接換算しません。各店の通常営業時間も考慮します。';
await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
for (const store of stores) console.log(`${store.chain}: ${store.label}`);
