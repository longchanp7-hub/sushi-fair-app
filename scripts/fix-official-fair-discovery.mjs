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
const activeItem = (item, today) => item?.saleStatus !== 'ended' && (!item?.endDate || item.endDate >= today);
const uniqItems = rows => [...new Map(rows.filter(Boolean).map(item => [normalize(item.name), item])).values()];

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

function sushiroCategory(title) {
  if (/SUSHIRO\s*Cafe|スシローカフェ|スイーツ|デザート|パフェ|アイス|まぜまぜ/i.test(title)) return 'dessert';
  if (/お持ち帰り|持ち帰り|テイクアウト/.test(title)) return 'takeout';
  if (/ポイント|スタンプ|優待|クーポン|お食事券/.test(title)) return 'benefit';
  if (/こども|お子さま|キッズ|じぶんでつくロー/.test(title)) return 'other';
  return 'fair';
}

function sushiroCampaignId(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return `sushiro-${url.searchParams.get('id') || normalize(url.pathname).slice(-20)}`;
  } catch { return `sushiro-${normalize(sourceUrl).slice(-20)}`; }
}

function parseSushiroProducts(html, sourceUrl) {
  const lines = pageLines(html);
  const marker = lines.findIndex(line => /対象商品一覧/.test(line));
  if (marker < 0) return [];
  let end = lines.findIndex((line, index) => index > marker && /X（旧Twitter）キャンペーン|X\s*キャンペーン実施中|当選人数・賞品|キャンペーン利用規約/.test(line));
  if (end < 0) end = lines.length;
  const scoped = lines.slice(marker + 1, end);
  const out = [];
  for (let index = 0; index < scoped.length; index += 1) {
    for (const text of [scoped[index], `${scoped[index]} ${scoped[index + 1] || ''}`]) {
      const match = clean(text).match(/^(.{2,100}?)\s+([\d,]+)\s*円\s*[（(]?税込[）)]?\s*([〜～~]?)/);
      if (!match) continue;
      const name = clean(match[1]).replace(/^[・●■◆◇\s]+/, '');
      const price = Number(match[2].replace(/,/g, ''));
      if (!name || name.length > 80 || !Number.isFinite(price) || price <= 0 || price > 5000) continue;
      if (/店舗|価格|キャンペーン|お食事券|ポイント|税込/.test(name)) continue;
      out.push({
        name,
        price,
        priceType:match[3] ? 'from' : 'listed',
        saleStatus:'active',
        scrapeStatus:'ok',
        sourceUrl,
      });
      break;
    }
  }
  return uniqItems(out);
}

function parseSushiroDetail(html, sourceUrl) {
  const $ = cheerio.load(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text()).replace(/\s*\|.*$/, '');
  if (!title) return null;
  const items = parseSushiroProducts(html, sourceUrl);
  if (!items.length) return null;
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl);
  const category = sushiroCategory(title);
  return {
    id:sushiroCampaignId(sourceUrl),
    fairName:title,
    officialCampaignTitle:title,
    officialCampaignUrl:sourceUrl,
    sourceUrl,
    startDate:null,
    endDate:null,
    campaignPhase:'active',
    category,
    items,
    itemStatus:'parsed',
    imageUrl,
    scopeNote:category === 'fair' ? 'スシロー公式「おすすめ」掲載中の商品です。店舗により価格・取扱いが異なる場合があります。' : 'スシロー公式「おすすめ」掲載中の関連商品です。主フェア商品とは分けて表示します。',
    lastConfirmedAt:new Date().toISOString(),
  };
}

