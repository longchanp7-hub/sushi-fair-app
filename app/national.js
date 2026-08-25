import { initRegionSelector, resolveChainContext } from './region.js?v=20260825-rough';

const ICON={
  sushiro:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 18h40L40 28H20zM15 31h34L38 41H22zM20 44h24L34 54H30z" fill="currentColor"/></svg>',
  hamazushi:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 37c10-20 19-21 28-7 8-9 15-7 20 3-11-5-17 2-22 8-8 9-18 8-26-4z" fill="currentColor"/><path d="M14 24c9-12 17-12 25-2-8-3-14 1-18 7z" fill="currentColor" opacity=".55"/></svg>',
  kurasushi:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 57 32 32 57 7 32 32 7zm0 10L17 32l15 15 15-15-15-15zm0 7 8 8-8 8-8-8 8-8z" fill="currentColor"/></svg>',
  kappasushi:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 16h44L44 25H20z" fill="#e83b32"/><path d="M14 28h36L42 37H22z" fill="#f08a28"/><path d="M18 40h28L39 49H25z" fill="#f6c33a"/></svg>',
  uobei:'<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5"><circle cx="32" cy="32" r="8"/><path d="M32 7c8 0 10 8 7 15 7-5 15-1 17 6 2 8-5 12-13 11 6 5 4 14-3 18-7 4-14-2-15-10-3 8-12 10-18 5-6-5-3-14 5-17-8-1-13-8-10-15 3-7 12-8 18-3-4-7 0-15 12-10z"/></g></svg>'
};

const META={
  sushiro:{name:'スシロー',icon:ICON.sushiro,color:'#e3262e',soft:'#48171a'},
  hamazushi:{name:'はま寿司',icon:ICON.hamazushi,color:'#1687d9',soft:'#102d43'},
  kurasushi:{name:'くら寿司',icon:ICON.kurasushi,color:'#9f2430',soft:'#35171d'},
  kappasushi:{name:'かっぱ寿司',icon:ICON.kappasushi,color:'#49a942',soft:'#17341b'},
  uobei:{name:'魚べい',icon:ICON.uobei,color:'#f2a900',soft:'#493510'}
};

let data=null;
let location={prefecture:'愛知県',city:'豊橋市',prefectureCode:'23'};
let active='all';

const cards=document.querySelector('#cards');
const updated=document.querySelector('#updatedAt');
const refresh=document.querySelector('#refreshBtn');

const esc=(v='')=>String(v).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const dateKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fmt=iso=>iso?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric'}).format(new Date(`${iso}T00:00:00+09:00`)):null;

function period(f){
  if(f.startDate&&f.endDate)return `${fmt(f.startDate)} 〜 ${fmt(f.endDate)}`;
  if(f.startDate)return `${fmt(f.startDate)} 〜 なくなり次第終了等`;
  return '販売期間は公式情報で確認';
}

function remaining(end){
  if(!end)return '期間限定';
  const n=Math.round((new Date(`${end}T00:00:00+09:00`)-new Date(`${dateKey()}T00:00:00+09:00`))/86400000);
  if(n<0)return '終了確認中';
  if(n===0)return '本日まで';
  if(n<=3)return `あと${n}日`;
  return '開催中';
}

function ctx(f){return resolveChainContext(f.chain,location);}

function sourceItems(f){
  const c=ctx(f);
  if(f.chain==='sushiro'&&Array.isArray(c.store?.localFairItems)&&c.store.localFairItems.length)return c.store.localFairItems;
  return f.items||[];
}

function valid(f){
  const c=ctx(f),today=dateKey();
  return sourceItems(f).filter(i=>i.saleStatus!=='ended'&&(!i.endDate||i.endDate>=today)&&(!(i.availability?.regionCodes?.length)||!c.value||i.availability.regionCodes.includes(c.value)));
}

function isLocalSushiroItem(f,i){
  const c=ctx(f);
  return f.chain==='sushiro'&&Array.isArray(c.store?.localFairItems)&&c.store.localFairItems.some(x=>x.name===i.name&&x.price===i.price);
}

function priceText(f,i){
  if(i.price==null)return '価格確認';
  const n=`${Number(i.price).toLocaleString('ja-JP')}円`,c=ctx(f);
  if(isLocalSushiroItem(f,i))return c.store?.match==='same_prefecture'?`県内参考 ${n}`:n;
  if(f.chain==='hamazushi'&&c.verified)return `地域目安 ${n}`;
  if(f.dataScope==='national_official_release')return `公式掲載 ${n}`;
  return c.storeVerified?`店舗参考 ${n}`:`参考 ${n}`;
}

function context(f){
  const c=ctx(f),mode=c.approximate?'unverified':c.verified?'verified':'unverified';
  return `<div class="region-context ${mode}"><div class="region-context-title"><strong>📍 ${esc(location.prefecture)} ${esc(location.city)}向け</strong><span>${c.storeVerified?'地域反映済み':'地域目安'}</span></div><span>${esc(c.label)}</span><small>${esc(c.note)}</small></div>`;
}

