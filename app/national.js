import { initRegionSelector, resolveChainContext } from './region.js?v=20260825-1';

const chainMeta = {
  sushiro: { name:'スシロー', color:'#ef3e42' },
  hamazushi: { name:'はま寿司', color:'#4db79d' },
  kurasushi: { name:'くら寿司', color:'#f3f3f3' },
  kappasushi: { name:'かっぱ寿司', color:'#79c35a' },
  uobei: { name:'魚べい', color:'#f2c94c' },
};

let data = null;
let location = { prefecture:'愛知県', city:'豊橋市', prefectureCode:'23' };
let activeChain = 'all';

const cardsEl = document.querySelector('#cards');
const summaryEl = document.querySelector('#summary');
const updatedAtEl = document.querySelector('#updatedAt');
const refreshBtn = document.querySelector('#refreshBtn');
const todayHighlightsEl = document.querySelector('#todayHighlights');
const todayDateEl = document.querySelector('#todayDate');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ja-JP', { timeZone:'Asia/Tokyo', month:'numeric', day:'numeric' }).format(d);
}

function periodText(fair) {
  if (!fair.startDate && !fair.endDate) return '販売期間は公式情報で確認';
  if (fair.startDate && fair.endDate) return `${fmtDate(fair.startDate)} 〜 ${fmtDate(fair.endDate)}`;
  return fair.startDate ? `${fmtDate(fair.startDate)} 〜 なくなり次第終了等` : `〜 ${fmtDate(fair.endDate)}`;
}

function itemPeriod(item) {
  if (!item.startDate && !item.endDate) return '';
  return item.startDate && item.endDate
    ? `${fmtDate(item.startDate)}〜${fmtDate(item.endDate)}`
    : item.startDate ? `${fmtDate(item.startDate)}〜` : `〜${fmtDate(item.endDate)}`;
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}

function dayDiffFromToday(iso) {
  if (!iso) return null;
  const today = new Date(`${localDateKey()}T00:00:00+09:00`);
  const target = new Date(`${iso}T00:00:00+09:00`);
  return Math.round((target - today) / 86400000);
}

function remainingLabel(endDate) {
  const days = dayDiffFromToday(endDate);
  if (days === null) return '期間限定';
  if (days < 0) return '終了確認中';
  if (days === 0) return '本日まで';
  if (days <= 3) return `あと${days}日`;
  return '開催中';
}

function validItems(fair) {
  const today = localDateKey();
  const context = resolveChainContext(fair.chain, location);
  return (fair.items || []).filter(item => {
    if (item.saleStatus === 'ended' || (item.endDate && item.endDate < today)) return false;
    const regionCodes = item.availability?.regionCodes || item.regionCodes || null;
    if (Array.isArray(regionCodes) && regionCodes.length && context.value && !regionCodes.includes(context.value)) return false;
    return true;
  });
}

function scopeNote(fair) {
  if (fair.dataScope === 'reference_store_menu_overlay') {
    return `全国フェアの終了判定と店舗掲載を分離しています。商品・価格は代表店舗${fair.referenceStoreName ? `（${fair.referenceStoreName}）` : ''}の公式メニューも参考にしており、選択地域では異なる場合があります。`;
  }
  if (fair.dataScope === 'official_menu_with_regional_variation') {
    return '公式メニューを基準に表示しています。地域限定・都市型店舗などで商品や価格が異なる場合があります。';
  }
  if (fair.dataScope === 'national_official_release') {
    return '全国向けの公式発表を基準に表示しています。店舗ごとの価格・取扱い・売切れは公式店舗情報で確認してください。';
  }
  return '公式フェア情報を基準に表示し、店舗固有の品切れと販売終了を分けて扱います。';
}

function renderTodayHighlights(chains) {
  todayDateEl.textContent = new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'numeric', day:'numeric', weekday:'short'
  }).format(new Date());
  const startsToday = chains.filter(fair => fair.startDate === localDateKey());
  const endingSoon = chains
    .map(fair => ({ fair, days:dayDiffFromToday(fair.endDate) }))
    .filter(x => x.days !== null && x.days >= 0 && x.days <= 3)
    .sort((a,b) => a.days - b.days);
  const selected = startsToday.length ? startsToday : endingSoon.length ? endingSoon.map(x => x.fair) : chains.slice(0, 3);
  const title = startsToday.length ? '本日スタート' : endingSoon.length ? 'もうすぐ終了' : '今日の注目';
  todayHighlightsEl.innerHTML = `<div class="highlight-group calm"><div class="highlight-title"><span>🍣</span><strong>${title}</strong></div>${selected.map(fair => {
    const meta = chainMeta[fair.chain];
    const first = validItems(fair)[0];
    return `<a class="highlight-card" href="${escapeHtml(fair.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer"><div><span class="highlight-chain">${escapeHtml(meta?.name || fair.chain)}</span><strong>${escapeHtml(fair.fairName || '期間限定メニュー')}</strong>${first ? `<small>${escapeHtml(first.name)}${first.price ? ` ・ ${Number(first.price).toLocaleString('ja-JP')}円` : ''}</small>` : ''}</div><span class="highlight-deadline">${escapeHtml(remainingLabel(fair.endDate))}</span></a>`;
  }).join('')}</div>`;
}

