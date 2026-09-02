import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FAIR_PATH = path.join(ROOT, 'app', 'data', 'fairs.json');
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';
const SUSHIRO_INDEX = 'https://www.akindo-sushiro.co.jp/campaign/';
const KURA_ARCHIVE = year => `https://www.kurasushi.co.jp/author/${year}.html`;
const MAX_UPCOMING_DAYS = 7;

const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const absoluteUrl = (value, base) => { try { return value ? new URL(value, base).href : null; } catch { return null; } };
const isoDate = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const normalize = value => clean(value).replace(/[「」『』〖〗【】［］\[\]（）()・:：,，.。!！?？'"“”‘’＼／\\/|\-–—〜～\s]/g, '').toLowerCase();

function jstTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dayDistance(a, b) {
  return Math.round((new Date(`${a}T00:00:00+09:00`) - new Date(`${b}T00:00:00+09:00`)) / 86_400_000);
}

async function fetchHtml(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect:'follow', signal:AbortSignal.timeout(20_000),
        headers:{ 'user-agent':UA, 'accept-language':'ja-JP,ja;q=0.9', 'cache-control':'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError;
}

function pageLines(html) {
  const $ = cheerio.load(html);
  const body = $('body').html() || '';
  const withBreaks = body
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|dt|dd|h[1-6]|section|article|tr|td|figure|figcaption|a)>/gi, '\n');
  const fragment = cheerio.load(`<div>${withBreaks}</div>`);
  return fragment('div').first().text().split(/\n+/).map(clean).filter(Boolean);
}

function parseMonthDayRange(text, year) {
  const value = clean(text);
  const match = value.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?\s*[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) return { startDate:null, endDate:null };
  const sm = Number(match[1]);
  const em = Number(match[4]);
  const endYear = Number(match[3] || (em < sm ? year + 1 : year));
  return { startDate:isoDate(year, sm, Number(match[2])), endDate:isoDate(endYear, em, Number(match[5])) };
}

function parseSlashRange(text, year) {
  const match = String(text).match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*[～〜~\-–—]\s*(\d{1,2})\/(\d{1,2})/);
  if (!match) return { startDate:null, endDate:null };
  const sm = Number(match[1]);
  const em = Number(match[3]);
  return { startDate:isoDate(year, sm, Number(match[2])), endDate:isoDate(em < sm ? year + 1 : year, em, Number(match[4])) };
}

function findSushiroSeriesName(title, body) {
  const quoted = [...String(body).matchAll(/「([^」]{4,110}?(?:メニュー|フェア|祭り|キャンペーン))」/g)]
    .map(match => clean(match[1]))
    .filter(value => !/X（旧Twitter）|利用規約/.test(value));
  if (quoted.length) return quoted.sort((a, b) => b.length - a.length)[0];
  return clean(title).replace(/\s+税込\s*[\d,]+円.*$/u, '').replace(/\s*\|.*$/, '') || 'おすすめ・フェア情報';
}

function parseSushiroDetail(html, sourceUrl, currentItemNames, today = jstTodayKey()) {
  const $ = cheerio.load(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text());
  const body = clean($('body').text());
  const bodyKey = normalize(body);
  const matchedItems = currentItemNames.filter(name => bodyKey.includes(normalize(name)));
  if (!matchedItems.length) return null;
  const year = Number(today.slice(0, 4));
  const ranges = [];
  for (const match of body.matchAll(/\d{1,2}\/\d{1,2}(?:\([^)]*\))?\s*[～〜~\-–—]\s*\d{1,2}\/\d{1,2}/g)) {
    const range = parseSlashRange(match[0], year);
    if (range.startDate) ranges.push(range);
  }
  const starts = ranges.map(range => range.startDate).sort();
  const ends = ranges.map(range => range.endDate).filter(Boolean).sort();
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl);
  return {
    fairName:findSushiroSeriesName(title, body), officialCampaignTitle:title, officialCampaignUrl:sourceUrl,
    startDate:starts[0] || null, endDate:ends.at(-1) || null, imageUrl,
    matchedItems, score:matchedItems.length,
  };
}

