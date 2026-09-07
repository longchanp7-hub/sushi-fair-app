// Shared pure model: recompute phases at rendering time, including the JST date boundary.
export const CATALOG_VERSION = 1;
export const catalogToday = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function campaignPhase(c, today = catalogToday()) {
  if (c.endDate && c.endDate < today) return 'ended';
  if (c.startDate && c.startDate > today) return 'upcoming';
  return c.startDate ? 'active' : 'unknown';
}
export function canonicalCampaignUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    return u.href.replace(/\/$/, '');
  } catch { return null; }
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPES = {fair:'フェア',dessert:'スイーツ',lunch:'平日ランチ',takeout:'持ち帰り',benefit:'優待',preorder:'予約商品',store_limited:'店舗限定',other:'キャンペーン'};
export function visibleCampaigns(chain, today = catalogToday()) {
  return (chain.campaignCatalog || []).filter(c => campaignPhase(c,today) !== 'ended').sort((a,b) => {
    const pa=campaignPhase(a,today),pb=campaignPhase(b,today);
    return (pa==='upcoming'?1:0)-(pb==='upcoming'?1:0) || String(a.startDate||'').localeCompare(String(b.startDate||'')) || a.id.localeCompare(b.id);
  });
}
export function renderCampaignCatalog(chain, today = catalogToday()) {
  if (!chain.campaignCoverage && !chain.campaignCatalog) return '';
  const rows=visibleCampaigns(chain,today), coverage=chain.campaignCoverage;
  const warning=coverage?.state!=='complete' ? '<p role="status">告知一覧は一部未確認です。前回確認情報または公式リンクを表示しています。</p>' : '';
  const card = c => {
    const phase=campaignPhase(c,today),label=phase==='upcoming'?'開始予定':phase==='active'?'開催期間内':'期間要確認';
    const dates=c.startDate ? `${c.startDate}${c.endDate&&c.endDate!==c.startDate?` 〜 ${c.endDate}`:c.endDate?'（当日限定）':' 〜 終了日未確認'}` : c.endDate?`${c.endDate}まで（開始日未確認）`:'販売・実施期間は公式で確認';
    const products=(c.items||[]).filter(i=>campaignPhase(i,today)!=='ended');
    const itemList=products.length ? `<ul>${products.map(i=>`<li>${esc(i.name)} <strong>${i.price!=null?`${Number(i.price).toLocaleString('ja-JP')}円${i.priceType==='from'?'〜':''}`:'価格は公式で確認'}</strong></li>`).join('')}</ul>` : '';
    const url=canonicalCampaignUrl(c.sourceUrl);
    return `<details class="catalog-campaign" data-campaign-id="${esc(c.id)}" style="margin:10px 0;padding:10px;border:1px solid currentColor;border-radius:8px"><summary><strong>${esc(c.fairName)}</strong><br><small>${esc(label)} · ${esc(TYPES[c.category]||TYPES.other)} · ${esc(dates)}</small></summary><p>${esc(c.scopeNote||'対象店舗・利用条件は公式告知で確認してください。')}</p>${itemList}<p><small>${c.itemStatus==='parsed'?'本文から確認できた商品を掲載。画像内などの未取得商品がある場合があります。':'商品・価格の一覧は未取得です。0件＝商品なしではありません。'}</small></p>${c.retainedFromPrevious?'<p>前回確認情報を表示しています。</p>':''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">この告知を公式で確認</a>`:''}</details>`;
  };
  const active=rows.filter(c=>campaignPhase(c,today)!=='upcoming'),next=rows.filter(c=>campaignPhase(c,today)==='upcoming');
  const unconfirmed=coverage?.unconfirmedUrls?.length||0;
  return `<section class="campaign-catalog" aria-label="開催中・開始予定の公式告知"><h3>公式の関連キャンペーン</h3>${warning}${next.length?`<h4>近日開始 · ${next.length}件</h4>${next.map(card).join('')}`:''}${active.length?`<details class="catalog-current-group"><summary>開催期間内・期間要確認 · ${active.length}件を見る</summary>${active.map(card).join('')}</details>`:''}${!rows.length?'<p>掲載できる告知は未確認です。</p>':''}${unconfirmed?`<p><small>過去の告知${unconfirmed}件は現在の実施を確認できず、開催中には掲載していません。販売終了と断定したものではありません。</small></p>`:''}<small>一覧照合は対象範囲の告知収録確認です。商品・価格の完全取得や店舗在庫を保証するものではありません。</small></section>`;
}
