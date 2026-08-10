from pathlib import Path

path = Path('scripts/refresh-crowd-standalone.mjs')
text = path.read_text(encoding='utf-8')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return source.replace(old, new, 1)


def replace_block(source: str, start: str, end: str, new_block: str, label: str) -> str:
    start_index = source.find(start)
    if start_index < 0:
        raise RuntimeError(f'{label}: start marker not found')
    end_index = source.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f'{label}: end marker not found')
    return source[:start_index] + new_block.rstrip() + '\n\n' + source[end_index:]


text = replace_once(
    text,
    "    name: 'スシロー 豊橋新栄店',\n    statusUrls:",
    "    name: 'スシロー 豊橋新栄店',\n    crowdStoreId: 179,\n    crowdApiUrl: 'https://linemini.akindo-sushiro.co.jp/LINE-mini/api/stores?latitude=34.7634355&longitude=137.3656127&numresults=3',\n    statusUrls:",
    'Sushiro API config',
)

fetch_json = r'''async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: {
      'user-agent': UA,
      'accept-language': 'ja-JP,ja;q=0.9',
      accept: 'application/json,text/plain,*/*',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}'''

text = replace_once(
    text,
    '\nfunction jstParts(date = new Date()) {',
    '\n' + fetch_json + '\n\nfunction jstParts(date = new Date()) {',
    'fetchJson insertion',
)

wait_from_numbers = r'''function waitFromNumbers({ waitMinutes = null, waitGroups = null } = {}) {
  const normalizedMinutes = Number.isFinite(waitMinutes) && waitMinutes >= 0 && waitMinutes <= 240
    ? Number(waitMinutes)
    : null;
  const normalizedGroups = Number.isFinite(waitGroups) && waitGroups >= 0 && waitGroups <= 200
    ? Number(waitGroups)
    : null;
  if (normalizedMinutes === null && normalizedGroups === null) return null;
  return { waitMinutes:normalizedMinutes, waitGroups:normalizedGroups };
}'''

text = replace_block(
    text,
    'function waitFromNumbers(',
    'function parsePublicWait(',
    wait_from_numbers,
    'waitFromNumbers replacement',
)

