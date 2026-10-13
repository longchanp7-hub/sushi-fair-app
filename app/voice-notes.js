/**
 * 音声メモ機能（音声対話で追加した機能のデモ）
 * - マイクで音声を録音
 * - Web Speech API で文字起こし
 * - メモを localStorage に保存
 * - フェアカードの下に表示
 */

const STORAGE_KEY = 'sushi-fair-voice-notes';

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&', '<': '<', '>': '>', "'": '&#39;', '"': '"'
  }[ch]));
}

function renderNotes(container) {
  const notes = loadNotes().slice().reverse();
  if (!notes.length) {
    container.innerHTML = '<p class="voice-notes-empty">まだメモはありません。🎤 ボタンで録音してね</p>';
    return;
  }
  container.innerHTML = notes.map((note, i) => `
    <div class="voice-note">
      <div class="voice-note-meta">
        <time>${escapeHtml(note.createdAt)}</time>
        <button type="button" class="voice-note-delete" data-index="${notes.length - 1 - i}">削除</button>
      </div>
      <p>${escapeHtml(note.text)}</p>
    </div>
  `).join('');
}

function initVoiceNotes() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Web Speech API が使えない環境です（HTTPS が必要）');
    return;
  }

  const section = document.createElement('section);
  section.className = 'voice-notes-section';
  section.innerHTML = `
    <div class="section-heading">
      <div><p class="kicker">VOICE</p><h2>音声メモ</h2></div>
      <span>録音→文字起こし→保存</span>
    </div>
    <div class="voice-notes-controls">
      <button id="voiceRecordBtn" type="button" class="voice-record-btn">🎤 録音開始</button>
      <span id="voiceStatus" class="voice-status">待機中</span>
    </div>
    <div id="voiceNotesList" class="voice-notes-list"></div>
  `;

  const main = document.querySelector('main') || document.body;
  const noteCard = main.querySelector('.note-card') || main.lastElementChild;
  main.insertBefore(section, noteCard);

  const listEl = section.querySelector('#voiceNotesList);
  const btn = section.querySelector('#voiceRecordBtn);
  const statusEl = section.querySelector('#voiceStatus);
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let recording = false;

  btn.addEventListener('click', () => {
    if (recording) {
      recognition.stop();
      return;
    }
    recording = true;
    btn.textContent = '■ 録音停止';
    btn.classList.add('recording');
    statusEl.textContent = '聞いてます…';
    recognition.start();
  });

  recognition.addEventListener('result', event => {
    const text = event.results[0][0].transcript;
    const notes = loadNotes();
    notes.push({ text, createdAt: new Date().toLocaleString('ja-JP') });
    saveNotes(notes);
    renderNotes(listEl);
    statusEl.textContent = `保存: ${text}`;
  });

  recognition.addEventListener('error', event => {
    statusEl.textContent = `エラー: ${event.error}`;
    recording = false;
    btn.textContent = '🎤 録音開始';
    btn.classList.remove('recording');
  });

  recognition.addEventListener('end', () => {
    recording = false;
    btn.textContent = '🎤 録音開始';
    btn.classList.remove('recording');
    if (statusEl.textContent.startsWith('聞いてます')) {
      statusEl.textContent = '待機中';
    }
  });

  listEl.addEventListener('click', event => {
    const del = event.target.closest('.voice-note-delete);
    if (!del) return;
    const idx = Number(del.dataset.index);
    const notes = loadNotes();
    notes.splice(idx, 1);
    saveNotes(notes);
    renderNotes(listEl);
  });

  renderNotes(listEl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVoiceNotes);
} else {
  initVoiceNotes();
}
