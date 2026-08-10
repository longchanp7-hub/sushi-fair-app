import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'diagnostics', 'sushiro-assets.json');
const UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

const targets = [
  { id: 'app-js', url: 'https://linemini.akindo-sushiro.co.jp/js/linemini/app.js' },
  { id: 'entry-html', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179' },
  { id: 'area-html', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/stores/area/?storeId=179' },
  { id: 'localticket-html', url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/localticket/stores/?storeId=179' },
];

const terms = [
  'waiting-group', 'waiting-time', 'waitTime', 'waitingTime', 'wait_time', 'queue',
  'localticket', 'storeId', 'ticket', 'reservation', 'reception',
  '$.ajax', '$.get', '$.post', 'fetch(', 'XMLHttpRequest',
  '待ち状況', '待ち時間', '順番待ち', '受付', '予約', '組待ち',
];

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function contexts(source = '', max = 120) {
  const text = String(source);
  const lower = text.toLowerCase();
  const values = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    let from = 0;
    while (values.length < max) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      values.push(clean(text.slice(Math.max(0, index - 400), Math.min(text.length, index + needle.length + 1000))));
      from = index + needle.length;
    }
    if (values.length >= max) break;
  }
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

function endpoints(source = '', baseUrl = '') {
  const text = String(source).replace(/\\\//g, '/');
  const values = [];
  const patterns = [
    /https?:\/\/[^\s"'`<>]{4,300}/gi,
    /["'`]((?:\/|\.\/|\.\.\/)[^"'`\s<>]{1,240})["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || match[0];
      if (!/(wait|queue|ticket|reserv|store|reception|受付|待ち|予約)/i.test(raw)) continue;
      try {
        const resolved = new URL(raw, baseUrl).href;
        if (/^https?:/.test(resolved)) values.push(resolved);
      } catch {}
    }
  }
  return [...new Set(values)].slice(0, 200);
}

function scripts(source = '', baseUrl = '') {
  const values = [];
  for (const match of String(source).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try { values.push(new URL(match[1], baseUrl).href); } catch {}
  }
  return [...new Set(values)].slice(0, 100);
}

async function inspect(target) {
  try {
    const response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'user-agent': UA,
        'accept-language': 'ja-JP,ja;q=0.9',
        accept: 'text/html,application/javascript,text/javascript,application/json,*/*;q=0.8',
        'cache-control': 'no-cache',
      },
    });
    const text = await response.text();
    return {
      id: target.id,
      requestedUrl: target.url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      length: Buffer.byteLength(text),
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      scriptUrls: scripts(text, response.url || target.url),
      endpointCandidates: endpoints(text, response.url || target.url),
      contexts: contexts(text),
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
