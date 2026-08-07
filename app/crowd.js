import { FEATURES, crowdFeatureEnabled } from './features.js?v=20260807-2';

const chainMeta = {
  sushiro: { name: 'スシロー', dot: '🔴' },
  hamazushi: { name: 'はま寿司', dot: '🟢' },
  kurasushi: { name: 'くら寿司', dot: '⚪' },
  kappasushi: { name: 'かっぱ寿司', dot: '🟢' },
};

const fallbackStores = [
  {
    chain: 'sushiro',
    storeName: 'スシロー 豊橋新栄店',
    method: 'official_link',
    level: 'unknown',
    label: '公式予約で確認',
    detail: '店舗ページからLINE受付・予約へ進めます',
    reservationUrl: 'https://www.akindo-sushiro.co.jp/shop/detail.php?id=142',
    status: 'link_only',
  },
  {
    chain: 'hamazushi',
    storeName: 'はま寿司 豊橋新栄店',
    method: 'official_link',
    level: 'unknown',
    label: '公式アプリで確認',
    detail: '順番待ち・日時指定予約は公式アプリで確認します',
    reservationUrl: 'https://www.hamazushi.com/app/',
    status: 'link_only',
  },
  {
    chain: 'kurasushi',
    storeName: 'くら寿司 豊橋新栄店',
    method: 'reservation_slot',
    level: 'unknown',
    label: '予約ページで確認',
    detail: '最短予約可能時間を公式ページで確認できます',
    reservationUrl: 'https://shop.kurasushi.co.jp/detail/609',
    status: 'link_only',
  },
  {
    chain: 'kappasushi',
    storeName: 'かっぱ寿司 豊橋飯村店',
    method: 'actual_wait',
    level: 'unknown',
    label: '順番待ちを確認',
    detail: '公式順番待ちページを開きます',
    reservationUrl: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
    status: 'link_only',
  },
];

let lastFetchAt = 0;
let inFlight = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function levelLabel(level) {
  return ({ low: '空き', medium: 'やや混雑', high: '混雑', very_high: 'かなり混雑', unknown: '確認' })[level] || '確認';
}

function displayStateLabel(store) {
  if (store.businessState === 'before_open') {
    return store.level && store.level !== 'unknown'
      ? `${levelLabel(store.level)}（営業時間前）`
      : '営業時間前';
  }
  if (store.businessState === 'after_close') return '営業時間外';
  return levelLabel(store.level);
}

function levelIcon(store) {
  if (store.businessState === 'before_open' && (!store.level || store.level === 'unknown')) return '🕘';
  if (store.businessState === 'after_close') return '🌙';
  return ({ low: '🟢', medium: '🟡', high: '🟠', very_high: '🔴', unknown: '⚪' })[store.level] || '⚪';
}

function methodLabel(method) {
  return ({ actual_wait: '実待ち', reservation_slot: '予約枠から推定', official_link: '公式確認' })[method] || '参考';
}

function formatUpdatedAt(iso) {
  if (!iso) return '取得時刻なし';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '取得時刻なし';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function ageMinutes(iso) {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 60000));
}