async function discoverSushiro(chain, today = jstTodayKey()) {
  if (!chain?.items?.length) return chain;
  const indexHtml = await fetchHtml(SUSHIRO_INDEX);
  const $ = cheerio.load(indexHtml);
  const urls = [];
  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), SUSHIRO_INDEX);
    if (href && /\/campaign\/detail\.php\?id=\d+/.test(href)) urls.push(href);
  });
  const unique = [...new Set(urls)].slice(0, 12);
  const names = chain.items.filter(item => item?.saleStatus !== 'ended').map(item => clean(item.name)).filter(Boolean);
  const candidates = [];
  for (const url of unique) {
    try {
      const parsed = parseSushiroDetail(await fetchHtml(url, 1), url, names, today);
      if (parsed) candidates.push(parsed);
      if (parsed?.score >= 4) break;
    } catch {}
  }
  candidates.sort((a, b) => b.score - a.score || String(b.startDate || '').localeCompare(String(a.startDate || '')));
  const selected = candidates[0];
  if (!selected) return chain;
  return {
    ...chain,
    fairName:selected.fairName,
    officialCampaignTitle:selected.officialCampaignTitle,
    officialCampaignUrl:selected.officialCampaignUrl,
    fairNameSource:'official_campaign_page',
    campaignMatchedItems:selected.matchedItems,
    campaignStartDate:selected.startDate || chain.startDate || null,
    campaignEndDate:selected.endDate || chain.endDate || null,
  };
}

function publicationYear(title, body, today) {
  const match = `${title} ${body}`.match(/(20\d{2})[./年]/);
  return Number(match?.[1] || today.slice(0, 4));
}

function kuraFairName(title) {
  const quoted = title.match(/[「『]([^」』]{1,55})[」』]\s*(フェア|祭り)/);
  if (quoted) return `${clean(quoted[1])}${quoted[2]}`;
  const bare = title.match(/([^。！？!?]{2,70}?(?:フェア|祭り))/);
  return clean(bare?.[1] || '公式フェア');
}

function kuraStartDate(title, body, year) {
  for (const source of [title, body.slice(0, 1600)]) {
    const full = source.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]{0,20}(?:より|から|～|〜)/);
    if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3]));
    const short = source.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]*[）)])?[^。]{0,18}(?:より|から|～|〜)/);
    if (short) return isoDate(year, Number(short[1]), Number(short[2]));
  }
  return null;
}

function parseKuraRelease(html, sourceUrl, today = jstTodayKey()) {
  const $ = cheerio.load(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1,h2').first().text());
  if (!/(?:フェア|祭り)/.test(title)) return null;
  const body = clean($('body').text());
  const year = publicationYear(title, body, today);
  const startDate = kuraStartDate(title, body, year);
  if (!startDate) return null;
  const lines = pageLines(html);
  let endIndex = lines.findIndex(line => /^■/.test(line) && /(?:秋といえば|デザート|コラボ|レシートキャンペーン|キャンペーン詳細)/.test(line));
  if (endIndex < 0) endIndex = lines.length;
  const fairLines = lines.slice(0, endIndex);
  const items = [];
  for (let index = 0; index < fairLines.length; index += 1) {
    const line = fairLines[index];
    if (/応募|景品|お食事券|クーポン|お会計|最低価格|価格改定/.test(line)) continue;
    const match = line.match(/^(.{2,90}?)\s+([\d,]+)\s*円(?:\s|$)/);
    if (!match) continue;
    const periodLine = fairLines.slice(index + 1, index + 4).find(value => /販売期間/.test(value));
    if (!periodLine) continue;
    const range = parseMonthDayRange(periodLine, year);
    if (!range.startDate) continue;
    const price = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    items.push({
      name:clean(match[1]), price, ...range,
      saleStatus:range.startDate > today ? 'active' : 'active',
      scrapeStatus:'ok', sourceUrl,
      availabilityNote:range.startDate > today ? `${range.startDate.slice(5).replace('-', '/')}から販売予定` : undefined,
    });
  }
  const unique = [...new Map(items.map(item => [`${normalize(item.name)}|${item.price}`, item])).values()].slice(0, 30);
  if (!unique.length) return null;
  const ends = unique.map(item => item.endDate).filter(Boolean).sort();
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl);
  return {
    fairName:kuraFairName(title), startDate, endDate:ends.at(-1) || null, items:unique,
    sourceUrl, officialReleaseUrl:sourceUrl, imageUrl, officialCampaignTitle:title,
  };
}

