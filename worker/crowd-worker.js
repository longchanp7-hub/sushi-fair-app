const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const STORES = {
  sushiro: {
    name: 'スシロー 豊橋新栄店',
    reservationUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',
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

function htmlToText(html = '') {
  return clean(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'"));
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
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

function jstMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function levelFromMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'unknown';
  if (minutes <= 10) return 'low';
  if (minutes <= 30) return 'medium';
  if (minutes <= 60) return 'high';
  return 'very_high';
}

async function getKappa() {
  const store = STORES.kappasushi;
  try {
    const text = await fetchText(store.statusUrl);
    if (/現在[、,\s]*お待ちのお客様はいらっしゃいません/.test(text)) {
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: 'low', waitGroups: 0, waitMinutes: 0,
        label: '待ちなし', detail: '公式順番待ちページの現在表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    const both = text.match(/現在[^0-9]{0,30}(\d+)\s*組[^0-9]{0,40}(\d+)\s*分待ち/);
    if (both) {
      const waitGroups = Number(both[1]);
      const waitMinutes = Number(both[2]);
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: levelFromMinutes(waitMinutes), waitGroups, waitMinutes,
        label: `${waitGroups}組・約${waitMinutes}分待ち`, detail: '公式順番待ちページの現在表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    const groups = text.match(/現在[^0-9]{0,30}(\d+)\s*組/);
    if (groups) {
      const waitGroups = Number(groups[1]);
      return {
        chain: 'kappasushi', storeName: store.name,
        method: 'actual_wait', level: waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high',
        waitGroups, waitMinutes: null, label: `${waitGroups}組待ち`, detail: '公式順番待ちページの現在表示',
        reservationUrl: store.reservationUrl, status: 'ok',
      };
    }

    return {
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '待ち時間を取得できません', detail: '公式ページを開いて確認してください',
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  } catch (error) {
    return {
      chain: 'kappasushi', storeName: store.name,
      method: 'actual_wait', level: 'unknown', waitGroups: null, waitMinutes: null,
      label: '取得エラー', detail: String(error.message || error),
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  }
}

async function getKura() {
  const store = STORES.kurasushi;
  try {
    const text = await fetchText(store.statusUrl);
    const slot = text.match(/最短予約可能時間\s*([0-2]?\d:\d{2})\s*[～〜~\-–—]\s*([0-2]?\d:\d{2})/);
    if (!slot) {
      return {
        chain: 'kurasushi', storeName: store.name,
        method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
        label: '予約枠を取得できません', detail: '公式店舗ページで確認してください',
        reservationUrl: store.reservationUrl, status: 'warning',
      };
    }

    const earliestSlot = slot[1];
    const [hour, minute] = earliestSlot.split(':').map(Number);
    let estimatedMinutes = hour * 60 + minute - jstMinutesNow();
    if (estimatedMinutes < -30) estimatedMinutes += 1440;
    const plausible = estimatedMinutes >= 0 && estimatedMinutes <= 240;

    return {
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot',
      level: plausible ? levelFromMinutes(estimatedMinutes) : 'unknown',
      earliestSlot,
      estimatedMinutes: plausible ? estimatedMinutes : null,
      label: plausible ? `最短 ${earliestSlot}（約${estimatedMinutes}分後）` : `最短予約 ${earliestSlot}`,
      detail: '予約可能時刻からの推定です。実際の店頭待ち時間とは異なる場合があります',
      reservationUrl: store.reservationUrl, status: 'ok',
    };
  } catch (error) {
    return {
      chain: 'kurasushi', storeName: store.name,
      method: 'reservation_slot', level: 'unknown', earliestSlot: null, estimatedMinutes: null,
      label: '取得エラー', detail: String(error.message || error),
      reservationUrl: store.reservationUrl, status: 'warning',
    };
  }
}

function linkOnly(chain, detail) {
  const store = STORES[chain];
  return {
    chain,
    storeName: store.name,
    method: 'official_link',
    level: 'unknown',
    label: '公式予約で確認',
    detail,
    reservationUrl: store.reservationUrl,
    status: 'link_only',
  };
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...corsHeaders(),
    },
  });
}

async function buildCrowd() {
  const [kura, kappa] = await Promise.all([getKura(), getKappa()]);
  return {
    updatedAt: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    source: 'live',
    disclaimer: '混雑状況は参考値です。予約枠からの推定は実際の待ち時間と一致しない場合があります。',
    stores: [
      linkOnly('sushiro', '店舗ページからLINE受付・予約へ進めます'),
      linkOnly('hamazushi', '公式アプリで順番待ち・日時指定予約を確認します'),
      kura,
      kappa,
    ],
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, time: new Date().toISOString() });
    if (url.pathname !== '/' && url.pathname !== '/crowd') return json({ error: 'Not Found' }, 404);

    try {
      return json(await buildCrowd());
    } catch (error) {
      return json({ error: String(error.message || error), updatedAt: new Date().toISOString() }, 500);
    }
  },
};
