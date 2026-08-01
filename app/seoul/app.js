import { TRIP } from './trip-data.js';

const STORAGE = {
  done: 'seoulTrip.done.v1',
  shopping: 'seoulTrip.shopping.v1',
  shoppingDone: 'seoulTrip.shoppingDone.v1',
  packingDone: 'seoulTrip.packingDone.v1',
  airportDone: 'seoulTrip.airportDone.v1',
  flight: 'seoulTrip.flight.v1',
  selectedDay: 'seoulTrip.selectedDay.v1',
  aiPrepared: 'seoulTrip.aiPrepared.v1',
};

const typeIcons = {
  hotel: '🏨', food: '🍽️', shopping: '🛍️', sightseeing: '🌆',
  appointment: '💆‍♀️', break: '🥤', transport: '🚆', airport: '✈️',
};

const pinColors = {
  'ホテル': '#d54f7e', '食事・買い物': '#d54f7e', 'カフェ・買い物': '#3d9365',
  '公園': '#4d9a63', '市場': '#3a8eb6', '食事': '#d98224',
  '美容・荷物': '#c6578d', '買い物': '#3375b3', '観光': '#7257b0', '空港': '#2f91a3',
};

const helpActionLabels = {
  hotelMap: 'ホテルの地図',
  call1330: '1330へ電話',
  today: '今日の予定',
  airportMode: '空港画面',
  airportMap: '空港の地図',
  call119: '119へ電話',
  call112: '112へ電話',
  callEmbassy: '日本大使館へ電話',
  showHotel: 'ホテルを見せる',
  shopping: '買い物リスト',
};

const airportChecklistItems = [
  { id: 'terminal', text: '便名・ターミナルを確認' },
  { id: 'passport', text: 'パスポート' },
  { id: 'eticket', text: '搭乗券・Eチケット' },
  { id: 'luggage', text: '預け荷物・手荷物を確認' },
  { id: 'liquids', text: '液体・刃物を預け荷物へ' },
  { id: 'battery', text: 'モバイルバッテリーは手荷物へ' },
  { id: 'refund', text: '免税・税金還付があれば早めに' },
  { id: 'gate', text: '保安検査後、搭乗口を確認' },
];

const state = {
  done: loadJson(STORAGE.done, {}),
  customShopping: loadJson(STORAGE.shopping, []),
  shoppingDone: loadJson(STORAGE.shoppingDone, {}),
  packingDone: loadJson(STORAGE.packingDone, {}),
  airportDone: loadJson(STORAGE.airportDone, {}),
  flight: { ...TRIP.flight, ...loadJson(STORAGE.flight, {}) },
  selectedDayId: localStorage.getItem(STORAGE.selectedDay) || chooseDefaultDay(),
  placeFilter: 'すべて',
  aiWorker: null,
  aiReady: false,
  aiLoading: false,
  pendingAiRequest: null,
};