function contextHtml(fair) {
  const context = resolveChainContext(fair.chain, location);
  return `<div class="region-context"><strong>${escapeHtml(location.prefecture)} ${escapeHtml(location.city)}</strong><span>${escapeHtml(context.label)}</span><small>${escapeHtml(context.note)}</small></div>`;
}

function render() {
  if (!data) return;
  const allChains = data.chains || [];
  const fairs = allChains.filter(x => activeChain === 'all' || x.chain === activeChain);
  renderTodayHighlights(allChains);

  summaryEl.innerHTML = allChains.map(fair => {
    const meta = chainMeta[fair.chain] || { name:fair.chain, color:'#888' };
    const items = validItems(fair);
    const image = fair.imageUrl ? `<img src="${escapeHtml(fair.imageUrl)}" alt="${escapeHtml(meta.name)}の公式フェア画像" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.chain-summary').classList.add('image-failed');this.remove()">` : '';
    return `<a class="chain-summary" href="${escapeHtml(fair.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer" style="--chain-color:${meta.color}"><div class="chain-summary-media">${image}<span class="chain-summary-fallback">🍣</span></div><div class="chain-summary-body"><div><strong>${escapeHtml(meta.name)}</strong><span>${items.length}品</span></div><small>${escapeHtml(fair.fairName || '開催中フェア')}</small></div><span class="chain-summary-arrow">↗</span></a>`;
  }).join('');

  cardsEl.innerHTML = fairs.map(fair => {
    const meta = chainMeta[fair.chain] || { name:fair.chain, color:'#888' };
    const allItems = validItems(fair);
    const items = allItems.slice(0, 10);
    const itemHtml = items.length
      ? `<ul class="items">${items.map(item => {
          const stale = item.scrapeStatus && item.scrapeStatus !== 'ok';
          return `<li class="item${stale ? ' item-stale' : ''}"><span class="item-name">${escapeHtml(item.name)}${itemPeriod(item) ? `<small class="item-period">${escapeHtml(itemPeriod(item))}</small>` : ''}</span><span class="price">${item.price != null ? `${Number(item.price).toLocaleString('ja-JP')}円` : '価格確認'}</span></li>`;
        }).join('')}</ul>${allItems.length > items.length ? `<div class="more">ほか ${allItems.length - items.length} 品</div>` : ''}`
      : `<div class="empty">個別商品の自動取得は確認中です。フェア自体を販売終了とは扱わず、公式ページへの導線を表示しています。</div>`;
    const warning = fair.status !== 'ok' ? `<div class="error-banner">${escapeHtml(fair.message || '公式情報の一部を取得できませんでした。')}</div>` : '';
    const priceNote = fair.priceNote ? `<p class="price-note">※ ${escapeHtml(fair.priceNote)}</p>` : '';
    return `<article class="card" style="--chain-color:${meta.color}"><div class="card-top"><div><div class="chain">${escapeHtml(meta.name)}</div><div class="store">全国フェア + 選択地域</div></div><span class="badge">${escapeHtml(remainingLabel(fair.endDate))}</span></div><h2>${escapeHtml(fair.fairName || '期間限定メニュー')}</h2><p class="period">${escapeHtml(periodText(fair))}</p>${contextHtml(fair)}<p class="price-note">${escapeHtml(scopeNote(fair))}</p>${warning}${itemHtml}${priceNote}<div class="actions"><a class="primary" href="${escapeHtml(fair.sourceUrl || '#')}" target="_blank" rel="noopener">公式フェア</a><a class="secondary official-action" href="${escapeHtml(fair.officialActionUrl || fair.storeUrl || '#')}" target="_blank" rel="noopener">混雑・予約を公式で確認</a></div></article>`;
  }).join('');
}

async function loadData() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '↻ 読込中';
  try {
    const res = await fetch(`./data/fairs.json?v=national-${Date.now()}`, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    const updated = new Date(data.updatedAt);
    updatedAtEl.textContent = `最終更新 ${new Intl.DateTimeFormat('ja-JP', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Tokyo' }).format(updated)}`;
    render();
  } catch (error) {
    updatedAtEl.textContent = 'データを読み込めませんでした';
    cardsEl.innerHTML = `<div class="error-banner">${escapeHtml(error.message)}</div>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ 更新';
  }
}

document.querySelector('#filters')?.addEventListener('click', event => {
  const button = event.target.closest('.filter');
  if (!button) return;
  activeChain = button.dataset.chain;
  document.querySelectorAll('.filter').forEach(el => el.classList.toggle('active', el === button));
  render();
});
refreshBtn?.addEventListener('click', loadData);

location = await initRegionSelector({ onChange: next => { location = next; render(); } });
await loadData();
