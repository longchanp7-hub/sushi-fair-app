const STORAGE_KEY='sushiFairLocationV3';
const ADDRESS_API='https://geolonia.github.io/japanese-addresses/api/ja.json';
const STORE_DATA_URL='./data/store-contexts.json';
const PREF_CODES={'北海道':'01','青森県':'02','岩手県':'03','宮城県':'04','秋田県':'05','山形県':'06','福島県':'07','茨城県':'08','栃木県':'09','群馬県':'10','埼玉県':'11','千葉県':'12','東京都':'13','神奈川県':'14','新潟県':'15','富山県':'16','石川県':'17','福井県':'18','山梨県':'19','長野県':'20','岐阜県':'21','静岡県':'22','愛知県':'23','三重県':'24','滋賀県':'25','京都府':'26','大阪府':'27','兵庫県':'28','奈良県':'29','和歌山県':'30','鳥取県':'31','島根県':'32','岡山県':'33','広島県':'34','山口県':'35','徳島県':'36','香川県':'37','愛媛県':'38','高知県':'39','福岡県':'40','佐賀県':'41','長崎県':'42','熊本県':'43','大分県':'44','宮崎県':'45','鹿児島県':'46','沖縄県':'47'};
const FALLBACK={'北海道':['札幌市'],'東京都':['東京23区','八王子市','町田市'],'愛知県':['豊橋市','豊川市','蒲郡市','名古屋市'],'大阪府':['大阪市','堺市'],'福岡県':['福岡市','北九州市'],'沖縄県':['那覇市']};
const HAMA={hokkaido:['北海道'],tohoku:['青森県','岩手県','宮城県','秋田県','山形県','福島県'],kanto:['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','長野県','山梨県'],hokuriku:['新潟県','富山県','石川県','福井県'],tokai:['静岡県','愛知県','岐阜県','三重県'],kansai:['滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'],chugoku:['鳥取県','島根県','岡山県','広島県','山口県'],shikoku:['徳島県','香川県','愛媛県','高知県'],kyushu:['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県'],okinawa:['沖縄県']};
const HAMA_LABEL={hokkaido:'北海道',tohoku:'東北',kanto:'関東',hokuriku:'北陸',tokai:'東海',kansai:'関西',chugoku:'中国',shikoku:'四国',kyushu:'九州',okinawa:'沖縄'};
const UOBEI_URBAN_PREFS=new Set(['東京都','大阪府','神奈川県','愛知県','福岡県','兵庫県','京都府']);
const LOCAL_CHAINS=new Set(['totomaru','musashimaru','tokubei']);
const LOCAL_STORE_URLS={totomaru:'https://www.comline.co.jp/shoplist/',musashimaru:'https://www.634-jp.com/musashimaru-shop.html',tokubei:'https://www.nigirinotokubei.com/shop/'};
let storeData={catalog:{}};

