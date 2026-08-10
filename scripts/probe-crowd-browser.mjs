import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'diagnostics', 'crowd-browser.json');
const executablePath = process.env.CHROME_PATH;

if (!executablePath) throw new Error('CHROME_PATH is not set');

const targets = [
  {
    id: 'sushiro-entry',
    url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/store/reservation/entry/?storeId=179',
  },
  {
    id: 'sushiro-area',
    url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/stores/area/?storeId=179',
  },
  {
    id: 'sushiro-localticket',
    url: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/ui/localticket/stores/?storeId=179',
  },
  {
    id: 'hamazushi-primary',
    url: 'https://my.hama-sushi.co.jp/shop/index/?search=1&shopId=148',
  },
  {
    id: 'hamazushi-alternate',
    url: 'https://my.hamazushi.com/shop/index/?search=1&shopId=148',
  },
  {
    id: 'kurasushi',
    url: 'https://shop.kurasushi.co.jp/detail/609',
  },
  {
    id: 'kappasushi',
    url: 'https://yoyaku.kappasushi.jp/shop/detail/shop_id/988',
  },
];

const KEYWORD = /(wait|waiting|queue|ticket|reception|reserv|store|shop|congestion|crowd|待ち|順番|受付|予約|混雑|組)/i;
const ALLOWED_QUERY_KEYS = new Set(['storeId', 'shopId', 'shop_id', 'id', 'search']);

function sanitizeUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const [key, raw] of [...url.searchParams.entries()]) {
      if (ALLOWED_QUERY_KEYS.has(key) && /^[0-9]+$/.test(raw)) continue;
      url.searchParams.set(key, '<redacted>');
    }
    return url.href;
  } catch {
    return String(value).slice(0, 500);
  }
}

function sanitizeText(value = '') {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/(?:access|id|refresh)[_-]?token["'\s:=]+[A-Za-z0-9._~-]{12,}/gi, '<token redacted>')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt redacted>')
    .replace(/[A-Fa-f0-9]{48,}/g, '<hex redacted>')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function usefulSnippet(text = '') {
  const clean = sanitizeText(text);
  const match = clean.match(KEYWORD);
  if (!match) return clean.slice(0, 1200);
  const index = match.index || 0;
  return clean.slice(Math.max(0, index - 500), Math.min(clean.length, index + 2500));
}

async function inspectTarget(browser, target) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    viewport: { width: 430, height: 932 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  const requests = [];
  const responses = [];
  const consoleMessages = [];

  page.on('request', request => {
    if (!['xhr', 'fetch', 'document', 'script'].includes(request.resourceType())) return;
    requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: sanitizeUrl(request.url()),
    });
  });

  page.on('response', async response => {
    const request = response.request();
    const resourceType = request.resourceType();
    const contentType = response.headers()['content-type'] || '';
    if (!['xhr', 'fetch'].includes(resourceType) && !/json/i.test(contentType) && !KEYWORD.test(response.url())) return;

    const entry = {
      status: response.status(),
      resourceType,
      contentType,
      url: sanitizeUrl(response.url()),
    };

    try {
      const text = await response.text();
      if (/json|javascript|text/i.test(contentType) || KEYWORD.test(text)) {
        entry.snippet = usefulSnippet(text);
      }
    } catch {}
    responses.push(entry);
  });

  page.on('console', message => {
    if (consoleMessages.length >= 30) return;
    const text = sanitizeText(message.text());
    if (text) consoleMessages.push({ type: message.type(), text: text.slice(0, 1200) });
  });

  let navigationError = null;
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(12_000);
  } catch (error) {
    navigationError = error?.message || String(error);
  }

  let title = '';
  let finalUrl = '';
  let bodyText = '';
  let resourceUrls = [];
  try {
    title = await page.title();
    finalUrl = page.url();
    bodyText = sanitizeText(await page.locator('body').innerText({ timeout: 5_000 }));
    resourceUrls = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  } catch {}

  await context.close();
  return {
    id: target.id,
    requestedUrl: sanitizeUrl(target.url),
    finalUrl: sanitizeUrl(finalUrl),
    title: sanitizeText(title),
    navigationError,
    bodyText: bodyText.slice(0, 15_000),
    requests: uniqueBy(requests, item => `${item.method}|${item.resourceType}|${item.url}`).slice(0, 250),
    responses: uniqueBy(responses, item => `${item.status}|${item.resourceType}|${item.url}`).slice(0, 250),
    resourceUrls: [...new Set(resourceUrls.map(sanitizeUrl))]
      .filter(url => KEYWORD.test(url))
      .slice(0, 150),
    consoleMessages,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const results = [];
try {
  for (const target of targets) {
    console.log(`Inspecting ${target.id}`);
    results.push(await inspectTarget(browser, target));
  }
} finally {
  await browser.close();
}

const output = {
  generatedAt: new Date().toISOString(),
  purpose: 'One-time browser/network inspection of public official pages without login credentials or persisted cookies.',
  results,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