function scope(f){
  const c=ctx(f);
  if(f.chain==='sushiro'&&c.store?.localFairItems?.length){
    return c.store.match==='same_prefecture'
      ?`${c.store.storeName}の公式店舗別メニューを県内代表として使用。価格は地域の目安です。`
      :`${c.store.storeName}の公式店舗別メニューからフェア商品・価格を取得しています。`;
  }
  if(f.dataScope==='national_official_release')return '全国向け公式発表が基準です。地域・店舗により価格や取扱いが異なる場合があります。';
  if(f.dataScope==='reference_store_menu_overlay')return '全国フェアと店舗掲載を分離。地域代表メニューを目安として表示します。';
  return '公式メニューを基準に、地域差は代表値で簡易表示します。';
}

function visualImage(f){
  const c=ctx(f);
  if(f.chain==='sushiro'&&c.store?.representativeImageUrl)return c.store.representativeImageUrl;
  return f.representativeImageUrl||f.imageUrl||null;
}

function visual(f,m,itemCount){
  const img=visualImage(f),heroProduct=f.representativeImageProduct||valid(f)[0]?.name||null;
  return `<div class="fair-visual">${img?`<img src="${esc(img)}" alt="${esc(m.name)} ${esc(heroProduct||f.fairName||'フェア')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:''}<div class="visual-shade"></div><div class="chain-mark">${m.icon}</div><div class="visual-copy"><strong>${esc(m.name)}</strong><span>${esc(f.fairName||'期間限定メニュー')}</span><small>${esc(period(f))}</small>${heroProduct?`<em>代表メニュー：${esc(heroProduct)}</em>`:''}</div><div class="visual-badges"><b>${esc(remaining(f.endDate))}</b><span>${itemCount}品</span></div></div>`;
}

function actionLinks(f,c){
  let primaryUrl=f.sourceUrl||'#',primaryLabel='公式フェア・メニュー';
  if(f.chain==='sushiro'&&c.store?.menuUrl){
    primaryUrl=c.store.menuUrl;
    primaryLabel='地域メニューを公式で確認';
  }else if(f.chain==='hamazushi'){
    primaryLabel='地域メニューを公式で確認';
  }else if(f.chain==='kurasushi'||f.chain==='kappasushi'||f.chain==='uobei'){
    primaryLabel='公式フェアを見る';
  }
  const secondaryUrl=c.officialUrl||f.officialActionUrl||f.storeUrl||'#';
  return {primaryUrl,primaryLabel,secondaryUrl,secondaryLabel:'店舗・予約を公式で確認'};
}

function render(){
  if(!data)return;
  const all=data.chains||[],shown=all.filter(f=>active==='all'||f.chain===active);
  cards.innerHTML=shown.map(f=>{
    const m=META[f.chain]||{name:f.chain,icon:ICON.kurasushi,color:'#888',soft:'#222'};
    const c=ctx(f),items=valid(f),visible=items.slice(0,10),links=actionLinks(f,c);
    const lis=visible.length
      ?`<ul class="items">${visible.map(i=>`<li class="item"><span class="item-name">${esc(i.name)}${i.startDate||i.endDate?`<small class="item-period">${i.startDate?fmt(i.startDate):''}${i.startDate&&i.endDate?'〜':''}${i.endDate?fmt(i.endDate):''}</small>`:''}</span><span class="price">${esc(priceText(f,i))}</span></li>`).join('')}</ul>${items.length>10?`<div class="more">ほか ${items.length-10} 品</div>`:''}`
      :`<div class="empty">個別商品の取得は確認中です。取得失敗を販売終了とは扱いません。</div>`;
    return `<article id="card-${f.chain}" class="card chain-${f.chain}" style="--chain-color:${m.color};--chain-soft:${m.soft}">${visual(f,m,items.length)}${context(f)}<p class="price-note scope-note">${esc(scope(f))}</p>${f.status!=='ok'?`<div class="error-banner">${esc(f.message||'公式情報の一部を取得できませんでした。')}</div>`:''}${lis}${f.priceNote?`<p class="price-note">※ ${esc(f.priceNote)}</p>`:''}<div class="actions"><a class="primary" href="${esc(links.primaryUrl)}" target="_blank" rel="noopener">${esc(links.primaryLabel)}</a><a class="secondary" href="${esc(links.secondaryUrl)}" target="_blank" rel="noopener">${esc(links.secondaryLabel)}</a></div></article>`;
  }).join('');
}

async function load(){
  refresh.disabled=true;
  refresh.textContent='↻ 読込中';
  try{
    const r=await fetch(`./data/fairs.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    data=await r.json();
    updated.textContent=`最終更新 ${new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tokyo'}).format(new Date(data.updatedAt))}`;
    render();
  }catch(e){
    cards.innerHTML=`<div class="error-banner">${esc(e.message)}</div>`;
  }finally{
    refresh.disabled=false;
    refresh.textContent='↻ 更新';
  }
}

document.querySelector('#filters')?.addEventListener('click',e=>{
  const b=e.target.closest('.filter');
  if(!b)return;
  active=b.dataset.chain;
  document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));
  render();
});

refresh?.addEventListener('click',load);
location=await initRegionSelector({onApply:async next=>{location=next;render();}});
await load();
