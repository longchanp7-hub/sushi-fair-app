import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');

const overrides = {
  sushiro: {
    storeName: '豊橋エリア（磯辺店基準）',
    storeUrl: 'https://www.akindo-sushiro.co.jp/shop/'
  },
  hamazushi: {
    storeName: '豊橋新栄周辺',
    storeUrl: 'https://maps.hama-sushi.co.jp/jp/index.html'
  }
};

function cleanRepeatedText(value = '') {
  let text = String(value).replace(/\s+/g, ' ').trim();
  const repeated = text.match(/^(.{4,}?)\s+\1$/);
  if (repeated) text = repeated[1].trim();
  text = text
    .replace(/^20\d{2}[./]\d{1,2}[./]\d{1,2}(?:\([^)]*\))?\s*[～〜~\-–—]\s*(?:20\d{2}[./])?\d{1,2}[./]\d{1,2}(?:\([^)]*\))?(?:まで予定|迄|まで)?\s*/, '')
    .replace(/^20\d{2}[./]\d{1,2}[./]\d{1,2}(?:\([^)]*\))?\s*[～〜~\-–—]\s*/, '')
    .trim();
  return text;
}

function jstDay() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    day: 'numeric'
  }).format(new Date()));
}

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
data.chains = (data.chains || []).map(chain => {
  let next = {
    ...chain,
    ...(overrides[chain.chain] || {})
  };

  if (next.chain === 'kappasushi') {
    const today = jstDay();
    const seen = new Set();
    const items = (next.items || [])
      .map(item => ({ ...item, name: cleanRepeatedText(item.name) }))
      .filter(item => item.name && !/Kappa Sushi|かっぱ寿司\s*[|｜]/i.test(item.name))
      .filter(item => /とろの日|祭り|フェア/.test(item.name))
      .filter(item => {
        const oneDay = item.name.match(/(\d{1,2})日はとろの日/);
        return !oneDay || Number(oneDay[1]) === today;
      })
      .filter(item => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      });

    next = {
      ...next,
      fairName: items[0]?.name || '期間限定キャンペーン',
      items,
      sourceUrl: 'https://www.kappasushi.jp/campaign_list/',
      imageUrl: /logo_kappasushi|\/logo/i.test(next.imageUrl || '') ? null : next.imageUrl
    };
  }

  if (next.chain === 'kurasushi' && /gnav_home|\/gnav_/i.test(next.imageUrl || '')) {
    next.imageUrl = null;
  }

  return next;
});

await fs.writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log('Applied Toyohashi labels and display cleanup.');
