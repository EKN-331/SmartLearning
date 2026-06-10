/**
 * Smart Learning SD/MI — Main Application
 * Version: 2.0.0 · Cloud Sync Edition
 * GitHub Pages + Google Sheets (Apps Script API)
 * ============================================================
 */

'use strict';

// ============================================================
// CLOUD CONFIG
// ============================================================
const CLOUD_API     = 'https://script.google.com/macros/s/AKfycbyp6h8Cw6Ict12Qa6aqP9lD9-Gku86Py1RYsSaZa2KiE9ZpRhg4QGBy1s8p0wBrk27T/exec';
const CLOUD_ENABLED = true;   // false = mode lokal saja

// ============================================================
// STORAGE UTILITIES  (localStorage — cache offline)
// ============================================================
const Storage = {
  get(key, def = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  remove(key) { localStorage.removeItem(key); }
};

// ============================================================
// AUDIO ENGINE
// ============================================================
const Audio = {
  ctx: null,
  isPlaying: false,

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { console.log('[Audio] Not supported'); }
  },

  playTone(freq, dur, type = 'sine', vol = 0.3) {
    if (!App.settings.sound || !this.ctx) return;
    try {
      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.start(); osc.stop(this.ctx.currentTime + dur);
    } catch(e) {}
  },

  click()   { this.playTone(800, 0.05, 'square', 0.2); },
  correct() {
    this.playTone(523, 0.1);
    setTimeout(() => this.playTone(659, 0.1), 100);
    setTimeout(() => this.playTone(784, 0.2), 200);
  },
  wrong() {
    this.playTone(300, 0.15, 'sawtooth', 0.2);
    setTimeout(() => this.playTone(200, 0.2,  'sawtooth', 0.2), 150);
  },
  complete() {
    [523, 587, 659, 698, 784, 880].forEach((f, i) =>
      setTimeout(() => this.playTone(f, 0.15), i * 80)
    );
  },
  startMusic() { this.isPlaying = true; },
  stopMusic()  { this.isPlaying = false; }
};

