import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'diagnostics', 'crowd-sources.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

const targets = [
  {
    id: 'sushiro-entry',
    url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179',
  },
  {
    id: 'sushiro-stores',
    url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/localticket/stores/',
  },
  {
    id: 'hamazushi',
    url: 'https://my.hamazushi.com/shop/index/?search=1&shopId=148',
  },
  {
    id: 'kurasushi-store',
    url: 'https://shop.kurasushi.co.jp/detail/609',
  },
  {
    id: 'kurasushi-reservation',
    url: 'https://reservation.kurasushi.co.jp/shops?shopId=187292',
  },
  {
    id: 'kappasushi',
    url: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
  },
];

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function clean(value = '') {
  return decodeEntities(String(value)).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlToText(html = '') {
  return clean(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractAttrUrls(html, tag, attr, baseUrl) {
  const pattern = new RegExp(`<${tag}\\b[^>]*?\\s${attr}=["']([^"']+)["']`, 'gi');
  const values = [];
  for (const match of String(html).matchAll(pattern)) {
    try { values.push(new URL(match[1], baseUrl).href); } catch {}
  }
  return unique(values);
}

function extractInlineScripts(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const value = clean(match[1]);
    if (value) values.push(value.slice(0, 50_000));
  }
  return values;
}

const KEYWORDS = [
  'waitTime', 'waitingTime', 'wait_time', 'waiting', 'queue', 'numberOfGroups',
  'reservation', 'storeId', 'shopId', 'shopID', 'ticket', 'reception',
  '待ち時間', '組待ち', '受付', '予約可能', '順番待ち',
];

function keywordContexts(text, max = 24) {
  const source = String(text);
  const lower = source.toLowerCase();
  const contexts = [];
  for (const keyword of KEYWORDS) {
    const needle = keyword.toLowerCase();
    let from = 0;
    while (contexts.length < max) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      contexts.push(clean(source.slice(Math.max(0, index - 180), Math.min(source.length, index + needle.length + 260))));
      from = index + needle.length;
    }
    if (contexts.length >= max) break;
  }
  return unique(contexts).slice(0, max);
}

function endpointCandidates(text, baseUrl) {
  const source = String(text);
  const candidates = [];
  const patterns = [
    /https?:\\?\/\\?\/[^\s"'`<>]{4,240}/gi,
    /["'`]((?:\.\.\/|\.\/|\/)[^"'`\s<>]{1,220})["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const raw = String(match[1] || match[0]).replace(/\\\//g, '/');
      if (!/(api|wait|queue|reserv|store|shop|ticket|reception|受付|待ち)/i.test(raw)) continue;
      try {
        const resolved = new URL(raw, baseUrl).href;
        if (/^https?:/.test(resolved)) candidates.push(resolved);
      } catch {}
    }
  }
  return unique(candidates).slice(0, 80);
}

async function fetchText(url, { timeoutMs = 20_000, maxBytes = 3_000_000 } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.6',
      accept: 'text/html,application/xhtml+xml,application/javascript,text/javascript,application/json,*/*;q=0.7',
      'cache-control': 'no-cache',
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const limited = buffer.subarray(0, maxBytes);
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type'),
    contentLength: buffer.length,
    truncated: buffer.length > limited.length,
    text: limited.toString('utf8'),
  };
}

async function inspectAsset(url, pageUrl) {
  try {
    const response = await fetchText(url, { timeoutMs: 15_000, maxBytes: 1_500_000 });
    return {
      url,
      ok: response.ok,
      status: response.status,
      finalUrl: response.finalUrl,
      contentType: response.contentType,
      contentLength: response.contentLength,
      truncated: response.truncated,
      endpoints: endpointCandidates(response.text, response.finalUrl || pageUrl),
      contexts: keywordContexts(response.text, 16),
    };
  } catch (error) {
    return { url, ok: false, error: error?.message || String(error) };
  }
}

async function inspectTarget(target) {
  try {
    const page = await fetchText(target.url);
    const title = clean(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const scripts = extractAttrUrls(page.text, 'script', 'src', page.finalUrl || target.url);
    const links = extractAttrUrls(page.text, 'a', 'href', page.finalUrl || target.url)
      .filter(url => /(api|wait|queue|reserv|store|shop|ticket|reception|受付|待ち)/i.test(url));
    const inlineScripts = extractInlineScripts(page.text);
    const origin = new URL(page.finalUrl || target.url).origin;
    const candidateScripts = scripts
      .filter(url => {
        try { return new URL(url).origin === origin || /(?:\.js)(?:\?|$)/i.test(url); } catch { return false; }
      })
      .slice(0, 20);

    const assets = [];
    for (const scriptUrl of candidateScripts) assets.push(await inspectAsset(scriptUrl, page.finalUrl || target.url));

    const combinedInline = inlineScripts.join('\n');
    return {
      id: target.id,
      requestedUrl: target.url,
      ok: page.ok,
      status: page.status,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      contentLength: page.contentLength,
      truncated: page.truncated,
      title,
      textSample: htmlToText(page.text).slice(0, 12_000),
      pageEndpoints: unique([
        ...links,
        ...endpointCandidates(page.text, page.finalUrl || target.url),
        ...endpointCandidates(combinedInline, page.finalUrl || target.url),
      ]).slice(0, 100),
      pageContexts: keywordContexts(`${htmlToText(page.text)}\n${combinedInline}`, 30),
      scriptUrls: scripts.slice(0, 60),
      assets,
    };
  } catch (error) {
    return {
      id: target.id,
      requestedUrl: target.url,
      ok: false,
      error: error?.stack || error?.message || String(error),
    };
  }
}

const results = [];
for (const target of targets) results.push(await inspectTarget(target));

const output = {
  generatedAt: new Date().toISOString(),
  purpose: 'One-time inspection of public official crowd and reservation pages. No credentials or cookies are used.',
  results,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
for (const result of results) {
  console.log(`${result.id}: ${result.status || 'error'} / scripts=${result.scriptUrls?.length || 0} / assets=${result.assets?.length || 0}`);
}
