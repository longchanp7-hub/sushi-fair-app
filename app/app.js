const chainMeta = {
  sushiro: { name: 'スシロー', color: '#ef3e42' },
  hamazushi: { name: 'はま寿司', color: '#4db79d' },
  kurasushi: { name: 'くら寿司', color: '#f3f3f3' },
  kappasushi: { name: 'かっぱ寿司', color: '#79c35a' },
};

let data = null;
let activeChain = 'all';

const cardsEl = document.querySelector('#cards');
const summaryEl = document.querySelector('#summary');
const updatedAtEl = document.querySelector('#updatedAt');
const refreshBtn = document.querySelector('#refreshBtn');
const todayHighlightsEl = document.querySelector('#todayHighlights');
const todayDateEl = document.querySelector('#todayDate');

function fmtDate(iso) {
  if (!iso) return '期間は公式サイトで確認';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(d);
}

function periodText(fair) {
  if (!fair.startDate && !fair.endDate) return '期間は公式サイトで確認';
  if (fair.startDate && fair.endDate) return `${fmtDate(fair.startDate)} 〜 ${fmtDate(fair.endDate)}`;
  return fair.startDate ? `${fmtDate(fair.startDate)} 〜` : `〜 ${fmtDate(fair.endDate)}`;
}

function remainingLabel(endDate) {
  if (!endDate) return '期間限定';
  const todayKey = localDateKey();
  const today = new Date(`${todayKey}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  const days = Math.round((end - today) / 86400000);
  if (days < 0) return '終了予定';
  if (days === 0) return '本日まで';
  if (days <= 3) return `あと${days}日`;
  return '開催中';
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function dayDiffFromToday(iso) {
  if (!iso) return null;
  const todayKey = localDateKey();
  const today = new Date(`${todayKey}T00:00:00+09:00`);
  const target = new Date(`${iso}T00:00:00+09:00`);
  return Math.round((target - today) / 86400000);
}

function renderTodayHighlights(allChains) {
  const todayKey = localDateKey();
  todayDateEl.textContent = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short'
  }).format(new Date());

  const startsToday = allChains.filter(fair => fair.startDate === todayKey);
  const endingSoon = allChains
    .map(fair => ({ fair, days: dayDiffFromToday(fair.endDate) }))
    .filter(x => x.days !== null && x.days >= 0 && x.days <= 3)
    .sort((a, b) => a.days - b.days);

  const blocks = [];
  if (startsToday.length) {
    blocks.push(`
      <div class="highlight-group hot">
        <div class="highlight-title"><span>🔥</span><strong>本日スタート</strong><em>${startsToday.length}件</em></div>
        ${startsToday.map(fair => highlightCard(fair, '今日から')).join('')}
      </div>`);
  }

  if (endingSoon.length) {
    blocks.push(`
      <div class="highlight-group soon">
        <div class="highlight-title"><span>⏰</span><strong>もうすぐ終了</strong><em>${endingSoon.length}件</em></div>
        ${endingSoon.map(({ fair, days }) => highlightCard(fair, days === 0 ? '本日まで' : days === 1 ? '明日まで' : `あと${days}日`)).join('')}
      </div>`);
  }

  if (!blocks.length) {
    const active = allChains.slice(0, 2);
    blocks.push(`
      <div class="highlight-group calm">
        <div class="highlight-title"><span>🍣</span><strong>今日の注目</strong></div>
        ${active.map(fair => highlightCard(fair, remainingLabel(fair.endDate))).join('')}
      </div>`);
  }

  todayHighlightsEl.innerHTML = blocks.join('');
}

function highlightCard(fair, label) {
  const meta = chainMeta[fair.chain];
  const first = fair.items?.[0];
  return `
    <a class="highlight-card" href="${escapeHtml(fair.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">
      <div>
        <span class="highlight-chain">${escapeHtml(meta.name)}</span>
        <strong>${escapeHtml(fair.fairName || first?.name || '期間限定メニュー')}</strong>
        ${first ? `<small>${escapeHtml(first.name)}${first.price ? ` ・ ${Number(first.price).toLocaleString('ja-JP')}円` : ''}</small>` : ''}
      </div>
      <span class="highlight-deadline">${escapeHtml(label)}</span>
    </a>`;
}

function render() {
  if (!data) return;
  const fairs = data.chains.filter(x => activeChain === 'all' || x.chain === activeChain);
  const allChains = data.chains || [];
  renderTodayHighlights(allChains);
  summaryEl.innerHTML = allChains.map(fair => {
    const meta = chainMeta[fair.chain];
    const count = fair.items?.length || 0;
    const image = fair.imageUrl
      ? `<img src="${escapeHtml(fair.imageUrl)}" alt="${escapeHtml(meta.name)}の公式フェア画像" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.chain-summary').classList.add('image-failed');this.remove()">`
      : '';
    return `
      <a class="chain-summary" href="${escapeHtml(fair.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer" style="--chain-color:${meta.color}">
        <div class="chain-summary-media">${image}<span class="chain-summary-fallback">🍣</span></div>
        <div class="chain-summary-body">
          <div><strong>${escapeHtml(meta.name)}</strong><span>${count}品</span></div>
          <small>${escapeHtml(fair.fairName || '開催中フェア')}</small>
        </div>
        <span class="chain-summary-arrow">↗</span>
      </a>`;
  }).join('');

  cardsEl.innerHTML = fairs.map(fair => {
    const meta = chainMeta[fair.chain];
    const items = (fair.items || []).slice(0, 8);
    const itemHtml = items.length
      ? `<ul class="items">${items.map(item => `
          <li class="item">
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="price">${item.price ? `${Number(item.price).toLocaleString('ja-JP')}円` : '—'}</span>
          </li>`).join('')}</ul>${(fair.items?.length || 0) > 8 ? `<div class="more">ほか ${fair.items.length - 8} 品</div>` : ''}`
      : `<div class="empty">商品一覧の自動取得に失敗しました。公式ページから確認できます。</div>`;

    return `
      <article class="card" style="--chain-color:${meta.color}">
        <div class="card-top">
          <div>
            <div class="chain">${meta.name}</div>
            <div class="store">${escapeHtml(fair.storeName || '')}</div>
          </div>
          <span class="badge">${remainingLabel(fair.endDate)}</span>
        </div>
        <h2>${escapeHtml(fair.fairName || '期間限定メニュー')}</h2>
        <p class="period">${periodText(fair)}</p>
        ${fair.status !== 'ok' ? `<div class="error-banner">${escapeHtml(fair.message || '最新情報の一部を取得できませんでした。')}</div>` : ''}
        ${itemHtml}
        <div class="actions">
          <a class="primary" href="${fair.sourceUrl}" target="_blank" rel="noopener">公式で確認</a>
          ${fair.storeUrl ? `<a class="secondary" href="${fair.storeUrl}" target="_blank" rel="noopener">店舗</a>` : ''}
        </div>
      </article>`;
  }).join('');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

async function loadData({ bustCache = false } = {}) {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '↻ 読込中';
  try {
    const suffix = bustCache ? `?t=${Date.now()}` : '';
    const res = await fetch(`./data/fairs.json${suffix}`, { cache: bustCache ? 'no-store' : 'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    const updated = new Date(data.updatedAt);
    updatedAtEl.textContent = `最終更新 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(updated)}`;
    render();
  } catch (err) {
    updatedAtEl.textContent = 'データを読み込めませんでした';
    cardsEl.innerHTML = `<div class="error-banner">${escapeHtml(err.message)}</div>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ 更新';
  }
}

document.querySelector('#filters').addEventListener('click', event => {
  const button = event.target.closest('.filter');
  if (!button) return;
  activeChain = button.dataset.chain;
  document.querySelectorAll('.filter').forEach(el => el.classList.toggle('active', el === button));
  render();
});

refreshBtn.addEventListener('click', () => loadData({ bustCache: true }));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

loadData();
