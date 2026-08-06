import { FEATURES, crowdFeatureEnabled, resolveCrowdApiUrl } from './features.js?v=20260807-1';

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

function levelIcon(level) {
  return ({ low: '🟢', medium: '🟡', high: '🟠', very_high: '🔴', unknown: '⚪' })[level] || '⚪';
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

function renderCrowd(data, { live = false, error = null } = {}) {
  const panel = document.querySelector('#crowdPanel');
  const grid = document.querySelector('#crowdGrid');
  const updated = document.querySelector('#crowdUpdatedAt');
  const mode = document.querySelector('#crowdMode');
  if (!panel || !grid || !updated || !mode) return;

  panel.hidden = false;
  const stores = Array.isArray(data?.stores) && data.stores.length ? data.stores : fallbackStores;
  updated.textContent = data?.updatedAt ? `取得 ${formatUpdatedAt(data.updatedAt)}` : '取得時刻なし';

  if (error) {
    mode.textContent = `リアルタイム取得失敗・公式リンクを表示中（${error}）`;
    mode.className = 'crowd-mode warning';
  } else if (live) {
    mode.textContent = '起動時に公式予約情報をリアルタイム取得';
    mode.className = 'crowd-mode live';
  } else {
    mode.textContent = 'リアルタイムAPI未接続・前回取得データ／公式リンクを表示';
    mode.className = 'crowd-mode fallback';
  }

  grid.innerHTML = stores.map(store => {
    const meta = chainMeta[store.chain] || { name: store.chain || '店舗', dot: '⚪' };
    const statusClass = `level-${escapeHtml(store.level || 'unknown')}`;
    const buttonText = store.method === 'official_link' ? '予約を確認' : '公式で確認';
    const detail = store.detail || '公式予約ページで最新状況をご確認ください';
    const label = store.label || levelLabel(store.level);
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
          <span class="crowd-level-icon">${levelIcon(store.level)}</span>
          <div>
            <b>${escapeHtml(label)}</b>
            <small>${escapeHtml(detail)}</small>
          </div>
        </div>
        <div class="crowd-card-foot">
          <span>${escapeHtml(levelLabel(store.level))}</span>
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
  if (grid && !grid.children.length) grid.innerHTML = '<div class="crowd-loading">混雑情報を確認しています…</div>';

  inFlight = (async () => {
    const apiUrl = resolveCrowdApiUrl();
    try {
      if (apiUrl) {
        const endpoint = apiUrl.endsWith('/crowd') ? apiUrl : `${apiUrl}/crowd`;
        const liveData = await fetchJson(endpoint, FEATURES.crowd.requestTimeoutMs);
        lastFetchAt = Date.now();
        renderCrowd(liveData, { live: true });
        return;
      }

      const fallback = await fetchJson(FEATURES.crowd.fallbackUrl, FEATURES.crowd.requestTimeoutMs);
      lastFetchAt = Date.now();
      renderCrowd(fallback, { live: false });
    } catch (error) {
      lastFetchAt = Date.now();
      renderCrowd({ updatedAt: null, stores: fallbackStores }, { live: false, error: error.name === 'AbortError' ? 'タイムアウト' : error.message });
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