sushiro_parsers = r'''function integerInRange(value, min, max) {
  const source = String(value ?? '').trim();
  if (!/^-?\d+$/.test(source)) return null;
  const number = Number(source);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

function normalizeSushiroWait({ waitMinutes, waitGroups, waitTimeCap, waitShowType }) {
  const cap = integerInRange(waitTimeCap, 1, 240) ?? 240;
  const rawMinutes = integerInRange(waitMinutes, -1, 999);
  const rawGroups = integerInRange(waitGroups, -1, 200);
  const showType = integerInRange(waitShowType, 0, 2);
  if (showType === null) return null;

  let minutes = rawMinutes !== null && rawMinutes >= 0 ? Math.min(rawMinutes, cap) : null;
  let groups = rawGroups !== null && rawGroups >= 0 ? rawGroups : null;
  if (showType === 1) minutes = null;
  if (showType === 0) groups = null;

  const wait = waitFromNumbers({ waitMinutes:minutes, waitGroups:groups });
  if (!wait) return null;
  return {
    ...wait,
    waitMinutesAtLeast: rawMinutes !== null && rawMinutes > cap,
    waitShowType: showType,
    sourceSeat: 'table',
  };
}

function parseSushiroStoreData(payload, expectedStoreId = 179) {
  if (!Array.isArray(payload)) return null;
  const store = payload.find(item => Number(item?.id) === Number(expectedStoreId));
  if (!store) return null;
  if (String(store.storeStatus || '').toUpperCase() !== 'OPEN') return null;
  if (store.netTicketStatus && String(store.netTicketStatus).toUpperCase() !== 'ONLINE') return null;

  let waitGroups = integerInRange(store.waitingGroupTable, -1, 200);
  const fallbackGroups = integerInRange(store.waitingGroup, -1, 200);
  if (waitGroups !== null && waitGroups < 0 && fallbackGroups !== null && fallbackGroups >= 0) {
    waitGroups = fallbackGroups;
  }

  return normalizeSushiroWait({
    waitMinutes: store.wait,
    waitGroups,
    waitTimeCap: store.waitTimeCap,
    waitShowType: store.waitShowType,
  });
}

function htmlInputValue(html = '', id = '') {
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(html).match(new RegExp(`<input\\b[^>]*\\bid=["']${escapedId}["'][^>]*>`, 'i'))?.[0];
  if (!tag) return null;
  const value = tag.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return value ? decodeEntities(value[1] ?? value[2] ?? value[3] ?? '') : null;
}

function parseSushiroWaitPage(html, expectedStoreId = 179) {
  if (String(htmlInputValue(html, 'storeId')) !== String(expectedStoreId)) return null;
  if (String(htmlInputValue(html, 'storeStatus') || '').toUpperCase() !== 'OPEN') return null;
  const ticketStatus = htmlInputValue(html, 'netTicketStatus');
  if (ticketStatus && String(ticketStatus).toUpperCase() !== 'ONLINE') return null;

  let waitGroups = integerInRange(htmlInputValue(html, 'waitGroupTable'), -1, 200);
  const fallbackGroups = integerInRange(htmlInputValue(html, 'waitGroup'), -1, 200);
  if (waitGroups !== null && waitGroups < 0 && fallbackGroups !== null && fallbackGroups >= 0) {
    waitGroups = fallbackGroups;
  }

  return normalizeSushiroWait({
    waitMinutes: htmlInputValue(html, 'waitTimeTable'),
    waitGroups,
    waitTimeCap: htmlInputValue(html, 'waitTimeCap'),
    waitShowType: htmlInputValue(html, 'waitShowType'),
  });
}'''

text = replace_once(
    text,
    '\nfunction actualWaitResult(store, business, wait, detail) {',
    '\n' + sushiro_parsers + '\n\nfunction actualWaitResult(store, business, wait, detail) {',
    'Sushiro parser insertion',
)

actual_wait_result = r'''function actualWaitResult(store, business, wait, detail) {
  const normalized = waitFromNumbers(wait);
  if (!normalized) throw new Error('Invalid wait data');

  const waitMinutes = normalized.waitMinutes;
  const waitGroups = normalized.waitGroups;
  const waitMinutesAtLeast = Boolean(wait.waitMinutesAtLeast && waitMinutes !== null);
  const level = waitMinutes !== null
    ? levelFromMinutes(waitMinutes)
    : waitGroups <= 2 ? 'low' : waitGroups <= 6 ? 'medium' : 'high';

  let label = '待ち時間を取得できません';
  if (waitMinutes === 0 && waitGroups === 0) {
    label = '待ちなし';
  } else if (waitMinutesAtLeast) {
    label = waitGroups !== null && waitGroups > 0
      ? `${waitGroups}組・${waitMinutes}分以上`
      : `${waitMinutes}分以上`;
  } else if (waitMinutes !== null && waitGroups !== null) {
    if (waitGroups === 0) label = waitMinutes === 0 ? '待ちなし' : `約${waitMinutes}分待ち`;
    else if (waitMinutes === 0) label = `${waitGroups}組待ち`;
    else label = `${waitGroups}組・約${waitMinutes}分待ち`;
  } else if (waitMinutes !== null) {
    label = waitMinutes === 0 ? '待ちなし' : `約${waitMinutes}分待ち`;
  } else if (waitGroups !== null) {
    label = waitGroups === 0 ? '待ちなし' : `${waitGroups}組待ち`;
  }

  return withBusiness({
    chain:store.chain, storeName:store.name, method:'actual_wait',
    level, waitMinutes, waitGroups, waitMinutesAtLeast,
    ...(wait.sourceSeat ? { sourceSeat:wait.sourceSeat } : {}),
    ...(wait.waitShowType !== undefined ? { waitShowType:wait.waitShowType } : {}),
    label, detail, reservationUrl:store.reservationUrl, status:'ok',
  }, business);
}'''

