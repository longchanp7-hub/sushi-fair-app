import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE_URL = process.argv[2];
const REPORT_PATH = process.env.SMOKE_REPORT_PATH || null;
const MAX_ATTEMPTS = 12;
const RETRY_DELAY_MS = 5_000;

if (!PAGE_URL) throw new Error('Usage: node scripts/verify-pages.mjs <page-url>');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeText = value => String(value).replace(/\r\n/g, '\n').trimEnd();

function cacheBusted(url, attempt) {
  const value = new URL(url);
  value.searchParams.set('__smoke', `${Date.now()}-${attempt}`);
  return value.href;
}

async function fetchText(url, attempt) {
  const response = await fetch(cacheBusted(url, attempt), {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: 'text/html,application/json,text/plain,*/*;q=0.5',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.text();
}

function validateFairs(data) {
  assert.equal(data?.schemaVersion, 2, 'fairs schemaVersion must be 2');
  assert.equal(data?.timezone, 'Asia/Tokyo', 'fairs timezone must be Asia/Tokyo');
  assert.ok(Date.parse(data?.updatedAt), 'fairs updatedAt must be a valid timestamp');
  assert.equal(data?.locationModel?.mode, 'manual_prefecture_city');
  assert.equal(data?.locationModel?.gps, false, 'nationwide MVP must not require GPS');
  assert.ok(Array.isArray(data?.chains), 'fairs chains must be an array');

  const byChain = Object.fromEntries(data.chains.map(chain => [chain.chain, chain]));
  assert.deepEqual(
    Object.keys(byChain).sort(),
    ['hamazushi', 'kappasushi', 'kurasushi', 'sushiro', 'uobei'],
    'all five chains must be published exactly once',
  );

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  for (const chain of data.chains) {
    assert.ok(Array.isArray(chain.items), `${chain.chain} items must be an array`);
    assert.match(chain.officialActionUrl || '', /^https:\/\//, `${chain.chain} must expose an official action URL`);
    assert.equal(chain.officialActionLabel, '混雑・順番待ち・予約を公式で確認');
    assert.ok(chain.regionalModel?.strategyKey, `${chain.chain} must declare its regional strategy`);
    if (chain.endDate && chain.endDate < today) {
      assert.notEqual(chain.status, 'ok', `${chain.chain} must not present an expired fair as current`);
    }
    for (const item of chain.items) {
      assert.ok(item?.name, `${chain.chain} item name is required`);
      assert.ok(['active', 'ended', 'unknown'].includes(item.saleStatus || 'active'), `${chain.chain} invalid saleStatus`);
      assert.ok(item.scrapeStatus, `${chain.chain} item scrapeStatus is required`);
      if (item.endDate && item.endDate < today) {
        assert.notEqual(item.saleStatus, 'active', `${chain.chain}/${item.name} expired item must not remain active`);
      }
    }
  }
}

function validateIndex(index) {
  assert.match(index, /id="prefectureSelect"/, 'prefecture selector is missing');
  assert.match(index, /id="citySelect"/, 'municipality selector is missing');
  assert.match(index, /data-chain="uobei"/, 'Uobei filter is missing');
  assert.match(index, /\.\/national\.js/, 'nationwide client is not loaded');
  assert.doesNotMatch(index, /\.\/crowd\.js/, 'legacy crowd client must not be loaded');
}

async function verifyOnce(attempt, localIndex, localFairsText) {
  const baseUrl = new URL(PAGE_URL);
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

  const remoteIndex = await fetchText(baseUrl.href, attempt);
  assert.equal(normalizeText(remoteIndex), normalizeText(localIndex), 'published index.html does not match the deployed source');
  validateIndex(remoteIndex);

  const fairsUrl = new URL('data/fairs.json', baseUrl).href;
  const remoteFairsText = await fetchText(fairsUrl, attempt);
  assert.equal(normalizeText(remoteFairsText), normalizeText(localFairsText), 'published fairs.json does not match the deployed source');
  const fairs = JSON.parse(remoteFairsText);
  validateFairs(fairs);

  return {
    status: 'ok',
    verifiedAt: new Date().toISOString(),
    testedCommit: process.env.GITHUB_SHA || null,
    pageUrl: baseUrl.href,
    publicIndexMatchesSource: true,
    publicFairsMatchSource: true,
    fairsUpdatedAt: fairs.updatedAt,
    chains: Object.fromEntries(fairs.chains.map(chain => [chain.chain, {
      fairName: chain.fairName,
      itemCount: chain.items.length,
      status: chain.status,
    }])),
  };
}

async function writeReport(result) {
  if (!REPORT_PATH) return;
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote smoke report to ${REPORT_PATH}`);
}

const localIndex = await fs.readFile(path.join(ROOT, 'app', 'index.html'), 'utf8');
const localFairsText = await fs.readFile(path.join(ROOT, 'app', 'data', 'fairs.json'), 'utf8');

let lastError = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    const result = await verifyOnce(attempt, localIndex, localFairsText);
    await writeReport(result);
    console.log('Published nationwide app smoke test passed.');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`Smoke attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
}

throw lastError || new Error('Published app smoke test failed');