const els = {
  views: [...document.querySelectorAll('.view')],
  navButtons: [...document.querySelectorAll('.nav-button')],
  dayTabs: document.querySelector('#dayTabs'),
  selectedDate: document.querySelector('#selectedDate'),
  selectedTheme: document.querySelector('#selectedTheme'),
  dayProgress: document.querySelector('#dayProgress'),
  timeline: document.querySelector('#timeline'),
  tripStatus: document.querySelector('#tripStatus'),
  nextAction: document.querySelector('#nextAction'),
  tripCountdown: document.querySelector('#tripCountdown'),
  globalWarning: document.querySelector('#globalWarning'),
  mapPins: document.querySelector('#mapPins'),
  placeFilters: document.querySelector('#placeFilters'),
  placeList: document.querySelector('#placeList'),
  shoppingList: document.querySelector('#shoppingList'),
  packingList: document.querySelector('#packingList'),
  addShoppingForm: document.querySelector('#addShoppingForm'),
  shoppingInput: document.querySelector('#shoppingInput'),
  quickHelp: document.querySelector('#quickHelp'),
  helpInput: document.querySelector('#helpInput'),
  askHelp: document.querySelector('#askHelp'),
  helpResult: document.querySelector('#helpResult'),
  prepareAi: document.querySelector('#prepareAi'),
  aiStatus: document.querySelector('#aiStatus'),
  aiProgress: document.querySelector('#aiProgress'),
  contactList: document.querySelector('#contactList'),
  airportCountdown: document.querySelector('#airportCountdown'),
  airportTargetText: document.querySelector('#airportTargetText'),
  airportRisk: document.querySelector('#airportRisk'),
  flightDeparture: document.querySelector('#flightDeparture'),
  flightNumber: document.querySelector('#flightNumber'),
  flightTerminal: document.querySelector('#flightTerminal'),
  flightArrivalTarget: document.querySelector('#flightArrivalTarget'),
  hongdaeLeaveTarget: document.querySelector('#hongdaeLeaveTarget'),
  airportChecklist: document.querySelector('#airportChecklist'),
  infoDialog: document.querySelector('#infoDialog'),
  showCardDialog: document.querySelector('#showCardDialog'),
  showCardTitle: document.querySelector('#showCardTitle'),
  showCardKo: document.querySelector('#showCardKo'),
  showCardJa: document.querySelector('#showCardJa'),
  flightDialog: document.querySelector('#flightDialog'),
  flightForm: document.querySelector('#flightForm'),
  flightNumberInput: document.querySelector('#flightNumberInput'),
  flightTerminalInput: document.querySelector('#flightTerminalInput'),
  timelineTemplate: document.querySelector('#timelineItemTemplate'),
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function seoulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TRIP.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function chooseDefaultDay() {
  const today = seoulDateKey();
  const match = TRIP.days.find(day => day.date === today);
  if (match) return match.id;
  if (today > TRIP.dates.end) return TRIP.days.at(-1).id;
  return TRIP.days[0].id;
}

function formatDate(dateLike, options = {}) {
  const date = dateLike instanceof Date ? dateLike : new Date(`${dateLike}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TRIP.timeZone,
    month: 'numeric', day: 'numeric', weekday: 'short',
    ...options,
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TRIP.timeZone,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function daysBetween(a, b) {
  const one = new Date(`${a}T00:00:00+09:00`);
  const two = new Date(`${b}T00:00:00+09:00`);
  return Math.round((two - one) / 86400000);
}

function navigate(viewName) {
  els.views.forEach(view => view.classList.toggle('active', view.dataset.view === viewName));
  els.navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.target === viewName));
  document.querySelector('#main').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTripHeader() {
  const today = seoulDateKey();
  const until = daysBetween(today, TRIP.dates.start);
  const after = daysBetween(TRIP.dates.end, today);

  if (until > 0) {
    els.tripStatus.textContent = `旅行まであと${until}日`;
    els.tripCountdown.textContent = `あと\n${until}日`;
  } else if (today >= TRIP.dates.start && today <= TRIP.dates.end) {
    const dayIndex = TRIP.days.findIndex(day => day.date === today);
    els.tripStatus.textContent = `${dayIndex + 1}日目・ソウル時間`;
    els.tripCountdown.textContent = formatTime(new Date());
  } else {
    els.tripStatus.textContent = `旅行終了から${Math.max(0, after)}日`;
    els.tripCountdown.textContent = '旅の\n記録';
  }

  const selected = TRIP.days.find(day => day.id === state.selectedDayId) || TRIP.days[0];
  const firstUndone = selected.items.find(item => !state.done[item.id]);
  els.nextAction.textContent = firstUndone ? firstUndone.title : 'この日の予定は完了です';

  const day3 = TRIP.days.find(day => day.id === 'day3');
  if (selected.id === 'day3' && day3.warning) {
    els.globalWarning.textContent = day3.warning;
    els.globalWarning.classList.remove('hidden');
  } else {
    els.globalWarning.classList.add('hidden');
  }
}

function renderDayTabs() {
  els.dayTabs.replaceChildren();
  TRIP.days.forEach(day => {
    const button = document.createElement('button');
    button.className = 'day-tab';
    button.type = 'button';
    button.role = 'tab';
    button.dataset.dayId = day.id;
    button.setAttribute('aria-selected', String(day.id === state.selectedDayId));

    const strong = document.createElement('strong');
    strong.textContent = day.label;
    const small = document.createElement('small');
    small.textContent = formatDate(day.date);
    button.append(strong, small);
    els.dayTabs.append(button);
  });
}

function renderTimeline() {
  const day = TRIP.days.find(item => item.id === state.selectedDayId) || TRIP.days[0];
  els.selectedDate.textContent = `${day.label}・${formatDate(day.date, { year: 'numeric' })}`;
  els.selectedTheme.textContent = day.theme;
  const completeCount = day.items.filter(item => state.done[item.id]).length;
  els.dayProgress.textContent = `${completeCount}/${day.items.length} 完了`;
  els.timeline.replaceChildren();

  day.items.forEach(item => {
    const fragment = els.timelineTemplate.content.cloneNode(true);
    const article = fragment.querySelector('.timeline-item');
    const doneButton = fragment.querySelector('.done-button');
    const timeLabel = fragment.querySelector('.time-label');
    const fixedLabel = fragment.querySelector('.fixed-label');
    const title = fragment.querySelector('h3');
    const note = fragment.querySelector('.timeline-note');
    const actions = fragment.querySelector('.timeline-actions');

    article.dataset.itemId = item.id;
    article.classList.toggle('completed', Boolean(state.done[item.id]));
    doneButton.setAttribute('aria-label', state.done[item.id] ? `${item.title}を未完了に戻す` : `${item.title}を完了にする`);
    doneButton.dataset.toggleDone = item.id;
    timeLabel.textContent = `${typeIcons[item.type] || '•'} ${item.time}`;
    fixedLabel.classList.toggle('hidden', !item.fixed);
    title.textContent = item.title;
    note.textContent = item.note;

    if (item.placeId) {
      const mapButton = document.createElement('button');
      mapButton.className = 'small-action';
      mapButton.type = 'button';
      mapButton.dataset.openMap = item.placeId;
      mapButton.textContent = '地図を開く';
      actions.append(mapButton);

      const place = getPlace(item.placeId);
      if (place?.addressKo) {
        const showButton = document.createElement('button');
        showButton.className = 'small-action';
        showButton.type = 'button';
        showButton.dataset.showCard = item.placeId;
        showButton.textContent = '画面を見せる';
        actions.append(showButton);
      }
    }
    els.timeline.append(fragment);
  });
}

function getPlace(id) {
  return TRIP.places.find(place => place.id === id);
}

function mapUrl(place) {
  const query = encodeURIComponent(place.mapQuery || place.addressKo || place.name);
  return `https://maps.apple.com/?q=${query}`;
}

function openMap(placeId) {
  const place = getPlace(placeId);
  if (!place) return;
  window.open(mapUrl(place), '_blank', 'noopener,noreferrer');
}

function showPlaceCard(placeId) {
  const place = getPlace(placeId);
  if (!place) return;
  els.showCardTitle.textContent = place.name;
  els.showCardKo.textContent = place.addressKo || place.name;
  els.showCardJa.textContent = place.addressJa || '予約票の住所を確認してください。';
  els.showCardDialog.showModal();
}

function renderMap() {
  renderMapPins();
  renderPlaceFilters();
  renderPlaceList();
}

function renderMapPins() {
  const ns = 'http://www.w3.org/2000/svg';
  els.mapPins.replaceChildren();
  TRIP.places.forEach(place => {
    const group = document.createElementNS(ns, 'g');
    group.classList.add('map-pin');
    group.dataset.mapPlace = place.id;
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', `${place.name}の地図を開く`);
    group.style.setProperty('--pin-color', pinColors[place.category] || '#d54f7e');

    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', place.x);
    circle.setAttribute('cy', place.y);
    circle.setAttribute('r', '3.2');
    const dot = document.createElementNS(ns, 'circle');
    dot.classList.add('pin-dot');
    dot.setAttribute('cx', place.x);
    dot.setAttribute('cy', place.y);
    dot.setAttribute('r', '1.2');
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(place.x + (place.x > 72 ? -1 : 4)));
    text.setAttribute('y', String(place.y - 2.5));
    text.setAttribute('text-anchor', place.x > 72 ? 'end' : 'start');
    text.textContent = place.name.replace('エリア', '').replace('ロッテマート ZETTAPLEX ソウル駅店', 'ソウル駅');
    group.append(circle, dot, text);
    els.mapPins.append(group);
  });
}

function renderPlaceFilters() {
  const areas = ['すべて', ...new Set(TRIP.places.map(place => place.area))];
  els.placeFilters.replaceChildren();
  areas.forEach(area => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${area === state.placeFilter ? ' active' : ''}`;
    button.dataset.placeFilter = area;
    button.textContent = area;
    els.placeFilters.append(button);
  });
}

function renderPlaceList() {
  const places = state.placeFilter === 'すべて'
    ? TRIP.places
    : TRIP.places.filter(place => place.area === state.placeFilter);

  els.placeList.replaceChildren();
  places.forEach(place => {
    const card = document.createElement('article');
    card.className = 'place-card';
    const body = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'place-badge';
    badge.textContent = `${place.area}・${place.category}`;
    const title = document.createElement('h3');
    title.textContent = place.name;
    const address = document.createElement('p');
    address.textContent = place.addressJa;
    body.append(badge, title, address);

    const actions = document.createElement('div');
    actions.className = 'place-actions';
    const mapButton = document.createElement('button');
    mapButton.className = 'small-action';
    mapButton.type = 'button';
    mapButton.dataset.openMap = place.id;
    mapButton.textContent = '地図を開く';
    actions.append(mapButton);
    if (place.addressKo) {
      const showButton = document.createElement('button');
      showButton.className = 'small-action';
      showButton.type = 'button';
      showButton.dataset.showCard = place.id;
      showButton.textContent = '見せる';
      actions.append(showButton);
    }
    card.append(body, actions);
    els.placeList.append(card);
  });
}

function createCheckRow(item, checked, kind, custom = false) {
  const row = document.createElement('div');
  row.className = `check-row${checked ? ' checked' : ''}`;
  row.dataset.checkKind = kind;
  row.dataset.checkId = item.id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'check-toggle';
  button.dataset.toggleCheck = item.id;
  button.dataset.kind = kind;
  button.setAttribute('aria-label', checked ? `${item.text}のチェックを外す` : `${item.text}をチェックする`);

  const text = document.createElement('span');
  text.className = 'check-text';
  text.textContent = item.text;

  const end = document.createElement(custom ? 'button' : 'span');
  if (custom) {
    end.type = 'button';
    end.className = 'delete-item';
    end.dataset.deleteShopping = item.id;
    end.setAttribute('aria-label', `${item.text}を削除`);
    end.textContent = '×';
  } else {
    end.className = 'group-label';
    end.textContent = item.group || '';
  }

  row.append(button, text, end);
  return row;
}

function renderShopping() {
  els.shoppingList.replaceChildren();
  TRIP.shopping.forEach(item => {
    els.shoppingList.append(createCheckRow(item, Boolean(state.shoppingDone[item.id]), 'shopping'));
  });
  state.customShopping.forEach(item => {
    els.shoppingList.append(createCheckRow(item, Boolean(state.shoppingDone[item.id]), 'shopping', true));
  });

  els.packingList.replaceChildren();
  TRIP.packing.forEach(item => {
    els.packingList.append(createCheckRow(item, Boolean(state.packingDone[item.id]), 'packing'));
  });
}

function renderQuickHelp() {
  els.quickHelp.replaceChildren();
  TRIP.helpIntents.forEach(intent => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-help-button';
    button.dataset.helpIntent = intent.id;
    const icon = document.createElement('span');
    icon.textContent = intent.emoji;
    const label = document.createTextNode(intent.label);
    button.append(icon, label);
    els.quickHelp.append(button);
  });
}

function renderContacts() {
  els.contactList.replaceChildren();
  TRIP.contacts.forEach(contact => {
    const row = document.createElement('div');
    row.className = 'contact-row';
    const body = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${contact.name} ${contact.number}`;
    const small = document.createElement('small');
    small.textContent = contact.note;
    body.append(strong, small);
    const link = document.createElement('a');
    link.className = 'call-button';
    link.href = `tel:${contact.number}`;
    link.textContent = '電話';
    row.append(body, link);
    els.contactList.append(row);
  });
}