async function discoverSushiro(chain, today = jstTodayKey()) {
  const indexHtml = await fetchHtml(SUSHIRO_INDEX);
  const $ = cheerio.load(indexHtml);
  const urls = [];
  $('a[href]').each((_, element) => {
    const href = absoluteUrl($(element).attr('href'), SUSHIRO_INDEX);
    if (href && /\/campaign\/detail\.php\?id=\d+/.test(href)) urls.push(href);
  });
  const unique = [...new Set(urls)].slice(0, 24);
  const candidates = [];
  for (let offset = 0; offset < unique.length; offset += 4) {
    const batch = await Promise.all(unique.slice(offset, offset + 4).map(async url => {
      try { return parseSushiroDetail(await fetchHtml(url, 1), url); }
      catch { return null; }
    }));
    candidates.push(...batch.filter(Boolean));
  }
  const main = candidates.filter(candidate => candidate.category === 'fair');
  if (!main.length) return chain;
  const existing = (chain.items || []).filter(item => activeItem(item, today));
  const items = uniqItems([...existing, ...main.flatMap(candidate => candidate.items)]);
  const names = [...new Set(main.map(candidate => candidate.fairName).filter(Boolean))];
  return {
    ...chain,
    fairName:names.slice(0, 6).join('／') || chain.fairName,
    items,
    campaigns:candidates,
    officialCampaignTitle:names.join('／'),
    officialCampaignUrl:SUSHIRO_INDEX,
    fairNameSource:'official_campaign_index',
    campaignMatchedItems:main.flatMap(candidate => candidate.items.map(item => item.name)),
    campaignDiscoveryAt:new Date().toISOString(),
    status:'ok',
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

function parseKuraItemRange(text, year, releaseStartDate) {
  const full = parseMonthDayRange(text, year);
  if (full.startDate) return full;
  const value = clean(text);
  const endOnly = value.match(/[～〜~\-–—]\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!endOnly) return { startDate:null, endDate:null };
  const startMonth = Number(releaseStartDate?.slice(5, 7) || 1);
  const endMonth = Number(endOnly[2]);
  const startYear = Number(releaseStartDate?.slice(0, 4) || year);
  const endYear = Number(endOnly[1] || (endMonth < startMonth ? startYear + 1 : startYear));
  return { startDate:releaseStartDate || null, endDate:isoDate(endYear, endMonth, Number(endOnly[3])) };
}

function kuraCampaignId(sourceUrl) {
  const match = String(sourceUrl).match(/\/author\/(\d+)\.html/);
  return `kurasushi-${match?.[1] || normalize(sourceUrl).slice(-20)}`;
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
    const range = parseKuraItemRange(periodLine, year, startDate);
    if (!range.startDate && !range.endDate) continue;
    const price = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    items.push({
      name:clean(match[1]), price, ...range,
      priceType:'listed',
      saleStatus:range.endDate && range.endDate < today ? 'ended' : 'active',
      scrapeStatus:'ok', sourceUrl,
      availabilityNote:range.startDate && range.startDate > today ? `${range.startDate.slice(5).replace('-', '/')}から販売予定` : undefined,
    });
  }
  const unique = [...new Map(items.map(item => [`${normalize(item.name)}|${item.price}`, item])).values()].slice(0, 30);
  if (!unique.length) return null;
  const ends = unique.map(item => item.endDate).filter(Boolean).sort();
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), sourceUrl);
  return {
    id:kuraCampaignId(sourceUrl),
    fairName:kuraFairName(title), startDate, endDate:ends.at(-1) || null, items:unique,
    sourceUrl, officialReleaseUrl:sourceUrl, imageUrl, officialCampaignTitle:title,
    category:'fair', itemStatus:'parsed',
    scopeNote:'くら寿司公式プレスリリース掲載の期間限定フェアです。店舗により価格・取扱いが異なる場合があります。',
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

function selectKuraCandidate(candidates, today) {
  const active = candidates
    .filter(candidate => candidate.startDate <= today && (!candidate.endDate || candidate.endDate >= today))
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  if (active.length) return active[0];
  return candidates
    .filter(candidate => candidate.startDate > today && dayDistance(candidate.startDate, today) <= MAX_UPCOMING_DAYS)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null;
}

async function discoverKura(chain, today = jstTodayKey()) {
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
  for (const url of [...new Set(urls)].slice(0, 20)) {
    try {
      const parsed = parseKuraRelease(await fetchHtml(url, 1), url, today);
      const rank = kuraCandidateRank(parsed, today);
      if (Number.isFinite(rank)) candidates.push({ ...parsed, rank });
    } catch {}
  }
  candidates.sort((a, b) => a.rank - b.rank || String(b.startDate).localeCompare(String(a.startDate)));
  const selected = selectKuraCandidate(candidates, today);
  if (!selected) return chain;
  const campaigns = candidates.map(({ rank, ...candidate }) => ({
    ...candidate,
    campaignPhase:candidate.endDate && candidate.endDate < today ? 'ended' : candidate.startDate > today ? 'upcoming' : 'active',
    lastConfirmedAt:new Date().toISOString(),
  }));
  const upcoming = selected.startDate > today;
  return {
    ...chain,
    fairName:selected.fairName,
    startDate:selected.startDate,
    endDate:selected.endDate,
    items:selected.items,
    campaigns,
    sourceUrl:selected.sourceUrl,
    officialReleaseUrl:selected.officialReleaseUrl,
    officialCampaignTitle:selected.officialCampaignTitle,
    imageUrl:selected.imageUrl || chain.imageUrl || null,
    representativeImageUrl:selected.imageUrl || chain.representativeImageUrl || null,
    representativeImageSource:selected.imageUrl ? 'official_release_og' : chain.representativeImageSource,
    representativeImageProduct:selected.items.find(item => activeItem(item, today))?.name || selected.items[0]?.name || chain.representativeImageProduct || null,
    representativeImagePage:selected.sourceUrl,
    dataScope:'national_official_release',
    status:upcoming ? 'warning' : 'ok',
    message:upcoming ? `公式発表済み。${selected.startDate.slice(5).replace('-', '/')}開始予定のフェアです。` : null,
    campaignPhase:upcoming ? 'upcoming' : 'active',
    priceNote:'くら寿司公式プレスリリース掲載価格です。店舗により価格や取扱いが異なる場合があります。',
  };
}

function runSelfTests() {
  const sushiroFixture = `<!doctype html><html><head><meta property="og:title" content="さんまを楽しむ スシローの秋 | おすすめ一覧"></head><body>
  <h1>さんまを楽しむ スシローの秋</h1><h2>対象商品一覧</h2>
  <p>店舗によって価格が異なります。</p><p>国産 さんま 180円(税込)〜 ※通常販売商品です。</p><p>秋の山海の幸 天ぷら盛り 430円(税込)〜</p>
  <h2>X（旧Twitter）キャンペーン実施中！お食事券1万円分が当たる！</h2><p>■X（旧Twitter）キャンペーン期間 2026年9月16日～2026年9月27日</p></body></html>`;
  const sushiro = parseSushiroDetail(sushiroFixture, 'https://www.akindo-sushiro.co.jp/campaign/detail.php?id=4533');
  assert.equal(sushiro.fairName, 'さんまを楽しむ スシローの秋');
  assert.equal(sushiro.category, 'fair');
  assert.deepEqual(sushiro.items.map(item => [item.name,item.price]), [['国産 さんま',180],['秋の山海の幸 天ぷら盛り',430]]);
  assert.equal(sushiro.startDate, null, 'X campaign dates must not be reused as food sale dates');

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
  const kuraAfterPartialEnd = parseKuraRelease(kuraFixture, 'https://www.kurasushi.co.jp/author/008437.html', '2026-09-15');
  assert.deepEqual(kuraAfterPartialEnd.items.map(item => [item.name,item.saleStatus]), [['厳選かに軍艦（一貫）','ended'],['北海道サーモン','ended'],['〖北海道産〗秋刀魚','active']]);

  const upcomingFixture = `<!doctype html><html><head><meta property="og:title" content="「濃厚うにといくら」フェア ―9月18日（金）から期間・数量限定で販売―"></head><body>
  <p>2026.09.15</p><h1>「濃厚うにといくら」フェア ―9月18日（金）から期間・数量限定で販売―</h1><h6>■販売概要 商品名 / 価格 / 販売期間</h6>
  <p>濃厚うに(一貫) 230円</p><p>販売期間：～9月27日（日）</p><p>海水仕込み 純いくら(一貫) 330円</p><p>販売期間：～10月1日（木）</p><p>北海風軍艦 380円</p><p>販売期間：9月18日（金）～9月27日（日）</p><h6>■コラボ商品</h6></body></html>`;
  const upcoming = parseKuraRelease(upcomingFixture, 'https://www.kurasushi.co.jp/author/008568.html', '2026-09-17');
  assert.deepEqual(upcoming.items.map(item => [item.name,item.startDate,item.endDate]), [
    ['濃厚うに(一貫)','2026-09-18','2026-09-27'],
    ['海水仕込み 純いくら(一貫)','2026-09-18','2026-10-01'],
    ['北海風軍艦','2026-09-18','2026-09-27'],
  ]);
  assert.equal(selectKuraCandidate([kura,upcoming], '2026-09-17').fairName, '北海フェア');
  assert.equal(selectKuraCandidate([kura,upcoming], '2026-09-18').fairName, '濃厚うにといくらフェア');
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
  console.log(`Official fair discovery: sushiro=${s?.fairName || 'n/a'} (${s?.campaigns?.length || 0} official food campaigns), kura=${k?.fairName || 'n/a'} (${k?.campaignPhase || k?.status || 'n/a'}, ${k?.campaigns?.length || 0} current/upcoming fairs)`);
}

if (process.argv.includes('--self-test')) runSelfTests();
else await main();