text = replace_block(
    text,
    'function actualWaitResult(',
    'async function fetchFirstPages(',
    actual_wait_result,
    'actualWaitResult replacement',
)

get_sushiro_or_hama = r'''async function getSushiroOrHama(store) {
  const business = businessStatus(store);
  if (business.state !== 'open') return outsideHours(store, business);

  if (store.chain === 'sushiro' && store.crowdApiUrl) {
    try {
      const payload = await fetchJson(store.crowdApiUrl);
      const wait = parseSushiroStoreData(payload, store.crowdStoreId);
      if (wait) {
        return actualWaitResult(
          store,
          business,
          wait,
          'スシロー公式受付システムの公開店舗データから取得（来店予約・テーブル席）'
        );
      }
    } catch {}
  }

  const pages = await fetchFirstPages(store.statusUrls);
  for (const page of pages) {
    const sushiroWait = store.chain === 'sushiro'
      ? parseSushiroWaitPage(page.html, store.crowdStoreId)
      : null;
    const wait = sushiroWait || parsePublicWait(page.text) || parseEmbeddedWait(page.html);
    if (wait) {
      const detail = sushiroWait
        ? 'スシロー公式受付ページの公開表示値から取得（来店予約・テーブル席）'
        : '公式受付・予約ページの公開表示から取得';
      return actualWaitResult(store, business, wait, detail);
    }
  }

  const detail = store.chain === 'sushiro'
    ? '公式受付システムから現在待ちを取得できませんでした。推測値は表示せず、公式予約画面へのリンクだけを表示します。'
    : '順番待ち・時間指定予約がログイン後の機能中心で、公開ページから現在待ちを安定取得できる値は確認できていません。';
  return withBusiness({
    chain:store.chain, storeName:store.name, method:'official_link', level:'unknown',
    label:'公式予約で確認', detail, reservationUrl:store.reservationUrl, status:'link_only',
  }, business);
}'''

text = replace_block(
    text,
    'async function getSushiroOrHama(',
    'async function getKura(',
    get_sushiro_or_hama,
    'getSushiroOrHama replacement',
)

self_test_marker = "  assert.deepEqual(parseEmbeddedWait('<script>window.state={\"waitingMinutes\":18}</script>'), { waitMinutes:18, waitGroups:null });\n"
self_test_addition = r'''  const sushiroApiWait = parseSushiroStoreData([{
    id:179, storeStatus:'OPEN', netTicketStatus:'ONLINE', wait:12, waitTimeCap:180,
    waitShowType:2, waitingGroup:3, waitingGroupTable:3,
  }], 179);
  assert.deepEqual(sushiroApiWait, {
    waitMinutes:12, waitGroups:3, waitMinutesAtLeast:false, waitShowType:2, sourceSeat:'table',
  });

  const sushiroHtmlWait = parseSushiroWaitPage(`
    <input id="storeId" value="179">
    <input id="storeStatus" value="OPEN">
    <input id="netTicketStatus" value="ONLINE">
    <input id="waitTimeTable" value="0">
    <input id="waitTimeCap" value="180">
    <input id="waitShowType" value="2">
    <input id="waitGroup" value="0">
    <input id="waitGroupTable" value="0">
  `, 179);
  assert.deepEqual(sushiroHtmlWait, {
    waitMinutes:0, waitGroups:0, waitMinutesAtLeast:false, waitShowType:2, sourceSeat:'table',
  });
'''

text = replace_once(
    text,
    self_test_marker,
    self_test_marker + '\n' + self_test_addition,
    'Sushiro self-test insertion',
)

path.write_text(text, encoding='utf-8')
print('Integrated Sushiro public wait collection.')