function renderHelpResult(intentId, confidence = null, source = '基本判定') {
  const intent = TRIP.helpIntents.find(item => item.id === intentId) || TRIP.helpIntents[0];
  const result = els.helpResult;
  result.replaceChildren();

  const label = document.createElement('span');
  label.className = 'result-label';
  const confidenceText = typeof confidence === 'number' ? `・一致度 ${Math.round(confidence * 100)}%` : '';
  label.textContent = `${source}${confidenceText}`;
  const title = document.createElement('h3');
  title.textContent = `${intent.emoji} ${intent.answer.title}`;
  const list = document.createElement('ol');
  intent.answer.steps.forEach(step => {
    const li = document.createElement('li');
    li.textContent = step;
    list.append(li);
  });
  result.append(label, title, list);

  if (intent.answer.actions.length) {
    const actions = document.createElement('div');
    actions.className = 'button-row';
    intent.answer.actions.forEach(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.startsWith('call') ? 'primary-button' : 'secondary-button';
      button.dataset.action = action;
      button.textContent = helpActionLabels[action] || action;
      actions.append(button);
    });
    result.append(actions);
  }
  result.classList.remove('hidden');
  result.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function keywordClassify(text) {
  const normalized = text.toLowerCase();
  const keywords = {
    lost: ['迷', '場所', '出口', '道', 'どこ', '戻れ'],
    late: ['遅', '間に合', '予約時間', '遅刻'],
    airport: ['空港', '飛行機', '便', 'ターミナル', '搭乗'],
    payment: ['カード', '現金', '支払', '決済', 'tmoney', 't-money', '残高'],
    phone: ['スマホ', '携帯', 'wifi', 'wi-fi', 'ネット', '通信', '電池', '充電'],
    sick: ['気分', '痛', '熱', 'けが', '怪我', 'めまい', '吐', '息苦', '病気'],
    'lost-item': ['なくした', '無くした', '紛失', '忘れ物', '盗', '財布', 'パスポート'],
    toilet: ['トイレ', '便所', 'お手洗い'],
    taxi: ['タクシー', '運転手', '車'],
    food: ['アレルギー', '辛', '食べ', '料理', '注文'],
    safety: ['怖', '危険', 'つきまと', '警察', '助けて'],
    shopping: ['買い物', '買う', 'お土産', 'リスト'],
  };

  let best = { id: 'lost', score: 0 };
  Object.entries(keywords).forEach(([id, words]) => {
    const score = words.reduce((total, word) => total + (normalized.includes(word) ? 1 : 0), 0);
    if (score > best.score) best = { id, score };
  });
  return best.score ? best.id : 'lost';
}