const makeLocation=(prefecture,city)=>({prefecture,city,prefectureCode:PREF_CODES[prefecture]||''});
const cityParent=city=>city.match(/^(.+?市).+?区$/)?.[1]||null;
const isTokyoWard=city=>/^[^市町村]+区$/.test(String(city||''));
export function coarseMunicipality(prefecture,city){const parent=cityParent(city);if(parent)return parent;if(prefecture==='東京都'&&isTokyoWard(city))return '東京23区';return city;}
function saved(){try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(v?.prefecture&&v?.city)return makeLocation(v.prefecture,coarseMunicipality(v.prefecture,v.city));}catch{}return makeLocation('愛知県','豊橋市');}
const save=v=>localStorage.setItem(STORAGE_KEY,JSON.stringify(v));
function coarsenMunicipalities(raw){return Object.fromEntries(Object.entries(raw||{}).map(([pref,values])=>[pref,[...new Set((Array.isArray(values)?values:[]).map(city=>coarseMunicipality(pref,city)).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ja'))]));}
async function municipalities(){try{const r=await fetch(ADDRESS_API,{cache:'force-cache'});if(!r.ok)throw new Error();const d=await r.json();if(!d?.['東京都']?.includes('新宿区')||!d?.['愛知県']?.includes('豊橋市'))throw new Error();return coarsenMunicipalities(d);}catch{return FALLBACK;}}
async function loadStoreData(){try{const r=await fetch(`${STORE_DATA_URL}?v=${Date.now()}`,{cache:'no-store'});if(r.ok)storeData=await r.json();}catch{storeData={catalog:{}};}}
function options(el,values,selected){el.replaceChildren(...values.map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=v===selected;return o;}));}
const rowsFor=(catalog,chain,prefecture)=>Object.values(catalog?.[chain]||{}).filter(x=>x?.prefecture===prefecture);

export function findStoreInCatalog(catalog,chain,location,{allowPrefFallback=true}={}){
  const rows=rowsFor(catalog,chain,location.prefecture).filter(x=>x.municipality&&x.municipality!=='*').sort((a,b)=>String(a.municipality).localeCompare(String(b.municipality),'ja'));
  const exact=rows.find(x=>x.municipality===location.city);if(exact)return {...exact,match:'same_municipality'};
  if(location.prefecture==='東京都'&&location.city==='東京23区'){const ward=rows.find(x=>isTokyoWard(x.municipality));if(ward)return {...ward,match:'same_parent_city'};}
  if(/市$/.test(location.city)){const sameCity=rows.find(x=>x.municipality?.startsWith(location.city));if(sameCity)return {...sameCity,match:'same_parent_city'};}
  const parent=cityParent(location.city);if(parent){const sameCity=rows.find(x=>x.municipality===parent||x.municipality?.startsWith(parent));if(sameCity)return {...sameCity,match:'same_parent_city'};}
  if(!allowPrefFallback)return null;
  const samePref=rows[0];return samePref?{...samePref,match:'same_prefecture'}:null;
}
function hamaRegion(pref){return Object.entries(HAMA).find(([,prefs])=>prefs.includes(pref))?.[0]||null;}
function hamaRegionRow(catalog,location){return rowsFor(catalog,'hamazushi',location.prefecture).find(x=>x.municipality==='*')||null;}
function matchLabel(match){return match==='same_municipality'?'同一市町村':match==='same_parent_city'?'同一市内':'同一都道府県の代表';}
function uobeiApprox(location){const urban=UOBEI_URBAN_PREFS.has(location.prefecture)&&/(市|区)$/.test(location.city);return {key:'priceClass',value:urban?'urban-approx':'standard-approx',verified:false,storeVerified:false,approximate:true,store:null,officialUrl:'https://www.uobei.info/store/',label:urban?'価格区分：都市部価格差の可能性あり（概算）':'価格区分：通常系として概算表示',note:urban?'魚べいは通常・都心型・超都心型などで価格差があります。この地域は都市部のため価格差がある前提で全国フェアを表示します。':'全国フェアを通常系の目安として表示します。店舗により価格差があるため最終価格は公式店舗ページで確認してください。'};}
function localContext(catalog,chain,location){const store=findStoreInCatalog(catalog,chain,location,{allowPrefFallback:false});if(store)return {key:'exactLocalStore',value:store.storeId||store.storeName,verified:true,storeVerified:true,availableInSelectedArea:true,approximate:false,store,officialUrl:store.officialUrl||LOCAL_STORE_URLS[chain],label:`参照店舗：${store.storeName}`,note:`${matchLabel(store.match)}の公式店舗を参照しています。遠方店舗への自動切替は行いません。`};return {key:'exactLocalStore',value:null,verified:false,storeVerified:false,availableInSelectedArea:false,approximate:false,store:null,officialUrl:LOCAL_STORE_URLS[chain],label:'選択地域に店舗が見つかりません',note:`${location.prefecture} ${location.city}では公式店舗を確認できませんでした。遠方店舗を代表店にはせず、近隣店舗は公式サイトで確認してください。`};}

export function resolveChainContextFromCatalog(chain,location,catalog={}){
  const place=`${location.prefecture} ${location.city}`;
  if(LOCAL_CHAINS.has(chain))return localContext(catalog,chain,location);
  const store=findStoreInCatalog(catalog,chain,location);
  if(chain==='hamazushi'){
    const regionMeta=hamaRegionRow(catalog,location);const region=store?.regionCode||regionMeta?.regionCode||hamaRegion(location.prefecture);const regionLabel=store?.regionLabel||regionMeta?.regionLabel||HAMA_LABEL[region]||'確認中';
    return {key:'regionCode',value:region,regionCode:region,regionLabel,verified:Boolean(region),storeVerified:Boolean(store),store,officialUrl:store?.officialUrl||regionMeta?.officialUrl||'https://maps.hama-sushi.co.jp/jp/index.html',label:`公式メニュー地域：${regionLabel}`,note:store?.storeName?`${store.storeName}を${matchLabel(store.match)}として使用。${regionLabel}メニュー区分を表示します。`:`${place}は公式の${regionLabel}メニュー区分として表示します。代表店舗が未登録でも地域定義を店舗とは扱いません。`};
  }
  if(chain==='sushiro')return store?{key:'representativeStoreId',value:store.storeId||store.menuAreaCode,representativeStoreId:store.storeId,storeId:store.storeId,menuAreaCode:store.menuAreaCode||null,menuUrl:store.menuUrl||null,priceTier:store.priceTier??null,verified:Boolean(store.storeId||store.menuAreaCode),storeVerified:true,approximate:store.match==='same_prefecture',store,officialUrl:store.officialUrl,label:`代表店舗：${store.storeName}${store.priceTier?`（1皿${store.priceTier}円〜）`:''}`,note:`${matchLabel(store.match)}を地域代表として使用${store.menuAreaCode?`。店舗別メニューID ${store.menuAreaCode}`:''}${store.match==='same_prefecture'?'。価格・取扱いは県内参考値です。全国フェア商品自体は置き換えません。':'。全国フェア商品に店舗価格・取扱いだけを重ねます。'}`}:{key:'representativeStoreId',value:null,representativeStoreId:null,storeId:null,menuAreaCode:null,menuUrl:null,priceTier:null,verified:false,storeVerified:false,store:null,officialUrl:'https://www.akindo-sushiro.co.jp/shop/',label:'地域代表店舗なし',note:'全国フェアのみ表示します。'};
  if(chain==='kurasushi')return store?{key:'priceTier',value:store.priceTier,priceTier:store.priceTier??null,representativeStoreId:store.storeId||null,verified:Boolean(store.priceTier),storeVerified:true,approximate:store.match==='same_prefecture',store,officialUrl:store.officialUrl,label:`代表店舗：${store.storeName}${store.priceTier?`（1皿${store.priceTier}円〜）`:''}`,note:`${matchLabel(store.match)}の価格帯を地域の目安として使用します。商品提供エリアは全国フェア情報を優先します。`}:{key:'priceTier',value:null,priceTier:null,representativeStoreId:null,verified:false,storeVerified:false,store:null,officialUrl:'https://shop.kurasushi.co.jp/',label:'価格帯：全国フェア基準',note:'代表店舗がないため全国フェアを表示します。'};
  if(chain==='kappasushi')return store?{key:'menuType',value:store.menuType,menuType:store.menuType||null,representativeStoreId:store.storeId||null,verified:Boolean(store.menuType),storeVerified:true,approximate:store.match==='same_prefecture',store,officialUrl:store.officialUrl,label:`代表店舗：${store.storeName}（タイプ${store.menuType||'?'}）`,note:`${matchLabel(store.match)}の公式メニュータイプを地域代表として使用します。`}:{key:'menuType',value:null,menuType:null,representativeStoreId:null,verified:false,storeVerified:false,store:null,officialUrl:'https://www.kappasushi.jp/shop2',label:'メニュータイプ：全国フェア基準',note:'この地域の代表店舗が確認できないため全国フェアを表示します。別地域の店舗情報は流用しません。'};
  if(chain==='uobei')return store?{key:'priceClass',value:store.priceClass||null,priceClass:store.priceClass||null,representativeStoreId:store.storeId||null,verified:Boolean(store.priceClass),storeVerified:true,approximate:!store.priceClass||store.match==='same_prefecture',store,officialUrl:store.officialUrl,label:`代表店舗：${store.storeName}${store.priceClass?`（${store.priceClass}）`:''}`,note:`${matchLabel(store.match)}を地域代表として使用します。価格区分未確認時は全国フェア価格を目安表示します。`}:{...uobeiApprox(location),priceClass:uobeiApprox(location).value,representativeStoreId:null};
  return {key:null,value:null,verified:false,label:'地域情報確認中',note:place};
}
export function resolveChainContext(chain,location){return resolveChainContextFromCatalog(chain,location,storeData.catalog||{});}

export async function initRegionSelector({onApply}={}){
  await loadStoreData();
  const pref=document.querySelector('#prefectureSelect'),city=document.querySelector('#citySelect'),button=document.querySelector('#applyRegionBtn'),status=document.querySelector('#regionStatus'),feedback=document.querySelector('#regionFeedback');
  const data=await municipalities(),prefs=Object.keys(data).filter(k=>Array.isArray(data[k])&&data[k].length);let applied=saved();
  if(!data[applied.prefecture])applied=makeLocation('愛知県','豊橋市');
  else if(!data[applied.prefecture].includes(applied.city))applied=makeLocation(applied.prefecture,data[applied.prefecture][0]);
  save(applied);
  options(pref,prefs,applied.prefecture);options(city,data[applied.prefecture],applied.city);status.textContent=`${applied.prefecture} ${applied.city}`;
  pref.addEventListener('change',()=>options(city,data[pref.value]||[],(data[pref.value]||[])[0]));
  button.addEventListener('click',async()=>{const pending=makeLocation(pref.value,city.value);button.disabled=true;button.textContent='地域情報を更新中…';feedback.className='region-feedback working';feedback.textContent='地域メニューへ切り替えています…';try{await Promise.resolve(onApply?.(pending));applied=pending;save(applied);status.textContent=`${applied.prefecture} ${applied.city}`;feedback.className='region-feedback success';feedback.textContent=`✓ ${applied.prefecture} ${applied.city}に変更しました`;setTimeout(()=>{if(feedback.classList.contains('success'))feedback.textContent='';},3000);}catch{feedback.className='region-feedback error';feedback.textContent=`地域情報を更新できませんでした。現在は${applied.prefecture} ${applied.city}の情報を表示しています。`;}finally{button.disabled=false;button.textContent='この地域を反映';}});
  return applied;
}
