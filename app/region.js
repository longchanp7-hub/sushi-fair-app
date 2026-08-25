const DEFAULT_LOCATION_KEY = 'sushiFairLocationV2';
const DEFAULT_ADDRESS_API = 'https://geolonia.github.io/japanese-addresses/api/ja.json';

const FALLBACK = {
  '北海道':['札幌市中央区'], '青森県':['青森市'], '岩手県':['盛岡市'], '宮城県':['仙台市青葉区'],
  '秋田県':['秋田市'], '山形県':['山形市'], '福島県':['福島市'], '茨城県':['水戸市'], '栃木県':['宇都宮市'],
  '群馬県':['前橋市'], '埼玉県':['さいたま市浦和区'], '千葉県':['千葉市中央区'], '東京都':['新宿区','渋谷区','千代田区'],
  '神奈川県':['横浜市中区'], '新潟県':['新潟市中央区'], '富山県':['富山市'], '石川県':['金沢市'], '福井県':['福井市'],
  '山梨県':['甲府市'], '長野県':['長野市'], '岐阜県':['岐阜市'], '静岡県':['静岡市葵区'],
  '愛知県':['豊橋市','豊川市','名古屋市中区'], '三重県':['津市'], '滋賀県':['大津市'], '京都府':['京都市中京区'],
  '大阪府':['大阪市北区','大阪市中央区'], '兵庫県':['神戸市中央区'], '奈良県':['奈良市'], '和歌山県':['和歌山市'],
  '鳥取県':['鳥取市'], '島根県':['松江市'], '岡山県':['岡山市北区'], '広島県':['広島市中区'], '山口県':['山口市'],
  '徳島県':['徳島市'], '香川県':['高松市'], '愛媛県':['松山市'], '高知県':['高知市'], '福岡県':['福岡市博多区'],
  '佐賀県':['佐賀市'], '長崎県':['長崎市'], '熊本県':['熊本市中央区'], '大分県':['大分市'], '宮崎県':['宮崎市'],
  '鹿児島県':['鹿児島市'], '沖縄県':['那覇市'],
};

const PREF_CODES = {
  '北海道':'01','青森県':'02','岩手県':'03','宮城県':'04','秋田県':'05','山形県':'06','福島県':'07',
  '茨城県':'08','栃木県':'09','群馬県':'10','埼玉県':'11','千葉県':'12','東京都':'13','神奈川県':'14',
  '新潟県':'15','富山県':'16','石川県':'17','福井県':'18','山梨県':'19','長野県':'20','岐阜県':'21',
  '静岡県':'22','愛知県':'23','三重県':'24','滋賀県':'25','京都府':'26','大阪府':'27','兵庫県':'28',
  '奈良県':'29','和歌山県':'30','鳥取県':'31','島根県':'32','岡山県':'33','広島県':'34','山口県':'35',
  '徳島県':'36','香川県':'37','愛媛県':'38','高知県':'39','福岡県':'40','佐賀県':'41','長崎県':'42',
  '熊本県':'43','大分県':'44','宮崎県':'45','鹿児島県':'46','沖縄県':'47',
};

const FALLBACK_MENU_AREAS = {
  chains: {
    sushiro: { strategyKey:'representativeStoreId', label:'店舗別メニュー・価格' },
    hamazushi: {
      strategyKey:'regionCode', label:'地域区分＋都市型価格',
      regions: {
        hokkaido:{ label:'北海道', prefectures:['北海道'] },
        tohoku:{ label:'東北', prefectures:['青森県','岩手県','宮城県','秋田県','山形県','福島県'] },
        kanto:{ label:'関東', prefectures:['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','長野県','山梨県'] },
        hokuriku:{ label:'北陸', prefectures:['新潟県','富山県','石川県','福井県'] },
        tokai:{ label:'東海', prefectures:['静岡県','愛知県','岐阜県','三重県'] },
        kansai:{ label:'関西', prefectures:['滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'] },
        chugoku:{ label:'中国', prefectures:['鳥取県','島根県','岡山県','広島県','山口県'] },
        shikoku:{ label:'四国', prefectures:['徳島県','香川県','愛媛県','高知県'] },
        kyushu:{ label:'九州', prefectures:['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県'] },
        okinawa:{ label:'沖縄', prefectures:['沖縄県'] },
      },
    },
    kurasushi: { strategyKey:'priceTier', label:'店舗価格帯・提供エリア' },
    kappasushi: { strategyKey:'menuType', label:'店舗メニュータイプ' },
    uobei: { strategyKey:'priceClass', label:'店舗価格区分' },
  },
};

let locationSettings = {
  storageKey: DEFAULT_LOCATION_KEY,
  defaultLocation: { prefecture:'愛知県', city:'豊橋市', prefectureCode:'23' },
  municipalitySource: { url:DEFAULT_ADDRESS_API },
};
let menuAreas = FALLBACK_MENU_AREAS;