function renderCrowd(data, { error = null } = {}) {
  const panel = document.querySelector('#crowdPanel');
  const grid = document.querySelector('#crowdGrid');
  const updated = document.querySelector('#crowdUpdatedAt');
  const mode = document.querySelector('#crowdMode');
  if (!panel || !grid || !updated || !mode) return;

  panel.hidden = false;
  const stores = Array.isArray(data?.stores) && data.stores.length ? data.stores : fallbackStores;
  updated.textContent = data?.updatedAt ? `取得 ${formatUpdatedAt(data.updatedAt)}` : '取得時刻なし';

  const age = ageMinutes(data?.updatedAt);
  if (error) {
    mode.textContent = `混雑スナップショット取得失敗・公式リンクを表示中（${error}）`;
    mode.className = 'crowd-mode warning';
  } else if (age !== null && age > 10) {
    mode.textContent = `GitHub Actionsの更新が遅れています（約${age}分前の情報）`;
    mode.className = 'crowd-mode warning';
  } else if (age !== null) {
    mode.textContent = `約5分ごとに自動更新・現在は約${age}分前の情報`;
    mode.className = 'crowd-mode live';
  } else {
    mode.textContent = '約5分ごとの混雑スナップショットを表示';
    mode.className = 'crowd-mode fallback';
  }

  grid.innerHTML = stores.map(store => {
    const meta = chainMeta[store.chain] || { name: store.chain || '店舗', dot: '⚪' };
    const statusClass = `level-${escapeHtml(store.level || 'unknown')} business-${escapeHtml(store.businessState || 'unknown')}`;
    const buttonText = store.method === 'official_link' ? '予約を確認' : '公式で確認';
    const detail = store.detail || '公式予約ページで最新状況をご確認ください';
    const label = store.label || displayStateLabel(store);
    const hours = store.hoursLabel ? `通常営業時間 ${store.hoursLabel}` : '';
    return `
      <article class="crowd-card ${statusClass}">
        <div class="crowd-card-head">
          <div>
            <span class="crowd-chain">${meta.dot} ${escapeHtml(meta.name)}</span>
            <strong>${escapeHtml(store.storeName || '')}</strong>
          </div>
          <span class="crowd-method">${escapeHtml(methodLabel(store.method))}</span>
        </div>
        <div class="crowd-status-row">
          <span class="crowd-level-icon">${levelIcon(store)}</span>
          <div>
            <b>${escapeHtml(label)}</b>
            <small>${escapeHtml(detail)}</small>
            ${hours ? `<small>${escapeHtml(hours)}</small>` : ''}
          </div>
        </div>
        <div class="crowd-card-foot">
          <span>${escapeHtml(displayStateLabel(store))}</span>
          <a href="${escapeHtml(store.reservationUrl || '#')}" target="_blank" rel="noopener noreferrer">${buttonText} ↗</a>
        </div>
      </article>`;
  }).join('');
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadCrowd({ force = false } = {}) {
  if (!crowdFeatureEnabled()) return;
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastFetchAt < 3000) return;

  const button = document.querySelector('#crowdRefreshBtn');
  const grid = document.querySelector('#crowdGrid');
  if (button) {
    button.disabled = true;
    button.textContent = '↻ 取得中';
  }
  if (grid && !grid.children.length) grid.innerHTML = '<div class="crowd-loading">最新の混雑スナップショットを確認しています…</div>';

  inFlight = (async () => {
    try {
      const snapshot = await fetchJson(FEATURES.crowd.snapshotUrl, FEATURES.crowd.requestTimeoutMs);
      lastFetchAt = Date.now();
      renderCrowd(snapshot);
    } catch (error) {
      lastFetchAt = Date.now();
      renderCrowd({ updatedAt: null, stores: fallbackStores }, { error: error.name === 'AbortError' ? 'タイムアウト' : error.message });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '↻ 混雑を更新';
      }
      inFlight = null;
    }
  })();

  return inFlight;
}

export function initCrowd() {
  const panel = document.querySelector('#crowdPanel');
  if (!crowdFeatureEnabled()) {
    if (panel) panel.hidden = true;
    return;
  }

  if (panel) panel.hidden = false;
  const refresh = document.querySelector('#crowdRefreshBtn');
  refresh?.addEventListener('click', () => loadCrowd({ force: true }));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastFetchAt >= FEATURES.crowd.refreshOnReturnAfterMs) {
      loadCrowd({ force: true });
    }
  });

  window.addEventListener('pageshow', () => {
    if (Date.now() - lastFetchAt >= FEATURES.crowd.refreshOnReturnAfterMs) loadCrowd({ force: true });
  });

  loadCrowd({ force: true });
}

export { loadCrowd };
