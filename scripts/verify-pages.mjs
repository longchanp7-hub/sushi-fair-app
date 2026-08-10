import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE_URL = process.argv[2];
const CROWD_URL = 'https://raw.githubusercontent.com/longchanp7-hub/sushi-fair-app/crowd-live/app/data/crowd.json';
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
  assert.equal(data?.timezone, 'Asia/Tokyo', 'fairs timezone must be Asia/Tokyo');
  assert.ok(Date.parse(data?.updatedAt), 'fairs updatedAt must be a valid timestamp');
  assert.ok(Array.isArray(data?.chains), 'fairs chains must be an array');

  const byChain = Object.fromEntries(data.chains.map(chain => [chain.chain, chain]));
  assert.deepEqual(
    Object.keys(byChain).sort(),
    ['hamazushi', 'kappasushi', 'kurasushi', 'sushiro'],
    'all four chains must be published exactly once',
  );
  assert.match(byChain.sushiro.storeName || '', /豊橋新栄店/, 'Sushiro store must remain Toyohashi Shinsakae');
  assert.match(byChain.hamazushi.storeName || '', /豊橋新栄店/, 'Hamazushi store must remain Toyohashi Shinsakae');
  assert.match(byChain.kurasushi.storeName || '', /豊橋新栄店/, 'Kura store must remain Toyohashi Shinsakae');
  assert.match(byChain.kappasushi.storeName || '', /豊橋飯村店/, 'Kappa store must remain Toyohashi Iimura');

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  for (const chain of data.chains) {
    if (chain.endDate && chain.endDate < today) {
      assert.notEqual(chain.status, 'ok', `${chain.chain} must not present an expired fair as current`);
    }
  }
}

function validateCrowd(data) {
  assert.equal(data?.timezone, 'Asia/Tokyo', 'crowd timezone must be Asia/Tokyo');
  const updatedAt = Date.parse(data?.updatedAt);
  assert.ok(Number.isFinite(updatedAt), 'crowd updatedAt must be a valid timestamp');
  const ageMs = Date.now() - updatedAt;
  assert.ok(ageMs >= -300_000, 'crowd timestamp must not be far in the future');
  assert.ok(ageMs <= 30 * 60_000, `crowd snapshot is stale by ${Math.floor(ageMs / 60_000)} minutes`);
  assert.ok(Array.isArray(data?.stores), 'crowd stores must be an array');

  const byChain = Object.fromEntries(data.stores.map(store => [store.chain, store]));
  assert.deepEqual(
    Object.keys(byChain).sort(),
    ['hamazushi', 'kappasushi', 'kurasushi', 'sushiro'],
    'all four crowd stores must be present exactly once',
  );
  assert.match(byChain.sushiro.storeName || '', /豊橋新栄店/);
  assert.match(byChain.hamazushi.storeName || '', /豊橋新栄店/);
  assert.equal(byChain.kurasushi.method, 'reservation_slot');
  assert.equal(byChain.kurasushi.level, 'unknown', 'Kura reservation slots must not become a congestion level');
  assert.ok(byChain.kurasushi.estimatedMinutes == null, 'Kura reservation slots must not become estimated wait minutes');
  assert.equal(byChain.kappasushi.method, 'actual_wait');
}

async function verifyOnce(attempt, localIndex, localFairsText) {
  const baseUrl = new URL(PAGE_URL);
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

  const remoteIndex = await fetchText(baseUrl.href, attempt);
  assert.equal(normalizeText(remoteIndex), normalizeText(localIndex), 'published index.html does not match the deployed source');

  const fairsUrl = new URL('data/fairs.json', baseUrl).href;
  const remoteFairsText = await fetchText(fairsUrl, attempt);
  assert.equal(normalizeText(remoteFairsText), normalizeText(localFairsText), 'published fairs.json does not match the deployed source');
  const fairs = JSON.parse(remoteFairsText);
  validateFairs(fairs);

  const crowdText = await fetchText(CROWD_URL, attempt);
  const crowd = JSON.parse(crowdText);
  validateCrowd(crowd);

  return {
    pageUrl: baseUrl.href,
    fairsUpdatedAt: fairs.updatedAt,
    crowdUpdatedAt: crowd.updatedAt,
    crowdLabels: Object.fromEntries(crowd.stores.map(store => [store.chain, store.label])),
  };
}

const localIndex = await fs.readFile(path.join(ROOT, 'app', 'index.html'), 'utf8');
const localFairsText = await fs.readFile(path.join(ROOT, 'app', 'data', 'fairs.json'), 'utf8');

let lastError = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    const result = await verifyOnce(attempt, localIndex, localFairsText);
    console.log('Published app smoke test passed.');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`Smoke attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
}

throw lastError || new Error('Published app smoke test failed');