async function fetchJson(url) {
  const response = await fetch(url, { cache:'force-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function loadSettings() {
  try {
    const [locations, areas] = await Promise.all([
      fetchJson('./data/locations.json?v=20260825-1'),
      fetchJson('./data/menu-areas.json?v=20260825-1'),
    ]);
    if (locations?.defaultLocation) locationSettings = { ...locationSettings, ...locations };
    if (areas?.chains) menuAreas = areas;
  } catch {
    // Static fallback keeps the app usable while preserving fail-closed regional classification.
  }
}

function hamaRegion(prefecture) {
  const regions = menuAreas?.chains?.hamazushi?.regions || {};
  return Object.entries(regions).find(([, value]) => value?.prefectures?.includes(prefecture)) || null;
}

export function resolveChainContext(chain, location) {
  const place = `${location.prefecture} ${location.city}`;
  const config = menuAreas?.chains?.[chain] || FALLBACK_MENU_AREAS.chains[chain] || {};
  if (chain === 'hamazushi') {
    const entry = hamaRegion(location.prefecture);
    const regionCode = entry?.[0] || null;
    const label = entry?.[1]?.label || null;
    return {
      key: config.strategyKey || 'regionCode', value:regionCode,
      label: label ? `はま寿司：${label}メニュー区分` : 'はま寿司：地域区分確認中',
      note: `選択地域 ${place}。都市型店舗や個別価格例外は別属性のため、最終価格は公式店舗情報で確認します。`,
    };
  }
  if (chain === 'sushiro') return {
    key:config.strategyKey || 'representativeStoreId', value:null,
    label:'スシロー：店舗別メニュー・価格',
    note:`選択地域 ${place}。全国フェアと店舗掲載を分離し、正確な価格・品切れは公式店舗ページで確認します。`,
  };
  if (chain === 'kurasushi') return {
    key:config.strategyKey || 'priceTier', value:null,
    label:'くら寿司：店舗価格帯・提供エリア',
    note:`選択地域 ${place}。価格帯（115円〜等）と商品提供エリアは別軸のため、未確認の店舗区分は推測しません。`,
  };
  if (chain === 'kappasushi') return {
    key:config.strategyKey || 'menuType', value:null,
    label:'かっぱ寿司：店舗メニュータイプ',
    note:`選択地域 ${place}。A/B/C/D等の店舗メニュータイプは、確認できた公式店舗情報だけを今後反映します。`,
  };
  if (chain === 'uobei') return {
    key:config.strategyKey || 'priceClass', value:null,
    label:'魚べい：店舗価格区分',
    note:`選択地域 ${place}。通常・都心型・超都心型などの価格差は、確認できた公式店舗情報だけを反映します。`,
  };
  return { key:null, value:null, label:'地域情報', note:`選択地域 ${place}` };
}

function savedLocation() {
  try {
    const value = JSON.parse(localStorage.getItem(locationSettings.storageKey || DEFAULT_LOCATION_KEY) || 'null');
    if (value?.prefecture && value?.city) return value;
  } catch {}
  return { ...locationSettings.defaultLocation };
}

function saveLocation(location) {
  localStorage.setItem(locationSettings.storageKey || DEFAULT_LOCATION_KEY, JSON.stringify(location));
}

async function loadMunicipalities() {
  try {
    const data = await fetchJson(locationSettings.municipalitySource?.url || DEFAULT_ADDRESS_API);
    if (!data?.['東京都']?.includes('新宿区') || !data?.['愛知県']?.includes('豊橋市')) throw new Error('unexpected address data');
    return data;
  } catch {
    return FALLBACK;
  }
}

function setOptions(select, values, selected) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
}

export async function initRegionSelector({ onChange } = {}) {
  await loadSettings();
  const prefectureEl = document.querySelector('#prefectureSelect');
  const cityEl = document.querySelector('#citySelect');
  const statusEl = document.querySelector('#regionStatus');
  if (!prefectureEl || !cityEl) return savedLocation();

  const municipalities = await loadMunicipalities();
  const prefs = Object.keys(municipalities).filter(pref => Array.isArray(municipalities[pref]) && municipalities[pref].length);
  let current = savedLocation();
  if (!municipalities[current.prefecture]?.includes(current.city)) {
    const defaultLocation = locationSettings.defaultLocation || { prefecture:'愛知県', city:'豊橋市', prefectureCode:'23' };
    current = municipalities[defaultLocation.prefecture]?.includes(defaultLocation.city)
      ? { ...defaultLocation }
      : { prefecture:prefs[0], city:municipalities[prefs[0]][0], prefectureCode:PREF_CODES[prefs[0]] || '' };
  }

  setOptions(prefectureEl, prefs, current.prefecture);
  setOptions(cityEl, municipalities[current.prefecture], current.city);

  const emit = () => {
    current = {
      prefecture: prefectureEl.value,
      city: cityEl.value,
      prefectureCode: PREF_CODES[prefectureEl.value] || '',
    };
    saveLocation(current);
    if (statusEl) statusEl.textContent = `${current.prefecture} ${current.city}`;
    onChange?.(current);
  };

  prefectureEl.addEventListener('change', () => {
    const cities = municipalities[prefectureEl.value] || [];
    setOptions(cityEl, cities, cities[0]);
    emit();
  });
  cityEl.addEventListener('change', emit);
  if (statusEl) statusEl.textContent = `${current.prefecture} ${current.city}`;
  return current;
}