function askForHelp() {
  const text = els.helpInput.value.trim();
  if (!text) {
    els.helpInput.focus();
    els.helpInput.setCustomValidity('困っている内容を入力してください。');
    els.helpInput.reportValidity();
    els.helpInput.setCustomValidity('');
    return;
  }

  if (state.aiReady && state.aiWorker) {
    const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    state.pendingAiRequest = requestId;
    els.askHelp.disabled = true;
    els.askHelp.textContent = '読み取っています…';
    state.aiWorker.postMessage({ type: 'classify', requestId, text });
  } else {
    renderHelpResult(keywordClassify(text), null, '基本判定');
  }
}

function prepareAi() {
  if (state.aiLoading || state.aiReady) return;
  state.aiLoading = true;
  els.prepareAi.disabled = true;
  els.prepareAi.textContent = '準備中';
  els.aiStatus.textContent = 'Wi-Fiのまま、この画面を閉じずにお待ちください';
  els.aiProgress.classList.remove('hidden');
  setAiProgress(3);

  try {
    state.aiWorker = new Worker('./ai-worker.js', { type: 'module' });
    state.aiWorker.onmessage = event => {
      const data = event.data || {};
      if (data.type === 'progress') {
        setAiProgress(data.percent || 5);
        if (data.message) els.aiStatus.textContent = data.message;
      }
      if (data.type === 'ready') {
        state.aiReady = true;
        state.aiLoading = false;
        localStorage.setItem(STORAGE.aiPrepared, 'true');
        setAiProgress(100);
        els.aiStatus.textContent = '準備できました。日本語の文章から近い困りごとを選びます';
        els.prepareAi.textContent = '準備済み';
        setTimeout(() => els.aiProgress.classList.add('hidden'), 900);
      }
      if (data.type === 'result' && data.requestId === state.pendingAiRequest) {
        els.askHelp.disabled = false;
        els.askHelp.textContent = '答えを出す';
        renderHelpResult(data.intentId, data.score, 'ことば判定');
      }
      if (data.type === 'error') {
        state.aiLoading = false;
        state.aiReady = false;
        els.prepareAi.disabled = false;
        els.prepareAi.textContent = 'もう一度準備';
        els.aiStatus.textContent = '準備できませんでした。基本判定はそのまま使えます';
        els.aiProgress.classList.add('hidden');
        if (state.pendingAiRequest) {
          els.askHelp.disabled = false;
          els.askHelp.textContent = '答えを出す';
          renderHelpResult(keywordClassify(els.helpInput.value), null, '基本判定');
        }
      }
    };
    state.aiWorker.onerror = () => {
      state.aiWorker?.terminate();
      state.aiWorker = null;
      state.aiLoading = false;
      els.prepareAi.disabled = false;
      els.prepareAi.textContent = 'もう一度準備';
      els.aiStatus.textContent = '通信を確認してください。基本判定は使えます';
      els.aiProgress.classList.add('hidden');
    };
    state.aiWorker.postMessage({
      type: 'init',
      intents: TRIP.helpIntents.map(({ id, examples }) => ({ id, examples })),
    });
  } catch {
    state.aiLoading = false;
    els.prepareAi.disabled = false;
    els.prepareAi.textContent = 'もう一度準備';
    els.aiStatus.textContent = 'この環境では準備できません。基本判定は使えます';
  }
}