// ============================================================
// MAIN APP OBJECT
// ============================================================
const App = {

  // ── State ──────────────────────────────────────────────────
  currentScreen: 'homeScreen',
  currentExam:   null,
  currentQuestion: 0,
  answers:       {},
  timer:         null,
  timerSeconds:  0,
  examStartTime: null,
  pinTarget:     null,
  pinBuffer:     '',
  examMode:      'exam',
  currentFilterSubject: 'all',

  // ── Offline sync queue ─────────────────────────────────────
  _syncQueue:  [],
  _isSyncing:  false,

  // ── Settings ───────────────────────────────────────────────
  settings: {
    darkMode:       false,
    sound:          true,
    music:          false,
    shuffle:        true,
    shuffleAnswers: true,
    pin:            '123456',
    resultMode:     'direct'
  },

  // ============================================================
  // CLOUD SYNC LAYER
  // ============================================================

  /**
   * Fire-and-forget POST ke Apps Script.
   * - Jika offline  → masuk antrian, dikirim saat online lagi.
   * - imageData besar TIDAK dikirim ke cloud (hanya disimpan lokal).
   */
  /**
   * ─────────────────────────────────────────────────────────────
   * CLOUD SAVE  —  kirim data ke Google Apps Script
   *
   * Solusi CORS:
   *  • POST dengan Content-Type: text/plain  → tidak trigger preflight
   *  • Apps Script membaca dari e.postData.contents
   *  • mode: 'no-cors' dipakai sebagai FALLBACK terakhir (response opaque)
   * ─────────────────────────────────────────────────────────────
   */
  async cloudSave(action, payload) {
    if (!CLOUD_ENABLED) return;

    if (!navigator.onLine) {
      this._enqueue(action, payload);
      return;
    }

    const ok = await this._postToCloud(action, payload);
    if (!ok) this._enqueue(action, payload);
  },

  _enqueue(action, payload) {
    this._syncQueue.push({ action, payload });
    Storage.set('sl_syncQueue', this._syncQueue);
    console.log('[Cloud] Queued (offline/error):', action);
  },

  /**
   * Kirim satu request POST ke Apps Script.
   * Strategi:
   *   1. text/plain POST  → bisa dapat response JSON
   *   2. Jika gagal, coba via URL params GET (fallback sederhana)
   */
  async _postToCloud(action, payload) {
    const body = JSON.stringify({ action, ...payload });

    // ── Strategi 1: POST text/plain (tidak trigger CORS preflight) ──
    try {
      const res  = await fetch(CLOUD_API, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow'
      });
      // Apps Script selalu redirect ke script.googleusercontent.com
      // Response tetap bisa dibaca setelah follow redirect
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json.ok !== false) {
          console.log('[Cloud] ✓ Saved:', action, json.data || '');
          return true;
        }
        console.warn('[Cloud] Server error:', json.error);
        return false;
      } catch {
        // response bukan JSON tapi request sampai → anggap OK
        if (res.ok || res.status === 0) {
          console.log('[Cloud] ✓ Saved (non-JSON response):', action);
          return true;
        }
        return false;
      }
    } catch(e) {
      console.warn('[Cloud] POST failed:', e.message, '— trying GET fallback');
    }

    // ── Strategi 2: GET dengan payload di query string (fallback) ──
    try {
      // Encode payload sebagai query param — Apps Script baca via e.parameter
      const params = new URLSearchParams({ action, data: body });
      const res    = await fetch(`${CLOUD_API}?${params.toString()}`, { redirect: 'follow' });
      const text   = await res.text();
      const json   = JSON.parse(text);
      if (json.ok !== false) {
        console.log('[Cloud] ✓ Saved via GET fallback:', action);
        return true;
      }
    } catch(e2) {
      console.warn('[Cloud] GET fallback also failed:', e2.message);
    }

    return false;
  },

  /** Kirim ulang antrian saat kembali online */
  async _flushSyncQueue() {
    if (this._isSyncing || this._syncQueue.length === 0) return;
    this._isSyncing    = true;
    const failed       = [];
    const total        = this._syncQueue.length;

    console.log(`[Cloud] Flushing queue: ${total} item(s)`);

    for (const item of this._syncQueue) {
      const ok = await this._postToCloud(item.action, item.payload);
      if (!ok) failed.push(item);
    }

    this._syncQueue = failed;
    Storage.set('sl_syncQueue', failed);
    this._isSyncing = false;

    if (failed.length === 0) {
      console.log('[Cloud] ✓ Queue flushed completely');
      this.showToast('☁️ Data offline berhasil disinkronkan ke cloud!', 'success', 2500);
    } else {
      console.warn(`[Cloud] Queue still has ${failed.length} failed item(s)`);
    }
  },

  /** Ambil SEMUA data dari cloud saat startup */
  async _fetchCloudData() {
    if (!CLOUD_ENABLED || !navigator.onLine) return false;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await fetch(`${CLOUD_API}?action=getAll`, {
        signal:   ctrl.signal,
        redirect: 'follow'
      });
      clearTimeout(tid);

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { console.warn('[Cloud] getAll — non-JSON response'); return false; }

      if (!json.ok || !json.data) {
        console.warn('[Cloud] getAll failed:', json.error || 'no data');
        return false;
      }

      const { subjects, questions, history, settings } = json.data;

      if (Array.isArray(subjects)  && subjects.length  > 0) Storage.set('sl_subjects',  subjects);
      if (Array.isArray(questions) && questions.length > 0) Storage.set('sl_questions', questions);
      if (Array.isArray(history)   && history.length   > 0) Storage.set('sl_history',   history);

      if (settings && settings.pin) {
        this.settings.pin = String(settings.pin);
        Storage.set('sl_settings', this.settings);
      }

      console.log('[Cloud] ✓ Loaded — subjects:', subjects?.length,
                  '· questions:', questions?.length,
                  '· history:', history?.length);
      return true;
    } catch(e) {
      console.warn('[Cloud] _fetchCloudData failed:', e.name === 'AbortError' ? 'TIMEOUT' : e.message);
      return false;
    }
  },

  // ── Cloud status badge ──────────────────────────────────────
  _showCloudStatus(msg, isWarning = false) {
    let el = document.getElementById('cloudStatusBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cloudStatusBadge';
      el.style.cssText = [
        'position:fixed', 'bottom:100px', 'left:50%', 'transform:translateX(-50%)',
        'padding:8px 18px', 'border-radius:99px', 'font-size:12px', 'font-weight:700',
        'z-index:600', 'white-space:nowrap', 'transition:opacity 0.4s',
        'backdrop-filter:blur(10px)', 'box-shadow:var(--shadow)', 'color:white'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent      = msg;
    el.style.background = isWarning ? 'rgba(251,133,0,0.92)' : 'rgba(67,97,238,0.92)';
    el.style.opacity    = '1';
    el.style.display    = 'block';
  },

  _hideCloudStatus() {
    const el = document.getElementById('cloudStatusBadge');
    if (el) { el.style.opacity = '0'; setTimeout(() => { el.style.display = 'none'; }, 400); }
  },

  // ============================================================
  // INITIALIZATION
  // ============================================================
  async init() {
    document.getElementById('loadingScreen').style.display = 'flex';

    // 1. Muat settings lokal
    const savedSettings = Storage.get('sl_settings');
    if (savedSettings) this.settings = { ...this.settings, ...savedSettings };

    // 2. Muat antrian sync yang tertunda (dari sesi sebelumnya)
    const savedQueue = Storage.get('sl_syncQueue');
    if (Array.isArray(savedQueue)) this._syncQueue = savedQueue;

    // 3. Terapkan dark mode
    if (this.settings.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.getElementById('darkModeSwitch').checked  = true;
      document.getElementById('darkModeToggle').textContent = '☀️';
    }
    document.getElementById('soundSwitch').checked          = this.settings.sound;
    document.getElementById('musicSwitch').checked          = this.settings.music;
    document.getElementById('shuffleSwitch').checked        = this.settings.shuffle;
    document.getElementById('shuffleAnswersSwitch').checked = this.settings.shuffleAnswers;

    // 4. Muat data (cloud → localStorage → questions-data.json)
    await this.initData();

    // 5. Init audio & UI
    Audio.init();
    this.createStarsBg();
    this.updateHomeStats();
    this.updateGreeting();
    this.populateSubjectSelects();
    this.populateHistoryFilter();
    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupNetworkStatus();

    // 6. Custom timer select listener
    document.getElementById('examTimer').addEventListener('change', (e) => {
      document.getElementById('customTimerGroup')
        .classList.toggle('hidden', e.target.value !== 'custom');
    });

    // 7. Sembunyikan loading
    setTimeout(() => {
      const loading = document.getElementById('loadingScreen');
      loading.style.transition = 'opacity 0.5s';
      loading.style.opacity    = '0';
      setTimeout(() => { loading.style.display = 'none'; }, 500);
    }, 1600);
  },

  // ============================================================
  // DATA INITIALIZATION  (cloud-first → localStorage → JSON)
  // ============================================================
  async initData() {
    // 1. Coba cloud
    if (CLOUD_ENABLED && navigator.onLine) {
      this._showCloudStatus('☁️ Menghubungi server...');
      const ok = await this._fetchCloudData();
      this._showCloudStatus(
        ok ? '☁️ Terhubung ke cloud ✓' : '⚠️ Gagal terhubung, pakai data lokal',
        !ok
      );
      setTimeout(() => this._hideCloudStatus(), 3000);
    }

    // 2. Jika localStorage masih kosong, muat dari questions-data.json
    const localSubjects  = Storage.get('sl_subjects');
    const localQuestions = Storage.get('sl_questions');

    if (!localSubjects || !localQuestions || localQuestions.length === 0) {
      try {
        const resp = await fetch('./questions-data.json');
        const data = await resp.json();
        if (!localSubjects)                                     Storage.set('sl_subjects',  data.subjects);
        if (!localQuestions || localQuestions.length === 0)     Storage.set('sl_questions', data.questions);
      } catch(e) {
        this.setDefaultData();
      }
    }
  },

  setDefaultData() {
    Storage.set('sl_subjects', [
      { id: 'math',       name: 'Matematika',       icon: '🔢', color: '#FF6B6B' },
      { id: 'science',    name: 'IPA',              icon: '🔬', color: '#4ECDC4' },
      { id: 'indonesian', name: 'Bahasa Indonesia', icon: '📚', color: '#45B7D1' }
    ]);
    Storage.set('sl_questions', []);
  },

  getSubjects()  { return Storage.get('sl_subjects',  []); },
  getQuestions() { return Storage.get('sl_questions', []); },
  getHistory()   { return Storage.get('sl_history',   []); },

  // ============================================================
  // SCREEN NAVIGATION
  // ============================================================
  showScreen(id) {
    Audio.click();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    this.currentScreen = id;
    window.scrollTo(0, 0);

    if      (id === 'homeScreen')      { this.updateHomeStats(); this.renderRecentActivity(); }
    else if (id === 'questionsScreen')   this.renderQuestionList();
    else if (id === 'subjectsScreen')    this.renderSubjectList();
    else if (id === 'historyScreen')   { this.renderHistory(); this.renderRanking(); this.renderStats(); }
  },

  // ============================================================
  // HOME
  // ============================================================
  updateGreeting() {
    const now    = new Date();
    const days   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const hour   = now.getHours();
    const greet  = hour < 11 ? '🌅 Selamat Pagi!' : hour < 15 ? '☀️ Selamat Siang!'
                 : hour < 18 ? '🌤️ Selamat Sore!'  : '🌙 Selamat Malam!';
    document.getElementById('greetingDate').textContent =
      `${greet} ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  },

  updateHomeStats() {
    const history = this.getHistory();
    document.getElementById('statExams').textContent = history.length;
    if (history.length > 0) {
      document.getElementById('statAvg').textContent  = Math.round(history.reduce((a, h) => a + h.score, 0) / history.length);
      document.getElementById('statBest').textContent = Math.max(...history.map(h => h.score));
    } else {
      document.getElementById('statAvg').textContent  = '-';
      document.getElementById('statBest').textContent = '-';
    }
  },

  renderRecentActivity() {
    const history   = this.getHistory();
    const container = document.getElementById('recentActivity');
    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">📭</span>
        <div class="empty-title">Belum ada aktivitas</div>
        <div class="empty-desc">Mulai ujian atau mode belajar untuk melihat aktivitasmu!</div>
      </div>`;
      return;
    }
    container.innerHTML = history.slice(-3).reverse().map(h => this.historyCardHTML(h)).join('');
  },

  historyCardHTML(h) {
    const subj       = this.getSubjects().find(s => s.id === h.subjectId) || { name: h.subjectId, icon: '📚', color: '#4361ee' };
    const scoreColor = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--orange)' : 'var(--red)';
    const d          = new Date(h.date);
    const dateStr    = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `<div class="history-card" onclick="App.viewHistoryDetail('${h.id}')">
      <div class="history-icon" style="background:${subj.color}22">${subj.icon}</div>
      <div class="history-info">
        <div class="history-name">${this.escapeHtml(h.studentName)}</div>
        <div class="history-meta">${subj.name} · ${h.studentClass} · ${dateStr}</div>
        <div class="history-meta">⏱️ ${h.timeTaken||'-'} · ${h.totalQuestions} soal · ${h.mode==='learning'?'📖 Belajar':'📋 Ujian'}</div>
      </div>
      <div class="history-score" style="color:${scoreColor}">${h.score}</div>
    </div>`;
  },

  // ============================================================
  // EXAM SETUP
  // ============================================================
  showExamSetup() {
    document.getElementById('examSetupTitle').textContent = 'Mulai Ujian 📋';
    document.getElementById('timerGroup').classList.remove('hidden');
    document.getElementById('examMode').value = 'exam';
    this.populateSubjectSelects();
    this.showScreen('examSetupScreen');
  },

  showLearningSetup() {
    document.getElementById('examSetupTitle').textContent = 'Mode Belajar 📖';
    document.getElementById('timerGroup').classList.add('hidden');
    document.getElementById('examMode').value = 'learning';
    this.populateSubjectSelects();
    this.showScreen('examSetupScreen');
  },

  populateSubjectSelects() {
    const subjects = this.getSubjects();
    ['examSubject', 'qSubjectSelect', 'historyFilter', 'rankingFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const isFilter = id.includes('Filter');
      el.innerHTML   = isFilter ? '<option value="">Semua Mapel</option>' : '';
      subjects.forEach(s => { el.innerHTML += `<option value="${s.id}">${s.icon} ${s.name}</option>`; });
    });
    this.buildSubjectFilterTabs();
  },

  populateHistoryFilter() { this.populateSubjectSelects(); },

  // ============================================================
  // START EXAM
  // ============================================================
  startExam() {
    const studentName = document.getElementById('studentName').value.trim();
    const studentClass= document.getElementById('studentClass').value;
    const subjectId   = document.getElementById('examSubject').value;
    const mode        = document.getElementById('examMode').value;
    const resultMode  = document.getElementById('resultMode').value;
    const qCount      = parseInt(document.getElementById('questionCount').value);

    if (!studentName) { this.showToast('⚠️ Masukkan nama siswa dulu!', 'warning'); document.getElementById('studentName').focus(); return; }
    if (!subjectId)   { this.showToast('⚠️ Pilih mata pelajaran dulu!', 'warning'); return; }

    let timerMin = 30;
    if (mode !== 'learning') {
      const sel = document.getElementById('examTimer').value;
      timerMin  = sel === 'custom' ? (parseInt(document.getElementById('customTimer').value) || 30) : parseInt(sel);
    } else {
      timerMin = 0;
    }

    const allQ = this.getQuestions().filter(q => q.subjectId === subjectId);
    if (allQ.length === 0) { this.showToast('❌ Tidak ada soal untuk mata pelajaran ini!', 'error'); return; }

    let questions = [...allQ];
    if (this.settings.shuffle)        questions = this.shuffleArray(questions);
    questions = questions.slice(0, Math.min(qCount, questions.length));
    if (this.settings.shuffleAnswers) questions = questions.map(q => this.shuffleOptions(q));

    this.currentExam = {
      id: 'exam_' + Date.now(),
      studentName, studentClass, subjectId, questions, mode, resultMode, timerMin
    };
    this.currentQuestion = 0;
    this.answers         = {};
    this.examStartTime   = Date.now();
    this.examMode        = mode;

    Audio.click();
    this.showScreen('examScreen');
    this.setupExamUI();
    if (mode !== 'learning' && timerMin > 0) {
      this.startTimer(timerMin * 60);
    } else {
      document.getElementById('timerDisplay').style.display = 'none';
    }
    this.renderQuestion();
  },

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  shuffleOptions(q) {
    const letters = ['A','B','C','D'];
    const opts    = q.options.map((opt, i) => ({ letter: letters[i], text: opt }));
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const origText  = q.options[letters.indexOf(q.answer)];
    const newAnswer = letters[opts.findIndex(o => o.text === origText)];
    return {
      ...q,
      options:   opts.map((o, i) => `${letters[i]}. ${o.text.replace(/^[A-D]\.\s*/, '')}`),
      answer:    newAnswer,
      _shuffled: true
    };
  },

  setupExamUI() {
    const subj = this.getSubjects().find(s => s.id === this.currentExam.subjectId);
    document.getElementById('examSubjectDisplay').textContent = subj ? subj.icon + ' ' + subj.name : this.currentExam.subjectId;
    document.getElementById('timerDisplay').style.display = '';
    this.renderQuestionGrid();
  },

  renderQuestionGrid() {
    document.getElementById('questionGrid').innerHTML =
      this.currentExam.questions.map((q, i) => {
        const cls = i === this.currentQuestion ? 'current' : (this.answers[i] !== undefined ? 'answered' : '');
        return `<button class="q-num-btn ${cls}" onclick="App.jumpToQuestion(${i})">${i+1}</button>`;
      }).join('');
  },

  toggleQGrid() {
    const grid = document.getElementById('questionGrid');
    grid.style.display = (grid.style.display === 'none' || !grid.style.display) ? 'flex' : 'none';
  },

  renderQuestion() {
    const exam    = this.currentExam;
    const q       = exam.questions[this.currentQuestion];
    const total   = exam.questions.length;
    const current = this.currentQuestion;

    document.getElementById('examProgressText').textContent = `Soal ${current+1} dari ${total}`;
    document.getElementById('qBadgeText').textContent       = `Soal ${current+1}`;
    document.getElementById('examProgressBar').style.width  = `${((current+1)/total)*100}%`;

    // Teks soal
    document.getElementById('questionText').textContent = q.question;

    // Gambar soal (opsional)
    let qImg = document.getElementById('questionImage');
    if (!qImg) {
      qImg           = document.createElement('img');
      qImg.id        = 'questionImage';
      qImg.alt       = 'Gambar soal';
      qImg.style.cssText = [
        'width:100%','max-height:200px','object-fit:contain',
        'border-radius:12px','margin:10px 0 4px',
        'border:2px solid var(--border)','background:var(--bg)','display:none'
      ].join(';');
      document.getElementById('questionText').after(qImg);
    }
    if (q.imageData) { qImg.src = q.imageData; qImg.style.display = 'block'; }
    else             { qImg.src = '';           qImg.style.display = 'none';  }

    // Pilihan jawaban
    const letters = ['A','B','C','D'];
    document.getElementById('optionsList').innerHTML = q.options.map((opt, i) => {
      const letter = letters[i];
      const text   = opt.replace(/^[A-D]\.\s*/, '');
      const sel    = this.answers[current] === letter;
      let cls      = sel ? 'selected' : '';
      if (exam.mode === 'learning' && this.answers[current] !== undefined) {
        if (letter === q.answer)                   cls = 'correct';
        else if (letter === this.answers[current]) cls = 'wrong';
      }
      return `<button class="option-btn ${cls}" onclick="App.selectOption('${letter}')">
        <span class="option-badge">${letter}</span>
        <span>${text}</span>
      </button>`;
    }).join('');

    // Pembahasan (mode belajar)
    const explBox = document.getElementById('explanationBox');
    if (exam.mode === 'learning' && this.answers[current] !== undefined) {
      document.getElementById('explanationText').textContent = q.explanation || 'Tidak ada pembahasan.';
      explBox.classList.add('show');
    } else {
      explBox.classList.remove('show');
    }

    // Tombol navigasi
    const prev   = document.getElementById('prevBtn');
    const next   = document.getElementById('nextBtn');
    const finish = document.getElementById('finishBtn');
    prev.classList.toggle('hidden', current === 0);
    if (current === total - 1) { next.classList.add('hidden');    finish.classList.remove('hidden'); }
    else                        { next.classList.remove('hidden'); finish.classList.add('hidden');    }

    this.renderQuestionGrid();
  },

  selectOption(letter) {
    const exam = this.currentExam;
    const q    = exam.questions[this.currentQuestion];
    if (exam.mode === 'learning' && this.answers[this.currentQuestion] !== undefined) return;
    this.answers[this.currentQuestion] = letter;
    Audio.click();
    if (exam.mode === 'learning') {
      if (letter === q.answer) Audio.correct(); else Audio.wrong();
    }
    this.renderQuestion();
  },

  prevQuestion() { Audio.click(); if (this.currentQuestion > 0)                                     { this.currentQuestion--; this.renderQuestion(); } },
  nextQuestion() { Audio.click(); if (this.currentQuestion < this.currentExam.questions.length - 1)  { this.currentQuestion++; this.renderQuestion(); } },
  jumpToQuestion(n) { Audio.click(); this.currentQuestion = n; this.renderQuestion(); this.toggleQGrid(); },

  // ============================================================
  // TIMER
  // ============================================================
  startTimer(seconds) {
    this.timerSeconds = seconds;
    this.updateTimerDisplay();
    this.timer = setInterval(() => {
      this.timerSeconds--;
      this.updateTimerDisplay();
      if (this.timerSeconds <= 0) {
        clearInterval(this.timer);
        this.showToast('⏰ Waktu habis!', 'warning');
        this.finishExam(true);
      }
    }, 1000);
  },

  updateTimerDisplay() {
    const m   = Math.floor(this.timerSeconds / 60);
    const s   = this.timerSeconds % 60;
    const el  = document.getElementById('timerDisplay');
    document.getElementById('timerTime').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.classList.remove('warning','danger');
    if      (this.timerSeconds <=  60) el.classList.add('danger');
    else if (this.timerSeconds <= 300) el.classList.add('warning');
  },

  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  getTimeTaken() {
    const e = Math.floor((Date.now() - this.examStartTime) / 1000);
    return `${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`;
  },

  // ============================================================
  // FINISH EXAM
  // ============================================================
  finishExam(timeout = false) {
    this.stopTimer();
    Audio.click();

    const exam      = this.currentExam;
    const questions = exam.questions;
    let correct = 0, wrong = 0, skipped = 0;
    questions.forEach((q, i) => {
      if      (this.answers[i] === undefined) skipped++;
      else if (this.answers[i] === q.answer)  correct++;
      else                                    wrong++;
    });

    const total     = questions.length;
    const score     = Math.round((correct / total) * 100);
    const timeTaken = this.getTimeTaken();

    // Simpan data hasil — hilangkan imageData dari soal agar record tidak terlalu besar
    const result = {
      id:             'result_' + Date.now(),
      examId:         exam.id,
      studentName:    exam.studentName,
      studentClass:   exam.studentClass,
      subjectId:      exam.subjectId,
      date:           new Date().toISOString(),
      score, correct, wrong, skipped,
      totalQuestions: total,
      timeTaken,
      mode:           exam.mode,
      resultMode:     exam.resultMode,
      answers:        { ...this.answers },
      questions:      questions.map(q => ({
        id:          q.id,
        question:    q.question,
        options:     q.options,
        answer:      q.answer,
        explanation: q.explanation,
        userAnswer:  this.answers[questions.indexOf(q)]
        // imageData sengaja tidak disimpan di history agar record ringkas
      }))
    };

    // Simpan lokal
    const history = this.getHistory();
    history.push(result);
    Storage.set('sl_history', history);

    // Sync ke cloud (tanpa imageData besar)
    this.cloudSave('saveHistory', { record: result });

    if (exam.resultMode === 'delayed') {
      this.showScreen('delayedResultScreen');
      this.showToast('✅ Hasil tersimpan! Guru akan membuka hasilnya.', 'success');
    } else {
      this.showResult(result);
    }
  },

  // ============================================================
  // SHOW RESULT
  // ============================================================
  showResult(result) {
    this.showScreen('resultScreen');
    const { score, correct, wrong, totalQuestions, timeTaken, studentName } = result;

    const emoji = score >= 90 ? '🌟' : score >= 80 ? '😄' : score >= 70 ? '😊' : score >= 60 ? '😐' : '😢';
    document.getElementById('resultEmoji').textContent   = emoji;
    document.getElementById('resultScore').textContent   = score;
    document.getElementById('resultLabel').textContent   = `${studentName} · ${timeTaken}`;
    document.getElementById('resultCorrect').textContent = correct;
    document.getElementById('resultWrong').textContent   = wrong;
    document.getElementById('resultTime').textContent    = timeTaken;

    const card = document.getElementById('resultCard');
    if      (score >= 90) card.style.background = 'linear-gradient(135deg, #ffd60a, #fb8500)';
    else if (score >= 80) card.style.background = 'linear-gradient(135deg, #06d6a0, #4cc9f0)';
    else if (score >= 60) card.style.background = 'linear-gradient(135deg, #4361ee, #7209b7)';
    else                  card.style.background = 'linear-gradient(135deg, #ef233c, #f72585)';

    const badges = [];
    if (score >= 90) badges.push({ icon: '🏆', label: 'Juara!'    });
    if (score >= 80) badges.push({ icon: '🌟', label: 'Cerdas!'   });
    if (score >= 70) badges.push({ icon: '👍', label: 'Hebat!'    });
    if (correct === totalQuestions) badges.push({ icon: '💯', label: 'Sempurna!' });
    document.getElementById('badgeDisplay').innerHTML = badges.map(b => `<div class="badge">${b.icon} ${b.label}</div>`).join('');

    const subj = this.getSubjects().find(s => s.id === result.subjectId) || { name: result.subjectId };
    document.getElementById('resultInfo').innerHTML = `
      <div class="card" style="text-align:center">
        <div style="font-size:13px;color:var(--text-muted);font-weight:700">
          ${subj.name} · ${result.studentClass} · ${new Date(result.date).toLocaleDateString('id-ID')}
        </div>
        <div style="margin-top:8px;font-size:14px;font-weight:700">${this.getScoreMessage(score)}</div>
      </div>`;

    const review = result.questions || [];
    document.getElementById('answerReview').innerHTML = review.map((q, i) => {
      const userAns  = result.answers[i];
      const isOk     = userAns === q.answer;
      return `<div class="review-item">
        <div class="q-num">Soal ${i+1}</div>
        <div class="q-text-sm">${this.escapeHtml(q.question || '')}</div>
        <div class="review-answers">
          <span class="answer-pill ${isOk ? 'user-correct' : 'user-wrong'}">
            ${userAns ? '✏️ Jawabanmu: '+userAns : '⏭️ Dilewati'}
          </span>
          ${!isOk ? `<span class="answer-pill correct-answer">✅ Benar: ${q.answer}</span>` : ''}
        </div>
        ${q.explanation ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;padding:8px;background:var(--bg);border-radius:8px;font-weight:600">💡 ${this.escapeHtml(q.explanation)}</div>` : ''}
      </div>`;
    }).join('');

    if (score >= 80) { Audio.complete(); this.celebrate(); }
  },

  getScoreMessage(score) {
    if (score >= 90) return '🌟 Luar Biasa! Kamu sangat pintar!';
    if (score >= 80) return '🎉 Bagus sekali! Pertahankan prestasimu!';
    if (score >= 70) return '😊 Cukup baik! Terus semangat belajar!';
    if (score >= 60) return '📚 Lumayan! Perlu belajar lebih giat ya!';
    return '💪 Jangan menyerah! Coba lagi dan pelajari materinya!';
  },

  celebrate() {
    const container = document.getElementById('starCelebration');
    container.innerHTML = '';
    const colors = ['#ffd60a','#f72585','#4361ee','#06d6a0','#4cc9f0','#7209b7','#fb8500'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.cssText = [
        `left:${Math.random()*100}%`,
        `background:${colors[Math.floor(Math.random()*colors.length)]}`,
        `width:${6+Math.random()*8}px`,
        `height:${6+Math.random()*8}px`,
        `border-radius:${Math.random()>0.5?'50%':'2px'}`,
        `animation-duration:${1.5+Math.random()*2}s`,
        `animation-delay:${Math.random()*0.5}s`
      ].join(';');
      container.appendChild(c);
    }
    setTimeout(() => { container.innerHTML = ''; }, 4000);
  },

  exportResultPDF() {
    const result = this.getHistory().slice(-1)[0];
    if (!result) { this.showToast('⚠️ Tidak ada hasil untuk diekspor!', 'warning'); return; }
    const subj = this.getSubjects().find(s => s.id === result.subjectId) || { name: result.subjectId };
    const win  = window.open('', '_blank');
    if (!win) { this.showToast('⚠️ Izinkan pop-up untuk ekspor PDF.', 'warning'); return; }
    win.document.write(`<html><head><title>Hasil Ujian - ${result.studentName}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px}h1{color:#4361ee}.stat{display:inline-block;margin:8px;padding:12px 20px;border-radius:8px;background:#f0f4ff}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:left;font-size:12px}th{background:#4361ee;color:white}</style>
      </head><body>
      <h1>🎓 Smart Learning SD/MI</h1><h2>Hasil Ujian</h2>
      <p><b>Nama:</b> ${result.studentName} | <b>Kelas:</b> ${result.studentClass}</p>
      <p><b>Mapel:</b> ${subj.name} | <b>Tanggal:</b> ${new Date(result.date).toLocaleDateString('id-ID')}</p>
      <div class="stat"><b>Nilai: ${result.score}</b></div>
      <div class="stat">✅ Benar: ${result.correct}</div>
      <div class="stat">❌ Salah: ${result.wrong}</div>
      <div class="stat">Total: ${result.totalQuestions}</div>
      <div class="stat">⏱️ Waktu: ${result.timeTaken}</div>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  },

  // ============================================================
  // HISTORY
  // ============================================================
  showHistory() { this.populateSubjectSelects(); this.showScreen('historyScreen'); },

  switchHistoryTab(tab, btn) {
    Audio.click();
    document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('historyTab').classList.toggle('hidden',  tab !== 'history');
    document.getElementById('rankingTab').classList.toggle('hidden',  tab !== 'ranking');
    document.getElementById('statsTab').classList.toggle('hidden',    tab !== 'stats');
    if (tab === 'ranking') this.renderRanking();
    if (tab === 'stats')   this.renderStats();
  },

  renderHistory() {
    const filter    = document.getElementById('historyFilter')?.value || '';
    let history     = this.getHistory();
    if (filter) history = history.filter(h => h.subjectId === filter);
    history = history.slice().reverse();
    const container = document.getElementById('historyList');
    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">📭</span>
        <div class="empty-title">Belum ada riwayat</div>
        <div class="empty-desc">Mulai ujian untuk melihat riwayat hasil belajarmu!</div>
      </div>`;
      return;
    }
    container.innerHTML = history.map(h => this.historyCardHTML(h)).join('');
  },

  viewHistoryDetail(id) {
    const result = this.getHistory().find(h => h.id === id);
    if (!result) return;
    if (result.resultMode === 'delayed') {
      this.pinTarget = { action: 'view-delayed', data: result };
      this.showModal('pinModal');
    } else {
      this.showResult(result);
    }
  },

  renderRanking() {
    const filter    = document.getElementById('rankingFilter')?.value || '';
    let history     = this.getHistory();
    if (filter) history = history.filter(h => h.subjectId === filter);
    const byStudent = {};
    history.forEach(h => {
      const key = h.studentName + '_' + h.studentClass;
      if (!byStudent[key] || h.score > byStudent[key].score) byStudent[key] = h;
    });
    const ranked    = Object.values(byStudent).sort((a, b) => b.score - a.score);
    const container = document.getElementById('rankingList');
    if (ranked.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="empty-emoji">🏆</span><div class="empty-title">Belum ada ranking</div></div>`;
      return;
    }
    const medals = ['🥇','🥈','🥉'];
    container.innerHTML = ranked.map((h, i) => {
      const c    = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--orange)' : 'var(--red)';
      const subj = this.getSubjects().find(s => s.id === h.subjectId) || { name: h.subjectId };
      return `<div class="ranking-item">
        <div class="rank-num">${medals[i] || '#'+(i+1)}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px">${this.escapeHtml(h.studentName)}</div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:600">${h.studentClass} · ${subj.name}</div>
        </div>
        <div style="font-family:var(--font-display);font-size:24px;color:${c}">${h.score}</div>
      </div>`;
    }).join('');
  },

  renderStats() {
    const history   = this.getHistory();
    const container = document.getElementById('statsContent');
    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="empty-emoji">📈</span><div class="empty-title">Belum ada statistik</div></div>`;
      return;
    }
    const total   = history.length;
    const avg     = Math.round(history.reduce((a, h) => a + h.score, 0) / total);
    const best    = Math.max(...history.map(h => h.score));
    const worst   = Math.min(...history.map(h => h.score));
    const passing = history.filter(h => h.score >= 70).length;
    const bySubj  = {};
    history.forEach(h => { if (!bySubj[h.subjectId]) bySubj[h.subjectId] = []; bySubj[h.subjectId].push(h.score); });
    const subjStats = this.getSubjects().map(s => {
      const sc = bySubj[s.id] || [];
      if (!sc.length) return null;
      return { s, count: sc.length, avg: Math.round(sc.reduce((a,b)=>a+b,0)/sc.length), best: Math.max(...sc) };
    }).filter(Boolean);

    container.innerHTML = `
      <div class="card">
        <div style="font-family:var(--font-display);font-size:18px;margin-bottom:16px">📊 Ringkasan</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${[['📝 Total Ujian',total],['⭐ Rata-rata',avg],['🏆 Tertinggi',best],
             ['📉 Terendah',worst],['✅ Lulus (≥70)',passing],['📊 % Lulus',Math.round((passing/total)*100)+'%']]
            .map(([lbl,val])=>`<div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center">
              <div style="font-size:10px;color:var(--text-muted);font-weight:700">${lbl}</div>
              <div style="font-family:var(--font-display);font-size:22px;color:var(--primary)">${val}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div style="font-family:var(--font-display);font-size:18px;margin-bottom:12px">📚 Per Mata Pelajaran</div>
        ${subjStats.map(({s,count,avg,best})=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:24px">${s.icon}</span>
            <div style="flex:1">
              <div style="font-weight:700">${s.name}</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600">${count} ujian · Terbaik: ${best}</div>
            </div>
            <div style="font-family:var(--font-display);font-size:22px;color:var(--primary)">${avg}</div>
          </div>`).join('')}
      </div>`;
  },

  clearHistory() {
    this.showConfirm('🗑️ Hapus Riwayat', 'Semua riwayat ujian akan dihapus permanen. Lanjutkan?', () => {
      Storage.set('sl_history', []);
      this.cloudSave('clearHistory', {});
      this.renderHistory();
      this.updateHomeStats();
      this.showToast('🗑️ Riwayat berhasil dihapus!', 'success');
    });
  },

  // ============================================================
  // QUESTION MANAGEMENT
  // ============================================================
  buildSubjectFilterTabs() {
    const tabs = document.getElementById('subjectFilterTabs');
    if (!tabs) return;
    tabs.innerHTML =
      `<button class="tab-btn active" onclick="App.filterBySubject('all',this)">📋 Semua</button>` +
      this.getSubjects().map(s =>
        `<button class="tab-btn" onclick="App.filterBySubject('${s.id}',this)">${s.icon} ${s.name}</button>`
      ).join('');
  },

  filterBySubject(id, btn) {
    Audio.click();
    document.querySelectorAll('#subjectFilterTabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.currentFilterSubject = id;
    this.renderQuestionList();
  },

  searchQuestions() { this.renderQuestionList(); },

  renderQuestionList() {
    const allQ     = this.getQuestions();
    const search   = (document.getElementById('questionSearch')?.value || '').toLowerCase();
    const filter   = this.currentFilterSubject;
    const subjects = this.getSubjects();

    let questions = allQ;
    if (filter && filter !== 'all') questions = questions.filter(q => q.subjectId === filter);
    if (search) questions = questions.filter(q =>
      q.question.toLowerCase().includes(search) ||
      q.options?.some(o => o.toLowerCase().includes(search))
    );

    const container = document.getElementById('questionList');
    if (questions.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="empty-emoji">🔍</span><div class="empty-title">Tidak ada soal</div><div class="empty-desc">Tambah soal baru atau ubah filter!</div></div>`;
      return;
    }
    container.innerHTML = questions.map(q => {
      const subj  = subjects.find(s => s.id === q.subjectId) || { name: q.subjectId, icon: '📚', color: '#4361ee' };
      const imgBg = q.imageData ? `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:99px;background:rgba(76,201,240,0.15);color:var(--accent2);font-size:10px;font-weight:700;margin-left:6px;">🖼️ Bergambar</span>` : '';
      return `<div class="question-list-item">
        <div class="q-content">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
            <span class="q-subject-tag" style="background:${subj.color}22;color:${subj.color}">${subj.icon} ${subj.name}</span>${imgBg}
          </div>
          <div class="q-text-preview">${this.escapeHtml(q.question)}</div>
          <div style="font-size:11px;color:var(--green);font-weight:700;margin-top:4px">✅ Jawaban: ${q.answer}</div>
        </div>
        <div class="q-actions">
          <button class="action-btn edit"   onclick="App.editQuestion('${q.id}')">✏️</button>
          <button class="action-btn delete" onclick="App.deleteQuestion('${q.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  },

  showAddQuestion() {
    document.getElementById('questionModalTitle').textContent = '➕ Tambah Soal';
    document.getElementById('editQuestionId').value = '';
    document.getElementById('qImageData').value     = '';
    ['qText','qOptionA','qOptionB','qOptionC','qOptionD','qExplanation'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('qAnswer').value = 'A';
    document.getElementById('qImagePreviewWrap').style.display = 'none';
    document.getElementById('qImagePreview').src                = '';
    document.getElementById('qImageFile').value                 = '';
    const subjects = this.getSubjects();
    document.getElementById('qSubjectSelect').innerHTML =
      subjects.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');
    this.showModal('questionModal');
  },

  handleQuestionImage(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.showToast('⚠️ Gambar terlalu besar! Maksimal 2MB.', 'warning');
      input.value = '';
      return;
    }
    const reader  = new FileReader();
    reader.onload = (e) => {
      const url = e.target.result;
      document.getElementById('qImageData').value              = url;
      document.getElementById('qImagePreview').src             = url;
      document.getElementById('qImagePreviewWrap').style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  removeQuestionImage() {
    document.getElementById('qImageData').value              = '';
    document.getElementById('qImagePreview').src             = '';
    document.getElementById('qImagePreviewWrap').style.display = 'none';
    document.getElementById('qImageFile').value              = '';
  },

  editQuestion(id) {
    const q = this.getQuestions().find(q => q.id === id);
    if (!q) return;
    document.getElementById('questionModalTitle').textContent = '✏️ Edit Soal';
    document.getElementById('editQuestionId').value           = id;
    document.getElementById('qText').value                    = q.question;
    document.getElementById('qImageData').value               = q.imageData || '';
    document.getElementById('qImageFile').value               = '';
    if (q.imageData) {
      document.getElementById('qImagePreview').src             = q.imageData;
      document.getElementById('qImagePreviewWrap').style.display = 'block';
    } else {
      document.getElementById('qImagePreview').src             = '';
      document.getElementById('qImagePreviewWrap').style.display = 'none';
    }
    document.getElementById('qSubjectSelect').innerHTML =
      this.getSubjects().map(s =>
        `<option value="${s.id}" ${s.id===q.subjectId?'selected':''}>${s.icon} ${s.name}</option>`
      ).join('');
    ['qOptionA','qOptionB','qOptionC','qOptionD'].forEach((elId, i) => {
      document.getElementById(elId).value = (q.options[i] || '').replace(/^[A-D]\.\s*/, '');
    });
    document.getElementById('qAnswer').value      = q.answer;
    document.getElementById('qExplanation').value = q.explanation || '';
    this.showModal('questionModal');
  },

  saveQuestion() {
    const qText      = document.getElementById('qText').value.trim();
    const optA       = document.getElementById('qOptionA').value.trim();
    const optB       = document.getElementById('qOptionB').value.trim();
    const optC       = document.getElementById('qOptionC').value.trim();
    const optD       = document.getElementById('qOptionD').value.trim();
    const answer     = document.getElementById('qAnswer').value;
    const explanation= document.getElementById('qExplanation').value.trim();
    const subjectId  = document.getElementById('qSubjectSelect').value;
    const editId     = document.getElementById('editQuestionId').value;
    const imageData  = document.getElementById('qImageData').value || '';

    if (!qText || !optA || !optB || !optC || !optD) {
      this.showToast('⚠️ Lengkapi semua kolom soal!', 'warning'); return;
    }

    const questions    = this.getQuestions();
    const questionData = {
      id:         editId || 'q_' + Date.now(),
      subjectId,
      question:   qText,
      options:    [`A. ${optA}`, `B. ${optB}`, `C. ${optC}`, `D. ${optD}`],
      answer,
      explanation,
      imageData:  imageData || null
    };

    if (editId) {
      const idx = questions.findIndex(q => q.id === editId);
      if (idx >= 0) questions[idx] = questionData;
    } else {
      questions.push(questionData);
    }

    Storage.set('sl_questions', questions);

    // Sync ke cloud — kirim tanpa imageData (base64 terlalu besar untuk Sheets)
    const cloudQ = { ...questionData, imageData: questionData.imageData ? '[IMAGE_LOCAL]' : null };
    this.cloudSave('saveQuestion', { question: cloudQ });

    this.closeModal('questionModal');
    this.renderQuestionList();
    this.showToast(editId ? '✅ Soal berhasil diubah!' : '✅ Soal berhasil ditambah!', 'success');
    Audio.correct();
  },

  deleteQuestion(id) {
    this.showConfirm('🗑️ Hapus Soal', 'Soal ini akan dihapus permanen. Lanjutkan?', () => {
      Storage.set('sl_questions', this.getQuestions().filter(q => q.id !== id));
      this.cloudSave('deleteQuestion', { id });
      this.renderQuestionList();
      this.showToast('🗑️ Soal berhasil dihapus!', 'success');
    });
  },

  // ============================================================
  // IMPORT / EXPORT  JSON
  // ============================================================
  importQuestionsJSON() {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader  = new FileReader();
      reader.onload = (ev) => {
        try {
          const data     = JSON.parse(ev.target.result);
          const incoming = Array.isArray(data) ? data : (data.questions || []);
          const existing = this.getQuestions();
          const ids      = new Set(existing.map(q => q.id));
          let added = 0;
          const merged   = [...existing];
          incoming.forEach(q => {
            if (q.question && q.options && q.answer && !ids.has(q.id)) {
              merged.push({ ...q, id: q.id || 'q_' + Date.now() + '_' + added });
              added++;
            }
          });
          Storage.set('sl_questions', merged);
          this.renderQuestionList();
          this.showToast(`✅ Berhasil import ${added} soal dari JSON!`, 'success');
        } catch { this.showToast('❌ File JSON tidak valid!', 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  exportQuestionsJSON() {
    const q    = this.getQuestions();
    const blob = new Blob([JSON.stringify(q, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `soal-smart-learning-${Date.now()}.json` });
    a.click();
    URL.revokeObjectURL(url);
    this.showToast(`📤 Berhasil export ${q.length} soal ke JSON!`, 'success');
  },

  // ============================================================
  // EXCEL IMPORT / EXPORT
  // ============================================================
  importQuestionsExcel() {
    document.getElementById('excelFileInput').value = '';
    document.getElementById('excelFileInput').click();
  },

  processExcelFile(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const r = new FileReader();
      r.onload = (e) => this._parseCSVToQuestions(e.target.result);
      r.readAsText(file, 'UTF-8');
      return;
    }
    this._loadSheetJS(() => {
      const r   = new FileReader();
      r.onload  = (e) => {
        try {
          /* global XLSX */
          const wb   = XLSX.read(e.target.result, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          this._importRowsToQuestions(rows);
        } catch(err) {
          this.showToast('❌ File Excel tidak dapat dibaca: ' + err.message, 'error');
        }
      };
      r.readAsArrayBuffer(file);
    });
  },

  _loadSheetJS(cb) {
    if (window.XLSX) { cb(); return; }
    const sc    = document.createElement('script');
    sc.src      = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload   = cb;
    sc.onerror  = () => this.showToast('❌ Gagal memuat library Excel. Cek koneksi internet.', 'error');
    document.head.appendChild(sc);
  },

  _parseCSVToQuestions(csv) {
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    const rows  = lines.map(l => {
      const res = []; let cur = '', inQ = false;
      for (const ch of l) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      res.push(cur.trim());
      return res;
    });
    this._importRowsToQuestions(rows);
  },

  /**
   * Kolom: A=subjectId B=question C=optA D=optB E=optC F=optD G=answer H=explanation
   * Baris 0 = header (dilewati)
   */
  _importRowsToQuestions(rows) {
    const existing = this.getQuestions();
    const ids      = new Set(existing.map(q => q.id));
    let added = 0, errors = 0;
    const merged   = [...existing];

    rows.slice(1).forEach((row, idx) => {
      const subjectId  = String(row[0] || '').trim();
      const question   = String(row[1] || '').trim();
      const optA       = String(row[2] || '').trim();
      const optB       = String(row[3] || '').trim();
      const optC       = String(row[4] || '').trim();
      const optD       = String(row[5] || '').trim();
      const answer     = String(row[6] || '').trim().toUpperCase();
      const expl       = String(row[7] || '').trim();

      if (!subjectId || !question || !optA || !optB || !answer || !['A','B','C','D'].includes(answer)) {
        if (subjectId || question) errors++;
        return;
      }

      const id = 'excel_' + Date.now() + '_' + idx;
      if (ids.has(id)) return;
      ids.add(id);

      merged.push({
        id, subjectId, question,
        options:     [`A. ${optA}`, `B. ${optB}`, `C. ${optC || '-'}`, `D. ${optD || '-'}`],
        answer,
        explanation: expl,
        imageData:   null
      });
      added++;
    });

    Storage.set('sl_questions', merged);
    this.renderQuestionList();
    let msg = `✅ Import selesai: ${added} soal ditambahkan`;
    if (errors) msg += `, ${errors} baris dilewati`;
    this.showToast(msg, added > 0 ? 'success' : 'warning');
  },

  exportQuestionsExcel() {
    const questions = this.getQuestions();
    if (!questions.length) { this.showToast('⚠️ Tidak ada soal untuk diekspor!', 'warning'); return; }
    this._loadSheetJS(() => {
      const header = ['subjectId','question','optionA','optionB','optionC','optionD','answer','explanation'];
      const rows   = questions.map(q => {
        const opts = (q.options || []).map(o => o.replace(/^[A-D]\.\s*/, ''));
        return [q.subjectId||'', q.question||'', opts[0]||'', opts[1]||'', opts[2]||'', opts[3]||'', q.answer||'', q.explanation||''];
      });
      /* global XLSX */
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws['!cols'] = [{wch:14},{wch:50},{wch:22},{wch:22},{wch:22},{wch:22},{wch:8},{wch:40}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Soal');
      XLSX.writeFile(wb, `soal-smart-learning-${Date.now()}.xlsx`);
      this.showToast(`📊 Berhasil export ${questions.length} soal ke Excel!`, 'success');
    });
  },

  downloadExcelTemplate() {
    this._loadSheetJS(() => {
      const header   = ['subjectId','question','optionA','optionB','optionC','optionD','answer','explanation'];
      const examples = [
        ['math',       '2 + 2 = ?',                        '2',     '3',     '4',         '5',    'C', '2+2=4'],
        ['science',    'Planet terdekat dari matahari?',   'Venus', 'Bumi',  'Merkurius', 'Mars', 'C', 'Merkurius adalah planet pertama'],
        ['indonesian', 'Sinonim dari kata "rajin" adalah?','Malas', 'Tekun', 'Lambat',    'Lemah','B', 'Rajin = Tekun'],
      ];
      /* global XLSX */
      const ws    = XLSX.utils.aoa_to_sheet([header, ...examples]);
      ws['!cols'] = [{wch:14},{wch:50},{wch:22},{wch:22},{wch:22},{wch:22},{wch:8},{wch:40}];
      const wb    = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template Soal');

      const info = [
        ['=== PANDUAN PENGISIAN ==='],[''],
        ['Kolom','Nama','Keterangan'],
        ['A','subjectId','ID mapel: math | science | indonesian | atau ID kustom'],
        ['B','question','Teks soal (WAJIB)'],
        ['C','optionA','Pilihan A (WAJIB)'],
        ['D','optionB','Pilihan B (WAJIB)'],
        ['E','optionC','Pilihan C (boleh kosong → jadi -)'],
        ['F','optionD','Pilihan D (boleh kosong → jadi -)'],
        ['G','answer','Jawaban: A / B / C / D (kapital, WAJIB)'],
        ['H','explanation','Pembahasan (boleh kosong)'],
        [''],['CATATAN:'],
        ['• Baris pertama (header) TIDAK diimpor'],
        ['• Soal bergambar hanya bisa ditambah via form manual'],
        ['• ID mapel kustom: lihat di halaman Kelola Mapel'],
      ];
      const wsInfo    = XLSX.utils.aoa_to_sheet(info);
      wsInfo['!cols'] = [{wch:8},{wch:15},{wch:60}];
      XLSX.utils.book_append_sheet(wb, wsInfo, 'Panduan');
      XLSX.writeFile(wb, 'template-soal-smart-learning.xlsx');
      this.showToast('📥 Template Excel berhasil diunduh!', 'success');
    });
  },

  // ============================================================
  // SUBJECT MANAGEMENT
  // ============================================================
  renderSubjectList() {
    const subjects  = this.getSubjects();
    const questions = this.getQuestions();
    const container = document.getElementById('subjectList');
    if (!subjects.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-emoji">📚</span><div class="empty-title">Belum ada mata pelajaran</div></div>`;
      return;
    }
    container.innerHTML = subjects.map(s => {
      const cnt = questions.filter(q => q.subjectId === s.id).length;
      return `<div class="subject-card">
        <div class="subject-icon-wrap" style="background:${s.color}22">${s.icon}</div>
        <div class="subject-info">
          <div class="subject-name">${this.escapeHtml(s.name)}</div>
          <div class="subject-count">${cnt} soal tersedia</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="action-btn edit"   onclick="App.editSubject('${s.id}')">✏️</button>
          <button class="action-btn delete" onclick="App.deleteSubject('${s.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  },

  showAddSubject() {
    document.getElementById('subjectModalTitle').textContent = '➕ Tambah Mapel';
    document.getElementById('editSubjectId').value = '';
    document.getElementById('subjectName').value   = '';
    document.getElementById('subjectIcon').value   = '📚';
    document.getElementById('subjectColor').value  = '#4361ee';
    this.showModal('subjectModal');
  },

  editSubject(id) {
    const s = this.getSubjects().find(s => s.id === id);
    if (!s) return;
    document.getElementById('subjectModalTitle').textContent = '✏️ Edit Mapel';
    document.getElementById('editSubjectId').value = id;
    document.getElementById('subjectName').value   = s.name;
    document.getElementById('subjectIcon').value   = s.icon;
    document.getElementById('subjectColor').value  = s.color;
    this.showModal('subjectModal');
  },

  saveSubject() {
    const name   = document.getElementById('subjectName').value.trim();
    const icon   = document.getElementById('subjectIcon').value.trim() || '📚';
    const color  = document.getElementById('subjectColor').value;
    const editId = document.getElementById('editSubjectId').value;
    if (!name) { this.showToast('⚠️ Masukkan nama mata pelajaran!', 'warning'); return; }

    const subjects = this.getSubjects();
    const data     = { id: editId || 'subj_' + Date.now(), name, icon, color };

    if (editId) { const i = subjects.findIndex(s => s.id === editId); if (i >= 0) subjects[i] = data; }
    else          subjects.push(data);

    Storage.set('sl_subjects', subjects);
    this.cloudSave('saveSubject', { subject: data });
    this.closeModal('subjectModal');
    this.renderSubjectList();
    this.populateSubjectSelects();
    this.showToast(editId ? '✅ Mapel berhasil diubah!' : '✅ Mapel berhasil ditambah!', 'success');
  },

  deleteSubject(id) {
    const cnt = this.getQuestions().filter(q => q.subjectId === id).length;
    this.showConfirm('🗑️ Hapus Mapel', `Mapel ini memiliki ${cnt} soal. Yakin menghapus?`, () => {
      Storage.set('sl_subjects', this.getSubjects().filter(s => s.id !== id));
      this.cloudSave('deleteSubject', { id });
      this.renderSubjectList();
      this.populateSubjectSelects();
      this.showToast('🗑️ Mapel berhasil dihapus!', 'success');
    });
  },

  // ============================================================
  // SETTINGS
  // ============================================================
  showSettings() { this.showScreen('settingsScreen'); },

  toggleDarkMode(val) {
    this.settings.darkMode = val;
    document.documentElement.setAttribute('data-theme', val ? 'dark' : 'light');
    document.getElementById('darkModeToggle').textContent = val ? '☀️' : '🌙';
    this.saveSettings();
    Audio.click();
  },

  toggleSound(val)         { this.settings.sound          = val; document.getElementById('soundToggle').textContent = val ? '🔊' : '🔇'; this.saveSettings(); },
  toggleMusic(val)         { this.settings.music          = val; val ? Audio.startMusic() : Audio.stopMusic(); this.saveSettings(); },
  toggleShuffle(val)       { this.settings.shuffle        = val; this.saveSettings(); },
  toggleShuffleAnswers(val){ this.settings.shuffleAnswers = val; this.saveSettings(); },

  saveSettings() {
    Storage.set('sl_settings', this.settings);
    // Sync PIN ke cloud agar guru di device lain mendapat PIN terbaru
    this.cloudSave('saveSetting', { key: 'pin', value: this.settings.pin });
  },

  changePIN() {
    ['oldPIN','newPIN','confirmPIN'].forEach(id => { document.getElementById(id).value = ''; });
    this.showModal('changePINModal');
  },

  savePIN() {
    const oldPIN    = document.getElementById('oldPIN').value;
    const newPIN    = document.getElementById('newPIN').value;
    const confirmPIN= document.getElementById('confirmPIN').value;
    if (oldPIN !== this.settings.pin)               { this.showToast('❌ PIN lama tidak benar!', 'error');              return; }
    if (newPIN.length !== 6 || !/^\d+$/.test(newPIN)) { this.showToast('⚠️ PIN baru harus 6 digit angka!', 'warning'); return; }
    if (newPIN !== confirmPIN)                       { this.showToast('⚠️ Konfirmasi PIN tidak cocok!', 'warning');     return; }
    this.settings.pin = newPIN;
    this.saveSettings();  // juga sync ke cloud
    this.closeModal('changePINModal');
    this.showToast('✅ PIN berhasil diubah!', 'success');
  },

  // Public wrappers — selalu minta PIN dulu
  resetAllData()    { this.checkPIN('reset-data');   },
  loadDefaultData() { this.checkPIN('load-default'); },

  _doResetAllData() {
    this.showConfirm('⚠️ Reset Semua Data',
      'SEMUA data (soal, riwayat, pengaturan) akan dihapus. Tidak bisa dibatalkan!', () => {
        localStorage.clear();
        this.showToast('🔄 Data direset! Memuat ulang...', 'info');
        setTimeout(() => location.reload(), 1500);
      });
  },

  _doLoadDefaultData() {
    this.showConfirm('📥 Muat Data Default',
      'Soal bawaan akan dimuat. Soal yang ada tidak dihapus.', async () => {
        try {
          const resp = await fetch('./questions-data.json');
          const data = await resp.json();
          Storage.set('sl_subjects', data.subjects);
          const existing = this.getQuestions();
          const ids      = new Set(existing.map(q => q.id));
          const newQ     = data.questions.filter(q => !ids.has(q.id));
          Storage.set('sl_questions', [...existing, ...newQ]);
          this.populateSubjectSelects();
          this.showToast(`✅ Berhasil memuat ${newQ.length} soal default!`, 'success');
        } catch { this.showToast('❌ Gagal memuat data default.', 'error'); }
      });
  },

  // ============================================================
  // PIN SYSTEM
  // ============================================================
  checkPIN(target) {
    Audio.click();
    this.pinTarget = target;
    this.pinBuffer = '';
    this.updatePINDisplay();
    this.showModal('pinModal');
  },

  pinInput(digit) {
    Audio.click();
    if (this.pinBuffer.length >= 6) return;
    this.pinBuffer += digit;
    this.updatePINDisplay();
    if (this.pinBuffer.length === 6) setTimeout(() => this.pinSubmit(), 200);
  },

  pinClear() { Audio.click(); this.pinBuffer = this.pinBuffer.slice(0, -1); this.updatePINDisplay(); },

  updatePINDisplay() {
    document.querySelectorAll('#pinDisplay .pin-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < this.pinBuffer.length);
    });
  },

  pinSubmit() {
    if (this.pinBuffer !== this.settings.pin) {
      this.showToast('❌ PIN salah!', 'error');
      document.getElementById('pinModal')
        .querySelector('.modal-sheet').classList.add('shake');
      setTimeout(() =>
        document.getElementById('pinModal')
          .querySelector('.modal-sheet').classList.remove('shake'), 500);
      this.pinBuffer = '';
      this.updatePINDisplay();
      return;
    }

    this.closeModal('pinModal');
    this.pinBuffer = '';
    const target   = this.pinTarget;

    if      (target === 'questions')    this.showScreen('questionsScreen');
    else if (target === 'subjects')     this.showScreen('subjectsScreen');
    else if (target === 'reset-data')   this._doResetAllData();
    else if (target === 'load-default') this._doLoadDefaultData();
    else if (target && target.action === 'view-delayed') this.showResult(target.data);
    else if (typeof target === 'function') target();

    Audio.correct();
    this.showToast('✅ PIN benar! Selamat datang, Guru!', 'success');
  },

  // ============================================================
  // MODALS
  // ============================================================
  showModal(id)  { document.getElementById(id).classList.add('open');    document.body.style.overflow = 'hidden'; },
  closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = '';       },

  showConfirm(title, message, onConfirm, emoji = '⚠️') {
    document.getElementById('confirmEmoji').textContent   = emoji;
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmYes').onclick = () => { this.closeModal('confirmModal'); onConfirm(); };
    this.showModal('confirmModal');
  },

  setupModalCloseOnOverlay() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.classList.remove('open'); document.body.style.overflow = ''; }
      });
    });
  },

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================
  showToast(message, type = 'info', duration = 3000) {
    const container   = document.getElementById('toastContainer');
    const toast       = document.createElement('div');
    toast.className   = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ============================================================
  // BACKGROUND STARS
  // ============================================================
  createStarsBg() {
    const container = document.getElementById('starsBg');
    const colors    = ['#ffd60a','#4361ee','#f72585','#06d6a0'];
    for (let i = 0; i < 20; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.cssText = [
        `left:${Math.random()*100}%`, `top:${Math.random()*100}%`,
        `animation-delay:${Math.random()*3}s`,
        `animation-duration:${2+Math.random()*3}s`,
        `width:${4+Math.random()*6}px`,
        `height:${4+Math.random()*6}px`,
        `background:${colors[Math.floor(Math.random()*colors.length)]}`
      ].join(';');
      container.appendChild(s);
    }
  },

  // ============================================================
  // SERVICE WORKER
  // ============================================================
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(r  => console.log('[SW] Registered:', r.scope))
        .catch(e => console.log('[SW] Failed:', e));
    }
  },

  // ============================================================
  // PWA INSTALL PROMPT
  // ============================================================
  deferredPrompt: null,

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      document.getElementById('installBanner')?.classList.add('show');
    });

    document.getElementById('installBtn')?.addEventListener('click', async () => {
      if (!this.deferredPrompt) return;
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      if (outcome === 'accepted') this.showToast('🎉 Smart Learning berhasil diinstall!', 'success');
      this.deferredPrompt = null;
      document.getElementById('installBanner')?.classList.remove('show');
    });

    document.getElementById('dismissInstall')?.addEventListener('click', () => {
      document.getElementById('installBanner')?.classList.remove('show');
    });
  },

  // ============================================================
  // NETWORK STATUS  +  OFFLINE QUEUE FLUSH
  // ============================================================
  setupNetworkStatus() {
    const badge  = document.getElementById('offlineBadge');
    const update = () => {
      if (!navigator.onLine) {
        badge.classList.add('show');
        this.showToast('⚡ Offline — data disimpan lokal!', 'warning');
      } else {
        badge.classList.remove('show');
        // Flush pending sync queue saat kembali online
        setTimeout(() => this._flushSyncQueue(), 1500);
      }
    };
    window.addEventListener('online',  update);
    window.addEventListener('offline', update);
    update();
  },

  // ============================================================
  // MISC HELPERS
  // ============================================================
  showExcelTemplateModal() { Audio.click(); this.showModal('excelTemplateModal'); },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

}; // end App

// ============================================================
// HEADER BUTTON HANDLERS  (outside App object)
// ============================================================
document.getElementById('darkModeToggle')?.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  App.toggleDarkMode(!dark);
  document.getElementById('darkModeSwitch').checked = !dark;
});

document.getElementById('soundToggle')?.addEventListener('click', () => {
  App.settings.sound = !App.settings.sound;
  document.getElementById('soundSwitch').checked     = App.settings.sound;
  document.getElementById('soundToggle').textContent = App.settings.sound ? '🔊' : '🔇';
  App.saveSettings();
});

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.setupModalCloseOnOverlay();
});
