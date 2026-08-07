import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'app', 'data', 'fairs.json');

const data = JSON.parse(await fs.readFile(OUT, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

for (const chain of data.chains || []) {
  if (chain.chain === 'hamazushi') {
    chain.items = (chain.items || []).filter(item => {
      const name = String(item.name || '').trim();
      return name && !/^※?画像は/.test(name) && !/^※.*4人前/.test(name);
    });
    if (!chain.items.length) {
      chain.status = 'warning';
      chain.message = '期間限定商品の商品一覧を取得できませんでした。';
    }
  }

  if (chain.chain === 'kappasushi') {
    const items = chain.items || [];
    const titleOnly = items.length === 1 && String(items[0]?.name || '').trim() === String(chain.fairName || '').trim();
    if (titleOnly) {
      chain.status = 'warning';
      chain.message = '開催中フェア名は取得できていますが、個別商品の自動取得はできていません。公式ページで確認してください。';
    }
  }

  if (chain.endDate && chain.endDate < today && chain.status === 'ok') {
    chain.status = 'warning';
    chain.message = '終了日を過ぎた情報です。最新キャンペーンの取得を確認中です。';
  }
}

await fs.writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log('Cleaned fair data quality flags.');