function setAiProgress(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  els.aiProgress.querySelector('span').style.width = `${value}%`;
}

function renderFlight() {
  const departure = new Date(state.flight.departure);
  const arrivalTarget = new Date(departure.getTime() - state.flight.arrivalTargetMinutes * 60000);
  const leaveTarget = new Date(arrivalTarget.getTime() - state.flight.travelBufferMinutes * 60000);

  els.flightDeparture.textContent = `${formatDate('2026-08-30', { year: 'numeric' })} ${formatTime(departure)}`;
  els.flightNumber.textContent = state.flight.flightNumber || '未登録';
  els.flightTerminal.textContent = state.flight.terminal || '未登録';
  els.flightArrivalTarget.textContent = formatTime(arrivalTarget);
  els.hongdaeLeaveTarget.textContent = formatTime(leaveTarget);
  els.airportTargetText.textContent = `空港到着目標 ${formatTime(arrivalTarget)}・出発 ${formatTime(departure)}`;
  els.airportRisk.textContent = `重要：10:00から約3時間の眉アートでは、${formatTime(arrivalTarget)}の空港到着目標と両立しません。施術の終了時刻を早めるか、予約先・航空券を必ず再確認してください。予定は自動で変更しません。`;

  updateAirportCountdown();
}

function updateAirportCountdown() {
  const departure = new Date(state.flight.departure);
  const target = new Date(departure.getTime() - state.flight.arrivalTargetMinutes * 60000);
  const diff = target - Date.now();
  if (diff <= 0) {
    els.airportCountdown.textContent = '目標時刻を過ぎています';
    return;
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  els.airportCountdown.textContent = days > 0 ? `${days}日 ${hours}時間` : `${hours}時間 ${minutes}分`;
}

function renderAirportChecklist() {
  els.airportChecklist.replaceChildren();
  airportChecklistItems.forEach(item => {
    els.airportChecklist.append(createCheckRow(item, Boolean(state.airportDone[item.id]), 'airport'));
  });
}

function executeAction(action) {
  const phoneMap = {
    call1330: '1330', call119: '119', call112: '112', callEmbassy: '02-739-7400',
  };
  if (phoneMap[action]) {
    window.location.href = `tel:${phoneMap[action]}`;
    return;
  }
  if (action === 'hotelMap') openMap('hotel');
  if (action === 'airportMap') openMap('incheon');
  if (action === 'showHotel') showPlaceCard('hotel');
  if (action === 'today') navigate('today');
  if (action === 'shopping') navigate('shopping');
  if (action === 'airportMode') navigate('airport');
}

function bindEvents() {
  els.navButtons.forEach(button => button.addEventListener('click', () => navigate(button.dataset.target)));

  els.dayTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-day-id]');
    if (!button) return;
    state.selectedDayId = button.dataset.dayId;
    localStorage.setItem(STORAGE.selectedDay, state.selectedDayId);
    renderDayTabs();
    renderTimeline();
    renderTripHeader();
  });

  els.timeline.addEventListener('click', event => {
    const done = event.target.closest('[data-toggle-done]');
    if (done) {
      const id = done.dataset.toggleDone;
      state.done[id] = !state.done[id];
      saveJson(STORAGE.done, state.done);
      renderTimeline();
      renderTripHeader();
      return;
    }
    const map = event.target.closest('[data-open-map]');
    if (map) openMap(map.dataset.openMap);
    const show = event.target.closest('[data-show-card]');
    if (show) showPlaceCard(show.dataset.showCard);
  });

  els.placeFilters.addEventListener('click', event => {
    const button = event.target.closest('[data-place-filter]');
    if (!button) return;
    state.placeFilter = button.dataset.placeFilter;
    renderPlaceFilters();
    renderPlaceList();
  });

  els.placeList.addEventListener('click', event => {
    const map = event.target.closest('[data-open-map]');
    if (map) openMap(map.dataset.openMap);
    const show = event.target.closest('[data-show-card]');
    if (show) showPlaceCard(show.dataset.showCard);
  });

  document.querySelector('#schematicMap').addEventListener('click', event => {
    const pin = event.target.closest('[data-map-place]');
    if (pin) openMap(pin.dataset.mapPlace);
  });
  document.querySelector('#schematicMap').addEventListener('keydown', event => {
    const pin = event.target.closest('[data-map-place]');
    if (pin && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openMap(pin.dataset.mapPlace);
    }
  });

  els.addShoppingForm.addEventListener('submit', event => {
    event.preventDefault();
    const text = els.shoppingInput.value.trim();
    if (!text) return;
    state.customShopping.push({ id: `custom-${Date.now()}`, text, group: '追加' });
    saveJson(STORAGE.shopping, state.customShopping);
    els.shoppingInput.value = '';
    renderShopping();
  });

  [els.shoppingList, els.packingList, els.airportChecklist].forEach(container => {
    container.addEventListener('click', event => {
      const toggle = event.target.closest('[data-toggle-check]');
      if (toggle) {
        const id = toggle.dataset.toggleCheck;
        const kind = toggle.dataset.kind;
        const map = kind === 'shopping' ? state.shoppingDone : kind === 'packing' ? state.packingDone : state.airportDone;
        map[id] = !map[id];
        saveJson(kind === 'shopping' ? STORAGE.shoppingDone : kind === 'packing' ? STORAGE.packingDone : STORAGE.airportDone, map);
        if (kind === 'airport') renderAirportChecklist(); else renderShopping();
      }
      const remove = event.target.closest('[data-delete-shopping]');
      if (remove) {
        const id = remove.dataset.deleteShopping;
        state.customShopping = state.customShopping.filter(item => item.id !== id);
        delete state.shoppingDone[id];
        saveJson(STORAGE.shopping, state.customShopping);
        saveJson(STORAGE.shoppingDone, state.shoppingDone);
        renderShopping();
      }
    });
  });

  els.quickHelp.addEventListener('click', event => {
    const button = event.target.closest('[data-help-intent]');
    if (button) renderHelpResult(button.dataset.helpIntent, null, '選んだ内容');
  });
  els.askHelp.addEventListener('click', askForHelp);
  els.helpInput.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') askForHelp();
  });
  els.prepareAi.addEventListener('click', prepareAi);

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action) executeAction(action.dataset.action);
    const map = event.target.closest('[data-open-map]');
    if (map && !map.closest('#timeline') && !map.closest('#placeList')) openMap(map.dataset.openMap);
  });

  document.querySelector('#openInfo').addEventListener('click', () => els.infoDialog.showModal());
  document.querySelector('#editFlight').addEventListener('click', () => {
    els.flightNumberInput.value = state.flight.flightNumber === '未登録' ? '' : state.flight.flightNumber;
    els.flightTerminalInput.value = state.flight.terminal || '未登録';
    els.flightDialog.showModal();
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => document.querySelector(`#${button.dataset.closeDialog}`).close());
  });
  els.flightForm.addEventListener('submit', event => {
    event.preventDefault();
    state.flight.flightNumber = els.flightNumberInput.value.trim() || '未登録';
    state.flight.terminal = els.flightTerminalInput.value || '未登録';
    saveJson(STORAGE.flight, {
      flightNumber: state.flight.flightNumber,
      terminal: state.flight.terminal,
    });
    els.flightDialog.close();
    renderFlight();
  });
}

function initializeAiStatus() {
  const preparedBefore = localStorage.getItem(STORAGE.aiPrepared) === 'true';
  if (preparedBefore) {
    els.aiStatus.textContent = 'このiPhoneでは準備済みです。必要なときに読み込みます';
    els.prepareAi.textContent = '読み込む';
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function init() {
  renderTripHeader();
  renderDayTabs();
  renderTimeline();
  renderMap();
  renderShopping();
  renderQuickHelp();
  renderContacts();
  renderFlight();
  renderAirportChecklist();
  initializeAiStatus();
  bindEvents();
  registerServiceWorker();
  setInterval(() => {
    renderTripHeader();
    updateAirportCountdown();
  }, 60000);
}

init();
