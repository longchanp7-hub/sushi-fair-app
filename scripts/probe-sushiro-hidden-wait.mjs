import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'diagnostics', 'sushiro-hidden-wait.json');
const PAGE_URL = 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179';

const response = await fetch(PAGE_URL, {
  redirect: 'follow',
  signal: AbortSignal.timeout(25000),
  headers: {
    'user-agent': 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36',
    'accept-language': 'ja-JP,ja;q=0.9',
    accept: 'text/html,*/*;q=0.8',
    'cache-control': 'no-cache',
  },
});
const html = await response.text();

function valueOf(id) {
  const idFirst = new RegExp(`<input[^>]+id=["']${id}["'][^>]+value=["']([^"']*)["'][^>]*>`, 'i');
  const valueFirst = new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+id=["']${id}["'][^>]*>`, 'i');
  return html.match(idFirst)?.[1] ?? html.match(valueFirst)?.[1] ?? null;
}

const values = {
  storeId: valueOf('storeId'),
  storeStatus: valueOf('storeStatus'),
  netTicketStatus: valueOf('netTicketStatus'),
  reservable: valueOf('reservable'),
  waitTimeTable: valueOf('waitTimeTable'),
  waitTimeCounter: valueOf('waitTimeCounter'),
  waitTimeCap: valueOf('waitTimeCap'),
  waitShowType: valueOf('waitShowType'),
  waitGroup: valueOf('waitGroup'),
  waitGroupTable: valueOf('waitGroupTable'),
  waitGroupCounter: valueOf('waitGroupCounter'),
  waitGroupPair: valueOf('waitGroupPair'),
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  requestedUrl: PAGE_URL,
  status: response.status,
  values,
}, null, 2)}\n`);
console.log(values);
