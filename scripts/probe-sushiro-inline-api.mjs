import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'diagnostics', 'sushiro-inline-api.json');
const UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

const targets = [
  { id: 'entry', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179' },
  { id: 'area', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/stores/area/?storeId=179' },
  { id: 'localticket', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/localticket/stores/?storeId=179' },
  { id: 'top', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/top/' },
];

function compact(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function inlineScripts(html = '') {
  const scripts = [];
  for (const match of String(html).matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = String(match[1] || '');
    if (text.trim()) scripts.push(text);
  }
  return scripts;
}

function contexts(text = '', needlePattern, max = 80) {
  const values = [];
  for (const match of String(text).matchAll(needlePattern)) {
    const index = match.index || 0;
    values.push(compact(text.slice(Math.max(0, index - 900), Math.min(text.length, index + match[0].length + 1800))));
    if (values.length >= max) break;
  }
  return [...new Set(values.filter(Boolean))];
}

function endpointList(text = '', baseUrl = '') {
  const values = [];
  const decoded = String(text).replace(/\\\//g, '/');
  for (const match of decoded.matchAll(/["'`]((?:\/LINE-mini\/api\/|https:\/\/linemini\.akindo-sushiro\.co\.jp\/LINE-mini\/api\/)[^"'`\s<>]{1,260})["'`]/g)) {
    try { values.push(new URL(match[1], baseUrl).href); } catch {}
  }
  return [...new Set(values)];
}

async function inspect(target) {
  try {
    const response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: {
        'user-agent': UA,
        'accept-language': 'ja-JP,ja;q=0.9',
        accept: 'text/html,*/*;q=0.8',
        'cache-control': 'no-cache',
      },
    });
    const html = await response.text();
    const scripts = inlineScripts(html);
    const combined = scripts.join('\n\n');
    return {
      id: target.id,
      requestedUrl: target.url,
      finalUrl: response.url,
      status: response.status,
      inlineScriptCount: scripts.length,
      endpoints: endpointList(combined, response.url || target.url),
      apiContexts: contexts(combined, /\/LINE-mini\/api\/[A-Za-z0-9_?&=./${}:,+-]+/g),
      waitContexts: contexts(combined, /(waiting-group|waiting-time|table-time|getStoreWaitingTimeConfig|storewaitingtimeconfig|waitTime|waitingTime|wait_time|待ち時間|待ち状況)/gi),
    };
  } catch (error) {
    return { id: target.id, requestedUrl: target.url, error: error?.message || String(error) };
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
