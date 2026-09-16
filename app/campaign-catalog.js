// Shared pure model: recompute phases at rendering time, including the JST date boundary.
export const CATALOG_VERSION = 2;
export const catalogToday = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function campaignPhase(c, today = catalogToday()) {
  if (c.endDate && c.endDate < today) return 'ended';
  if (c.startDate && c.startDate > today) return 'upcoming';
  return c.startDate ? 'active' : 'unknown';
}
function displayPhase(c, today = catalogToday()) {
  const dated=campaignPhase(c,today);
  if(dated!=='unknown')return dated;
  return ['active','upcoming','ended'].includes(c?.campaignPhase)?c.campaignPhase:'unknown';
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
export function visibleConcurrentCampaigns(chain, today = catalogToday()) {
  if(Array.isArray(chain.campaignCatalog))return [];
  return (chain.campaigns || []).filter(c=>displayPhase(c,today)!=='ended').sort((a,b)=>{
    const pa=displayPhase(a,today),pb=displayPhase(b,today);
    return (pa==='upcoming'?1:0)-(pb==='upcoming'?1:0) || String(a.startDate||'').localeCompare(String(b.startDate||'')) || String(a.id||a.fairName).localeCompare(String(b.id||b.fairName));
  });
}
function renderCard(c,today,attribute='data-campaign-id') {
  const phase=displayPhase(c,today),label=phase==='upcoming'?'開始予定':phase==='active'?'開催中':'期間要確認';
  const dates=c.startDate ? `${c.startDate}${c.endDate&&c.endDate!==c.startDate?` 〜 ${c.endDate}`:c.endDate?'（当日限定）':' 〜 終了日未確認'}` : c.endDate?`${c.endDate}まで（開始日未確認）`:'販売・実施期間は公式で確認';
  const products=(c.items||[]).filter(i=>i?.saleStatus!=='ended'&&campaignPhase(i,today)!=='ended');
  const itemList=products.length ? `<ul>${products.map(i=>`<li>${esc(i.name)} <strong>${i.price!=null?`${Number(i.price).toLocaleString('ja-JP')}円${i.priceType==='from'?'〜':''}`:'価格は公式で確認'}</strong></li>`).join('')}</ul>` : '';
  const url=canonicalCampaignUrl(c.sourceUrl);
  const id=esc(c.id||`${c.fairName}|${c.sourceUrl||''}`);
  return `<details class="catalog-campaign" ${attribute}="${id}" style="margin:10px 0;padding:10px;border:1px solid currentColor;border-radius:8px"><summary><strong>${esc(c.fairName)}</strong><br><small>${esc(label)} · ${esc(TYPES[c.category]||TYPES.other)} · ${esc(dates)}</small></summary><p>${esc(c.scopeNote||'対象店舗・利用条件は公式告知で確認してください。')}</p>${itemList}<p><small>${c.itemStatus==='parsed'?'公式本文から確認できた商品を掲載。画像内などの未取得商品がある場合があります。':'商品・価格の一覧は未取得です。0件＝商品なしではありません。'}</small></p>${c.retainedFromPrevious?'<p>前回確認情報を表示しています。</p>':''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">この告知を公式で確認</a>`:''}</details>`;
}
export function renderCampaignCatalog(chain, today = catalogToday()) {
  const rows=visibleCampaigns(chain,today), concurrent=visibleConcurrentCampaigns(chain,today), coverage=chain.campaignCoverage;
  if (!chain.campaignCoverage && !chain.campaignCatalog && !concurrent.length) return '';
  const warning=Array.isArray(chain.campaignCatalog)&&coverage?.state!=='complete' ? '<p role="status">告知一覧は一部未確認です。前回確認情報または公式リンクを表示しています。</p>' : '';
  const active=rows.filter(c=>campaignPhase(c,today)!=='upcoming'),next=rows.filter(c=>campaignPhase(c,today)==='upcoming');
  const concurrentActive=concurrent.filter(c=>displayPhase(c,today)!=='upcoming'),concurrentNext=concurrent.filter(c=>displayPhase(c,today)==='upcoming');
  const unconfirmed=coverage?.unconfirmedUrls?.length||0;
  const concurrentHtml=concurrent.length?`<div class="concurrent-campaigns"><h3>公式の同時開催・近日開始フェア</h3>${concurrentNext.length?`<h4>近日開始 · ${concurrentNext.length}件</h4>${concurrentNext.map(c=>renderCard(c,today,'data-concurrent-campaign-id')).join('')}`:''}${concurrentActive.length?`<details class="catalog-current-group"><summary>開催中・期間要確認 · ${concurrentActive.length}件を見る</summary>${concurrentActive.map(c=>renderCard(c,today,'data-concurrent-campaign-id')).join('')}</details>`:''}<small>主フェアと別系統の公式掲載を分離表示しています。近日開始商品の価格は開始前の現行価格として扱いません。</small></div>`:'';
  const catalogHtml=(Array.isArray(chain.campaignCatalog)||coverage)?`<div class="independent-campaign-catalog"><h3>公式の関連キャンペーン</h3>${warning}${next.length?`<h4>近日開始 · ${next.length}件</h4>${next.map(c=>renderCard(c,today)).join('')}`:''}${active.length?`<details class="catalog-current-group"><summary>開催期間内・期間要確認 · ${active.length}件を見る</summary>${active.map(c=>renderCard(c,today)).join('')}</details>`:''}${!rows.length?'<p>掲載できる告知は未確認です。</p>':''}${unconfirmed?`<p><small>過去の告知${unconfirmed}件は現在の実施を確認できず、開催中には掲載していません。販売終了と断定したものではありません。</small></p>`:''}<small>一覧照合は対象範囲の告知収録確認です。商品・価格の完全取得や店舗在庫を保証するものではありません。</small></div>`:'';
  return `<section class="campaign-catalog" aria-label="開催中・開始予定の公式告知">${concurrentHtml}${catalogHtml}</section>`;
}