function kuraCandidateRank(candidate, today) {
  if (!candidate?.startDate) return Number.POSITIVE_INFINITY;
  if (candidate.endDate && candidate.endDate < today) return Number.POSITIVE_INFINITY;
  const delta = dayDistance(candidate.startDate, today);
  if (delta <= 0) return Math.abs(delta);
  if (delta <= MAX_UPCOMING_DAYS) return 100 + delta;
  return Number.POSITIVE_INFINITY;
}

async function discoverKura(chain, today = jstTodayKey()) {
  const hasCurrentProducts = chain?.items?.length && (!chain.endDate || chain.endDate >= today) && !/(?:開催中イベント|最新フェア確認中)/.test(chain.fairName || '');
  if (hasCurrentProducts) return chain;
  const year = Number(today.slice(0, 4));
  const indexUrl = KURA_ARCHIVE(year);
  const indexHtml = await fetchHtml(indexUrl);
  const $ = cheerio.load(indexHtml);
  const urls = [];
  $('a[href]').each((_, element) => {
    const text = clean(`${$(element).text()} ${$(element).find('img[alt]').map((__, image) => $(image).attr('alt') || '').get().join(' ')}`);
    if (!/(?:フェア|祭り)/.test(text)) return;
    const href = absoluteUrl($(element).attr('href'), indexUrl);
    if (href && /\/author\/\d+\.html(?:$|[?#])/.test(href)) urls.push(href);
  });
  const candidates = [];
  for (const url of [...new Set(urls)].slice(0, 18)) {
    try {
      const parsed = parseKuraRelease(await fetchHtml(url, 1), url, today);
      const rank = kuraCandidateRank(parsed, today);
      if (Number.isFinite(rank)) candidates.push({ ...parsed, rank });
    } catch {}
  }
  candidates.sort((a, b) => a.rank - b.rank || String(b.startDate).localeCompare(String(a.startDate)));
  const selected = candidates[0];
  if (!selected) return chain;
  const upcoming = selected.startDate > today;
  return {
    ...chain,
    fairName:selected.fairName,
    startDate:selected.startDate,
    endDate:selected.endDate,
    items:selected.items,
    sourceUrl:selected.sourceUrl,
    officialReleaseUrl:selected.officialReleaseUrl,
    officialCampaignTitle:selected.officialCampaignTitle,
    imageUrl:selected.imageUrl || chain.imageUrl || null,
    representativeImageUrl:selected.imageUrl || chain.representativeImageUrl || null,
    representativeImageSource:selected.imageUrl ? 'official_release_og' : chain.representativeImageSource,
    representativeImageProduct:selected.items[0]?.name || chain.representativeImageProduct || null,
    representativeImagePage:selected.sourceUrl,
    dataScope:'national_official_release',
    status:upcoming ? 'warning' : 'ok',
    message:upcoming ? `公式発表済み。${selected.startDate.slice(5).replace('-', '/')}開始予定のフェアです。` : null,
    campaignPhase:upcoming ? 'upcoming' : 'active',
    priceNote:'くら寿司公式プレスリリース掲載価格です。店舗により価格や取扱いが異なる場合があります。',
  };
}

function runSelfTests() {
  const sushiroFixture = `<!doctype html><html><head><meta property="og:title" content="お得に腹一杯！ 『天然まぐろのハラモ1貫』 税込120円～"></head><body>
  <h1>お得に腹一杯！ 『天然まぐろのハラモ1貫』 税込120円～</h1>
  <p>天然まぐろのハラモ1貫 120円(税込)〜 [9/2(水)～9/13(日)]</p><p>北海道産サンマとニシン盛り合わせ 120円(税込)〜 [9/2(水)～9/13(日)]</p>
  <p>「厳選天然ネタ＆スシローの赤しゃり＆季節のおすすめメニュー」に関わる対象ポスト</p></body></html>`;
  const sushiro = parseSushiroDetail(sushiroFixture, 'https://example.test/sushiro', ['天然まぐろのハラモ1貫','北海道産サンマとニシン盛り合わせ'], '2026-09-02');
  assert.equal(sushiro.fairName, '厳選天然ネタ＆スシローの赤しゃり＆季節のおすすめメニュー');
  assert.equal(sushiro.score, 2);
  assert.equal(sushiro.startDate, '2026-09-02');

  const kuraFixture = `<!doctype html><html><head><meta property="og:title" content="カニやサーモンが集結 「北海」フェア -9月4日（金）より期間限定で販売-"><meta property="og:image" content="/fair.png"></head><body>
  <p>2026.09.01</p><h1>カニやサーモンが集結 「北海」フェア -9月4日（金）より期間限定で販売-</h1>
  <h6>■期間限定でお得な商品</h6><p>厳選かに軍艦（一貫） 110円</p><p>販売期間：9月4日（金）～9月13日（日）</p>
  <h6>■販売概要 商品名 / 価格 / 販売期間</h6><p>北海道サーモン 270円</p><p>販売期間：9月4日（金）～9月13日（日）</p>
  <p>〖北海道産〗秋刀魚 160円</p><p>販売期間：9月4日（金）～10月1日（木）</p><h6>■秋といえば月見！</h6><p>月見バーガー 450円</p><p>販売期間：9月4日（金）～10月1日（木）</p></body></html>`;
  const kura = parseKuraRelease(kuraFixture, 'https://www.kurasushi.co.jp/author/008437.html', '2026-09-02');
  assert.equal(kura.fairName, '北海フェア');
  assert.equal(kura.startDate, '2026-09-04');
  assert.deepEqual(kura.items.map(item => [item.name,item.price]), [['厳選かに軍艦（一貫）',110],['北海道サーモン',270],['〖北海道産〗秋刀魚',160]]);
  assert.equal(kura.endDate, '2026-10-01');
  assert.equal(kuraCandidateRank(kura, '2026-09-02'), 102);
  console.log('Official fair discovery self-tests passed.');
}

async function main() {
  const today = jstTodayKey();
  const data = JSON.parse(await fs.readFile(FAIR_PATH, 'utf8'));
  const byChain = Object.fromEntries((data.chains || []).map(chain => [chain.chain, chain]));
  try { if (byChain.sushiro) byChain.sushiro = await discoverSushiro(byChain.sushiro, today); }
  catch (error) { console.warn(`Sushiro official campaign discovery skipped: ${error.message}`); }
  try { if (byChain.kurasushi) byChain.kurasushi = await discoverKura(byChain.kurasushi, today); }
  catch (error) { console.warn(`Kura official release discovery skipped: ${error.message}`); }
  data.chains = (data.chains || []).map(chain => byChain[chain.chain] || chain);
  await fs.writeFile(FAIR_PATH, `${JSON.stringify(data, null, 2)}\n`);
  const s = byChain.sushiro, k = byChain.kurasushi;
  console.log(`Official fair discovery: sushiro=${s?.fairName || 'n/a'} (${s?.officialCampaignUrl || 'no campaign url'}), kura=${k?.fairName || 'n/a'} (${k?.campaignPhase || k?.status || 'n/a'})`);
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
