import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'diagnostics', 'sushiro-wait-endpoint.json');
const BASE = 'https://linemini.akindo-sushiro.co.jp';
const UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

const targets = [
  {
    id: 'waiting-config-179',
    path: '/LINE-mini/api/info/storewaitingtimeconfig?region=JP&stores=179',
  },
  {
    id: 'waiting-config-142',
    path: '/LINE-mini/api/info/storewaitingtimeconfig?region=JP&stores=142',
  },
  {
    id: 'waiting-config-both',
    path: '/LINE-mini/api/info/storewaitingtimeconfig?region=JP&stores=179,142',
  },
  {
    id: 'stores-179',
    path: '/LINE-mini/api/stores?storeId=179',
  },
  {
    id: 'stores-list-179',
    path: '/LINE-mini/api/stores?stores=179',
  },
];

function parseMaybeJson(text, contentType) {
  if (!/json/i.test(contentType) && !/^\s*[\[{]/.test(text)) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function summarize(value, depth = 0) {
  if (depth > 4) return '[max-depth]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => summarize(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [key, summarize(item, depth + 1)]));
}

async function inspect(target) {
  const url = new URL(target.path, BASE);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'user-agent': UA,
        'accept-language': 'ja-JP,ja;q=0.9',
        accept: 'application/json,text/plain,*/*',
        referer: `${BASE}/LINE-mini/ui/store/reservation/entry/?storeId=179`,
        'cache-control': 'no-cache',
      },
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const parsed = parseMaybeJson(text, contentType);
    return {
      id: target.id,
      requestedUrl: url.href,
      finalUrl: response.url,
      status: response.status,
      contentType,
      allowOrigin: response.headers.get('access-control-allow-origin'),
      bodyLength: Buffer.byteLength(text),
      json: parsed === null ? null : summarize(parsed),
      textSample: parsed === null ? text.slice(0, 5000) : null,
    };
  } catch (error) {
    return { id: target.id, requestedUrl: url.href, error: error?.message || String(error) };
  }
}

const results = [];
for (const target of targets) {
  console.log(`Inspecting ${target.id}`);
  results.push(await inspect(target));
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
