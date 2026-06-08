/**
 * Smart Learning SD/MI - Main Application
 * Version: 1.0.0
 * A complete PWA for elementary school students (Grade 5-6)
 */

'use strict';

// ============================================================
// STORAGE UTILITIES
// ============================================================
const Storage = {
  get(key, defaultVal = null) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : defaultVal;
    } catch { return defaultVal; }
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
  musicGain: null,
  musicSource: null,
  isPlaying: false,

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.ctx.destination);
    } catch(e) {
      console.log('AudioContext not supported');
    }
  },

  playTone(freq, duration, type = 'sine', vol = 0.3) {
    if (!App.settings.sound || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch(e) {}
  },

  click() { this.playTone(800, 0.05, 'square', 0.2); },
  correct() {
    this.playTone(523, 0.1);
    setTimeout(() => this.playTone(659, 0.1), 100);
    setTimeout(() => this.playTone(784, 0.2), 200);
  },
  wrong() {
    this.playTone(300, 0.15, 'sawtooth', 0.2);
    setTimeout(() => this.playTone(200, 0.2, 'sawtooth', 0.2), 150);
  },
  complete() {
    [523, 587, 659, 698, 784, 880].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 0.15), i * 80);
    });
  },
  startMusic() {
    if (!this.ctx || !App.settings.music) return;
    // Simple looping background music using oscillators
    this.isPlaying = true;
  },
  stopMusic() {
    this.isPlaying = false;
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch(e){}
    }
  }
};

// ============================================================
// MAIN APP OBJECT
// ============================================================
const App = {

  // --- State ---
  currentScreen: 'homeScreen',
  currentExam: null,
  currentQuestion: 0,
  answers: {},
  timer: null,
  timerSeconds: 0,
  examStartTime: null,
  pinTarget: null,
  pinBuffer: '',
  examMode: 'exam',
  currentFilterSubject: 'all',

  // --- Settings ---
  settings: {
    darkMode: false,
    sound: true,
    music: false,
    shuffle: true,
    shuffleAnswers: true,
    pin: '123456',
    resultMode: 'direct'
  },

  // --------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------
  async init() {
    // Show loading
    document.getElementById('loadingScreen').style.display = 'flex';

    // Load settings
    const saved = Storage.get('sl_settings');
    if (saved) this.settings = { ...this.settings, ...saved };

    // Apply dark mode
    if (this.settings.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.getElementById('darkModeSwitch').checked = true;
      document.getElementById('darkModeToggle').textContent = '☀️';
    }

    // Apply setting switches
    document.getElementById('soundSwitch').checked = this.settings.sound;
    document.getElementById('musicSwitch').checked = this.settings.music;
    document.getElementById('shuffleSwitch').checked = this.settings.shuffle;
    document.getElementById('shuffleAnswersSwitch').checked = this.settings.shuffleAnswers;

    // Load or initialize data
    await this.initData();

    // Init audio
    Audio.init();

    // Build stars background
    this.createStarsBg();

    // Update home stats
    this.updateHomeStats();

    // Update greeting
    this.updateGreeting();

    // Populate subject filters
    this.populateSubjectSelects();

    // Populate history filter
    this.populateHistoryFilter();

    // Register service worker
    this.registerServiceWorker();

    // PWA install prompt
    this.setupInstallPrompt();

    // Network status
    this.setupNetworkStatus();

    // Handle exam timer select
    document.getElementById('examTimer').addEventListener('change', (e) => {
      const customGroup = document.getElementById('customTimerGroup');
      customGroup.classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Hide loading after 1.5s
    setTimeout(() => {
      const loading = document.getElementById('loadingScreen');
      loading.style.transition = 'opacity 0.5s';
      loading.style.opacity = '0';
      setTimeout(() => loading.style.display = 'none', 500);
    }, 1500);
  },

  // --------------------------------------------------------
  // DATA INITIALIZATION
  // --------------------------------------------------------
  async initData() {
    const existing = Storage.get('sl_subjects');
    if (!existing) {
      // Try loading from JSON file
      try {
        const resp = await fetch('./questions-data.json');
        const data = await resp.json();
        Storage.set('sl_subjects', data.subjects);
        Storage.set('sl_questions', data.questions);
      } catch (e) {
        // Fallback default data
        this.setDefaultData();
      }
    } else {
      // Check if questions exist
      const q = Storage.get('sl_questions');
      if (!q || q.length === 0) {
        try {
          const resp = await fetch('./questions-data.json');
          const data = await resp.json();
          Storage.set('sl_questions', data.questions);
        } catch {
          this.setDefaultData();
        }
      }
    }
  },

  setDefaultData() {
    const defaultSubjects = [
      { id: 'math', name: 'Matematika', icon: '🔢', color: '#FF6B6B' },
      { id: 'science', name: 'IPA', icon: '🔬', color: '#4ECDC4' },
      { id: 'indonesian', name: 'Bahasa Indonesia', icon: '📚', color: '#45B7D1' }
    ];
    Storage.set('sl_subjects', defaultSubjects);
    Storage.set('sl_questions', []);
  },

  getSubjects() { return Storage.get('sl_subjects', []); },
  getQuestions() { return Storage.get('sl_questions', []); },
  getHistory() { return Storage.get('sl_history', []); },

  // --------------------------------------------------------
  // SCREEN NAVIGATION
  // --------------------------------------------------------
  showScreen(id) {
    Audio.click();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    this.currentScreen = id;
    window.scrollTo(0, 0);

    // Refresh content based on screen
    if (id === 'homeScreen') {
      this.updateHomeStats();
      this.renderRecentActivity();
    } else if (id === 'questionsScreen') {
      this.renderQuestionList();
    } else if (id === 'subjectsScreen') {
      this.renderSubjectList();
    } else if (id === 'historyScreen') {
      this.renderHistory();
      this.renderRanking();
      this.renderStats();
    }
  },

  // --------------------------------------------------------
  // HOME
  // --------------------------------------------------------
  updateGreeting() {
    const now = new Date();
    const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const hour = now.getHours();
    let greet = hour < 11 ? '🌅 Selamat Pagi!' : hour < 15 ? '☀️ Selamat Siang!' : hour < 18 ? '🌤️ Selamat Sore!' : '🌙 Selamat Malam!';
    document.getElementById('greetingDate').textContent =
      `${greet} ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  },

  updateHomeStats() {
    const history = this.getHistory();
    const exams = history.length;
    document.getElementById('statExams').textContent = exams;
    if (exams > 0) {
      const avg = Math.round(history.reduce((a, b) => a + b.score, 0) / exams);
      const best = Math.max(...history.map(h => h.score));
      document.getElementById('statAvg').textContent = avg;
      document.getElementById('statBest').textContent = best;
    } else {
      document.getElementById('statAvg').textContent = '-';
      document.getElementById('statBest').textContent = '-';
    }
  },

  renderRecentActivity() {
    const history = this.getHistory();
    const container = document.getElementById('recentActivity');
    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">📭</span>
        <div class="empty-title">Belum ada aktivitas</div>
        <div class="empty-desc">Mulai ujian atau mode belajar untuk melihat aktivitasmu!</div>
      </div>`;
      return;
    }
    const recent = history.slice(-3).reverse();
    container.innerHTML = recent.map(h => this.historyCardHTML(h)).join('');
  },

  historyCardHTML(h) {
    const subjects = this.getSubjects();
    const subj = subjects.find(s => s.id === h.subjectId) || { name: h.subjectId, icon: '📚', color: '#4361ee' };
    const scoreColor = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--orange)' : 'var(--red)';
    const date = new Date(h.date);
    const dateStr = `${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
    return `<div class="history-card" onclick="App.viewHistoryDetail('${h.id}')">
      <div class="history-icon" style="background:${subj.color}22">${subj.icon}</div>
      <div class="history-info">
        <div class="history-name">${this.escapeHtml(h.studentName)}</div>
        <div class="history-meta">${subj.name} · ${h.studentClass} · ${dateStr}</div>
        <div class="history-meta">⏱️ ${h.timeTaken || '-'} · ${h.totalQuestions} soal · ${h.mode === 'learning' ? '📖 Belajar' : '📋 Ujian'}</div>
      </div>
      <div class="history-score" style="color:${scoreColor}">${h.score}</div>
    </div>`;
  },

  // --------------------------------------------------------
  // EXAM SETUP
  // --------------------------------------------------------
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
    const selects = ['examSubject', 'qSubjectSelect', 'historyFilter', 'rankingFilter'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const isFilter = id.includes('Filter');
      el.innerHTML = isFilter ? '<option value="">Semua Mapel</option>' : '';
      subjects.forEach(s => {
        el.innerHTML += `<option value="${s.id}">${s.icon} ${s.name}</option>`;
      });
    });
    this.buildSubjectFilterTabs();
  },

  populateHistoryFilter() {
    this.populateSubjectSelects();
  },

  // --------------------------------------------------------
  // START EXAM
  // --------------------------------------------------------
  startExam() {
    const studentName = document.getElementById('studentName').value.trim();
    const studentClass = document.getElementById('studentClass').value;
    const subjectId = document.getElementById('examSubject').value;
    const mode = document.getElementById('examMode').value;
    const resultMode = document.getElementById('resultMode').value;
    const qCount = parseInt(document.getElementById('questionCount').value);

    if (!studentName) {
      this.showToast('⚠️ Masukkan nama siswa dulu!', 'warning');
      document.getElementById('studentName').focus();
      return;
    }
    if (!subjectId) {
      this.showToast('⚠️ Pilih mata pelajaran dulu!', 'warning');
      return;
    }

    // Get timer
    let timerMin = 30;
    if (mode !== 'learning') {
      const timerSel = document.getElementById('examTimer').value;
      if (timerSel === 'custom') {
        timerMin = parseInt(document.getElementById('customTimer').value) || 30;
      } else {
        timerMin = parseInt(timerSel);
      }
    } else {
      timerMin = 0; // no timer for learning mode
    }

    // Get questions for subject
    const allQ = this.getQuestions().filter(q => q.subjectId === subjectId);
    if (allQ.length === 0) {
      this.showToast('❌ Tidak ada soal untuk mata pelajaran ini!', 'error');
      return;
    }

    // Shuffle if needed
    let questions = [...allQ];
    if (this.settings.shuffle) {
      questions = this.shuffleArray(questions);
    }
    questions = questions.slice(0, Math.min(qCount, questions.length));

    // Shuffle answer options if needed
    if (this.settings.shuffleAnswers) {
      questions = questions.map(q => this.shuffleOptions(q));
    }

    this.currentExam = {
      id: 'exam_' + Date.now(),
      studentName,
      studentClass,
      subjectId,
      questions,
      mode,
      resultMode,
      timerMin
    };
    this.currentQuestion = 0;
    this.answers = {};
    this.examStartTime = Date.now();
    this.examMode = mode;

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
    const optLetters = ['A','B','C','D'];
    const opts = q.options.map((opt, i) => ({ letter: optLetters[i], text: opt }));
    // Shuffle
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    // Find new answer letter
    const originalAnswer = q.answer; // e.g., "B"
    const originalText = q.options[optLetters.indexOf(originalAnswer)]; // the correct answer text
    const newAnswerLetter = optLetters[opts.findIndex(o => o.text === originalText)];
    return {
      ...q,
      options: opts.map((o, i) => `${optLetters[i]}. ${o.text.replace(/^[A-D]\.\s*/, '')}`),
      answer: newAnswerLetter,
      _shuffled: true,
      _originalOptions: opts
    };
  },

  setupExamUI() {
    const exam = this.currentExam;
    const subj = this.getSubjects().find(s => s.id === exam.subjectId);
    document.getElementById('examSubjectDisplay').textContent =
      (subj ? subj.icon + ' ' + subj.name : exam.subjectId);
    document.getElementById('timerDisplay').style.display = '';

    // Build question grid
    this.renderQuestionGrid();
  },

  renderQuestionGrid() {
    const exam = this.currentExam;
    const grid = document.getElementById('questionGrid');
    grid.innerHTML = exam.questions.map((q, i) => {
      let cls = i === this.currentQuestion ? 'current' : '';
      if (this.answers[i] !== undefined) cls = i === this.currentQuestion ? 'current' : 'answered';
      return `<button class="q-num-btn ${cls}" onclick="App.jumpToQuestion(${i})">${i + 1}</button>`;
    }).join('');
  },

  toggleQGrid() {
    const grid = document.getElementById('questionGrid');
    const isHidden = grid.style.display === 'none' || !grid.style.display;
    grid.style.display = isHidden ? 'flex' : 'none';
  },

  renderQuestion() {
    const exam = this.currentExam;
    const q = exam.questions[this.currentQuestion];
    const total = exam.questions.length;
    const current = this.currentQuestion;

    // Update progress
    document.getElementById('examProgressText').textContent =
      `Soal ${current + 1} dari ${total}`;
    document.getElementById('qBadgeText').textContent = `Soal ${current + 1}`;
    document.getElementById('examProgressBar').style.width =
      `${((current + 1) / total) * 100}%`;

    // Question text
    document.getElementById('questionText').textContent = q.question;

    // Show/hide question image
    let qImgEl = document.getElementById('questionImage');
    if (!qImgEl) {
      // Create image element once and insert after questionText
      qImgEl = document.createElement('img');
      qImgEl.id = 'questionImage';
      qImgEl.style.cssText = 'width:100%;max-height:200px;object-fit:contain;border-radius:12px;margin:10px 0 4px;border:2px solid var(--border);background:var(--bg);display:none;';
      document.getElementById('questionText').after(qImgEl);
    }
    if (q.imageData) {
      qImgEl.src = q.imageData;
      qImgEl.style.display = 'block';
    } else {
      qImgEl.src = '';
      qImgEl.style.display = 'none';
    }

    // Options - parse the option text
    const optLetters = ['A','B','C','D'];
    const optionsHTML = q.options.map((opt, i) => {
      const letter = optLetters[i];
      const text = opt.replace(/^[A-D]\.\s*/, '');
      const isSelected = this.answers[current] === letter;
      let cls = isSelected ? 'selected' : '';

      // If learning mode and already answered
      if (exam.mode === 'learning' && this.answers[current] !== undefined) {
        if (letter === q.answer) cls = 'correct';
        else if (letter === this.answers[current]) cls = 'wrong';
      }

      return `<button class="option-btn ${cls}" onclick="App.selectOption('${letter}', ${i})">
        <span class="option-badge">${letter}</span>
        <span>${text}</span>
      </button>`;
    }).join('');
    document.getElementById('optionsList').innerHTML = optionsHTML;

    // Show explanation if learning mode and answered
    const explBox = document.getElementById('explanationBox');
    if (exam.mode === 'learning' && this.answers[current] !== undefined) {
      document.getElementById('explanationText').textContent = q.explanation || 'Tidak ada pembahasan.';
      explBox.classList.add('show');
    } else {
      explBox.classList.remove('show');
    }

    // Navigation buttons
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const finishBtn = document.getElementById('finishBtn');

    prevBtn.classList.toggle('hidden', current === 0);
    if (current === total - 1) {
      nextBtn.classList.add('hidden');
      finishBtn.classList.remove('hidden');
    } else {
      nextBtn.classList.remove('hidden');
      finishBtn.classList.add('hidden');
    }

    // Update grid
    this.renderQuestionGrid();
  },

  selectOption(letter, idx) {
    const exam = this.currentExam;
    const q = exam.questions[this.currentQuestion];

    // In exam mode, allow changing answer
    // In learning mode, lock after first answer
    if (exam.mode === 'learning' && this.answers[this.currentQuestion] !== undefined) return;

    this.answers[this.currentQuestion] = letter;
    Audio.click();

    if (exam.mode === 'learning') {
      if (letter === q.answer) {
        Audio.correct();
      } else {
        Audio.wrong();
      }
    }

    this.renderQuestion();
  },

  prevQuestion() {
    Audio.click();
    if (this.currentQuestion > 0) {
      this.currentQuestion--;
      this.renderQuestion();
    }
  },

  nextQuestion() {
    Audio.click();
    const total = this.currentExam.questions.length;
    if (this.currentQuestion < total - 1) {
      this.currentQuestion++;
      this.renderQuestion();
    }
  },

  jumpToQuestion(n) {
    Audio.click();
    this.currentQuestion = n;
    this.renderQuestion();
    this.toggleQGrid();
  },

  // --------------------------------------------------------
  // TIMER
  // --------------------------------------------------------
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
    const m = Math.floor(this.timerSeconds / 60);
    const s = this.timerSeconds % 60;
    const display = document.getElementById('timerDisplay');
    document.getElementById('timerTime').textContent =
      `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    display.classList.remove('warning', 'danger');
    if (this.timerSeconds <= 60) display.classList.add('danger');
    else if (this.timerSeconds <= 300) display.classList.add('warning');
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  getTimeTaken() {
    const elapsed = Math.floor((Date.now() - this.examStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  },

  // --------------------------------------------------------
  // FINISH EXAM
  // --------------------------------------------------------
  finishExam(timeout = false) {
    this.stopTimer();
    Audio.click();

    const exam = this.currentExam;
    const questions = exam.questions;
    let correct = 0, wrong = 0, skipped = 0;

    questions.forEach((q, i) => {
      if (this.answers[i] === undefined) skipped++;
      else if (this.answers[i] === q.answer) correct++;
      else wrong++;
    });

    const total = questions.length;
    const score = Math.round((correct / total) * 100);
    const timeTaken = this.getTimeTaken();

    const result = {
      id: 'result_' + Date.now(),
      examId: exam.id,
      studentName: exam.studentName,
      studentClass: exam.studentClass,
      subjectId: exam.subjectId,
      date: new Date().toISOString(),
      score,
      correct,
      wrong,
      skipped,
      totalQuestions: total,
      timeTaken,
      mode: exam.mode,
      resultMode: exam.resultMode,
      answers: { ...this.answers },
      questions: questions.map(q => ({
        id: q.id, question: q.question, options: q.options,
        answer: q.answer, explanation: q.explanation,
        userAnswer: this.answers[questions.indexOf(q)]
      }))
    };

    // Save to history
    const history = this.getHistory();
    history.push(result);
    Storage.set('sl_history', history);

    if (exam.resultMode === 'delayed') {
      this.showScreen('delayedResultScreen');
      this.showToast('✅ Hasil tersimpan! Guru akan membuka hasilnya.', 'success');
    } else {
      this.showResult(result);
    }
  },

  // --------------------------------------------------------
  // SHOW RESULT
  // --------------------------------------------------------
  showResult(result) {
    this.showScreen('resultScreen');

    const { score, correct, wrong, skipped, totalQuestions, timeTaken, studentName } = result;

    // Emoji based on score
    let emoji = score >= 90 ? '🌟' : score >= 80 ? '😄' : score >= 70 ? '😊' : score >= 60 ? '😐' : '😢';
    document.getElementById('resultEmoji').textContent = emoji;
    document.getElementById('resultScore').textContent = score;
    document.getElementById('resultLabel').textContent = `${studentName} · ${timeTaken}`;
    document.getElementById('resultCorrect').textContent = correct;
    document.getElementById('resultWrong').textContent = wrong;
    document.getElementById('resultTime').textContent = timeTaken;

    // Gradient based on score
    const card = document.getElementById('resultCard');
    if (score >= 90) card.style.background = 'linear-gradient(135deg, #ffd60a, #fb8500)';
    else if (score >= 80) card.style.background = 'linear-gradient(135deg, #06d6a0, #4cc9f0)';
    else if (score >= 60) card.style.background = 'linear-gradient(135deg, #4361ee, #7209b7)';
    else card.style.background = 'linear-gradient(135deg, #ef233c, #f72585)';

    // Badges
    const badges = [];
    if (score >= 90) badges.push({ icon: '🏆', label: 'Juara!' });
    if (score >= 80) badges.push({ icon: '🌟', label: 'Cerdas!' });
    if (score >= 70) badges.push({ icon: '👍', label: 'Hebat!' });
    if (correct === totalQuestions) badges.push({ icon: '💯', label: 'Sempurna!' });
    if (result.timeTaken && result.timeTaken < '10:00') badges.push({ icon: '⚡', label: 'Cepat!' });

    document.getElementById('badgeDisplay').innerHTML = badges.map(b =>
      `<div class="badge">${b.icon} ${b.label}</div>`
    ).join('');

    // Info
    document.getElementById('resultInfo').innerHTML = `
      <div class="card" style="text-align:center">
        <div style="font-size:13px;color:var(--text-muted);font-weight:700">
          ${result.subjectId ? (this.getSubjects().find(s=>s.id===result.subjectId)||{name:result.subjectId}).name : ''} · 
          ${result.studentClass} · ${new Date(result.date).toLocaleDateString('id-ID')}
        </div>
        <div style="margin-top:8px;font-size:14px;font-weight:700">
          ${this.getScoreMessage(score)}
        </div>
      </div>`;

    // Review answers
    const review = result.questions || [];
    document.getElementById('answerReview').innerHTML = review.map((q, i) => {
      const userAns = result.answers[i];
      const isCorrect = userAns === q.answer;
      return `<div class="review-item">
        <div class="q-num">Soal ${i+1}</div>
        <div class="q-text-sm">${this.escapeHtml(q.question || '')}</div>
        <div class="review-answers">
          <span class="answer-pill ${isCorrect ? 'user-correct' : 'user-wrong'}">
            ${userAns ? '✏️ Jawabanmu: ' + userAns : '⏭️ Dilewati'}
          </span>
          ${!isCorrect ? `<span class="answer-pill correct-answer">✅ Benar: ${q.answer}</span>` : ''}
        </div>
        ${q.explanation ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;padding:8px;background:var(--bg);border-radius:8px;font-weight:600">💡 ${this.escapeHtml(q.explanation)}</div>` : ''}
      </div>`;
    }).join('');

    // Celebration
    if (score >= 80) {
      Audio.complete();
      this.celebrate();
    }
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
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.cssText = `
        left: ${Math.random() * 100}%;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        width: ${6 + Math.random() * 8}px;
        height: ${6 + Math.random() * 8}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        animation-duration: ${1.5 + Math.random() * 2}s;
        animation-delay: ${Math.random() * 0.5}s;
      `;
      container.appendChild(conf);
    }
    setTimeout(() => { container.innerHTML = ''; }, 4000);
  },

  exportResultPDF() {
    this.showToast('📄 Mengekspor hasil...', 'info');
    // Build printable content
    const result = this.getHistory().slice(-1)[0];
    if (!result) return;

    const subj = this.getSubjects().find(s => s.id === result.subjectId) || { name: result.subjectId };
    const printContent = `
      <html><head><title>Hasil Ujian - ${result.studentName}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #4361ee; }
        .stat { display: inline-block; margin: 8px; padding: 12px 20px; border-radius: 8px; background: #f0f4ff; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 8px; border: 1px solid #ddd; text-align: left; font-size: 12px; }
        th { background: #4361ee; color: white; }
        .correct { color: green; }
        .wrong { color: red; }
      </style></head><body>
      <h1>🎓 Smart Learning SD/MI</h1>
      <h2>Hasil Ujian</h2>
      <p><b>Nama:</b> ${result.studentName} | <b>Kelas:</b> ${result.studentClass}</p>
      <p><b>Mapel:</b> ${subj.name} | <b>Tanggal:</b> ${new Date(result.date).toLocaleDateString('id-ID')}</p>
      <p><b>Waktu:</b> ${result.timeTaken}</p>
      <div class="stat"><b>Nilai: ${result.score}</b></div>
      <div class="stat">✅ Benar: ${result.correct}</div>
      <div class="stat">❌ Salah: ${result.wrong}</div>
      <div class="stat">Total: ${result.totalQuestions}</div>
      </body></html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(printContent);
      win.document.close();
      win.print();
    }
  },

  // --------------------------------------------------------
  // HISTORY
  // --------------------------------------------------------
  showHistory() {
    this.populateSubjectSelects();
    this.showScreen('historyScreen');
  },

  switchHistoryTab(tab, btn) {
    Audio.click();
    document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('historyTab').classList.toggle('hidden', tab !== 'history');
    document.getElementById('rankingTab').classList.toggle('hidden', tab !== 'ranking');
    document.getElementById('statsTab').classList.toggle('hidden', tab !== 'stats');
    if (tab === 'ranking') this.renderRanking();
    if (tab === 'stats') this.renderStats();
  },

  renderHistory() {
    const filter = document.getElementById('historyFilter')?.value || '';
    let history = this.getHistory();
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
    const history = this.getHistory();
    const result = history.find(h => h.id === id);
    if (!result) return;

    if (result.resultMode === 'delayed') {
      this.pinTarget = { action: 'view-delayed', data: result };
      this.showModal('pinModal');
    } else {
      this.showResult(result);
    }
  },

  renderRanking() {
    const filter = document.getElementById('rankingFilter')?.value || '';
    let history = this.getHistory();
    if (filter) history = history.filter(h => h.subjectId === filter);

    // Group by student name, keep best score
    const byStudent = {};
    history.forEach(h => {
      const key = h.studentName + '_' + h.studentClass;
      if (!byStudent[key] || h.score > byStudent[key].score) {
        byStudent[key] = h;
      }
    });

    const ranked = Object.values(byStudent).sort((a, b) => b.score - a.score);
    const container = document.getElementById('rankingList');

    if (ranked.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">🏆</span>
        <div class="empty-title">Belum ada ranking</div>
        <div class="empty-desc">Selesaikan ujian untuk masuk ranking!</div>
      </div>`;
      return;
    }

    const medals = ['🥇','🥈','🥉'];
    container.innerHTML = ranked.map((h, i) => {
      const medal = medals[i] || `#${i+1}`;
      const scoreColor = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--orange)' : 'var(--red)';
      const subj = this.getSubjects().find(s => s.id === h.subjectId) || { name: h.subjectId };
      return `<div class="ranking-item">
        <div class="rank-num">${medal}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px">${this.escapeHtml(h.studentName)}</div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:600">${h.studentClass} · ${subj.name}</div>
        </div>
        <div style="font-family:var(--font-display);font-size:24px;color:${scoreColor}">${h.score}</div>
      </div>`;
    }).join('');
  },

  renderStats() {
    const history = this.getHistory();
    const container = document.getElementById('statsContent');

    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">📈</span>
        <div class="empty-title">Belum ada statistik</div>
      </div>`;
      return;
    }

    const total = history.length;
    const avg = Math.round(history.reduce((a, h) => a + h.score, 0) / total);
    const best = Math.max(...history.map(h => h.score));
    const worst = Math.min(...history.map(h => h.score));
    const passing = history.filter(h => h.score >= 70).length;

    // By subject
    const subjects = this.getSubjects();
    const bySubject = {};
    history.forEach(h => {
      if (!bySubject[h.subjectId]) bySubject[h.subjectId] = [];
      bySubject[h.subjectId].push(h.score);
    });

    const subjectStats = subjects.map(s => {
      const scores = bySubject[s.id] || [];
      if (scores.length === 0) return null;
      return {
        subj: s,
        count: scores.length,
        avg: Math.round(scores.reduce((a,b) => a+b, 0) / scores.length),
        best: Math.max(...scores)
      };
    }).filter(Boolean);

    container.innerHTML = `
      <div class="card">
        <div style="font-family:var(--font-display);font-size:18px;margin-bottom:16px">📊 Ringkasan</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${[
            ['📝 Total Ujian', total],
            ['⭐ Rata-rata', avg],
            ['🏆 Tertinggi', best],
            ['📉 Terendah', worst],
            ['✅ Lulus (≥70)', passing],
            ['📊 % Kelulusan', Math.round((passing/total)*100) + '%']
          ].map(([label, val]) => `
            <div style="background:var(--bg);border-radius:12px;padding:12px;text-align:center">
              <div style="font-size:10px;color:var(--text-muted);font-weight:700">${label}</div>
              <div style="font-family:var(--font-display);font-size:22px;color:var(--primary)">${val}</div>
            </div>`
          ).join('')}
        </div>
      </div>
      <div class="card">
        <div style="font-family:var(--font-display);font-size:18px;margin-bottom:12px">📚 Per Mata Pelajaran</div>
        ${subjectStats.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:24px">${s.subj.icon}</span>
            <div style="flex:1">
              <div style="font-weight:700">${s.subj.name}</div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600">${s.count} ujian · Terbaik: ${s.best}</div>
            </div>
            <div style="font-family:var(--font-display);font-size:22px;color:var(--primary)">${s.avg}</div>
          </div>`
        ).join('')}
      </div>`;
  },

  clearHistory() {
    this.showConfirm('🗑️ Hapus Riwayat', 'Semua riwayat ujian akan dihapus permanen. Lanjutkan?', () => {
      Storage.set('sl_history', []);
      this.renderHistory();
      this.updateHomeStats();
      this.showToast('🗑️ Riwayat berhasil dihapus!', 'success');
    });
  },

  // --------------------------------------------------------
  // QUESTION MANAGEMENT
  // --------------------------------------------------------
  buildSubjectFilterTabs() {
    const subjects = this.getSubjects();
    const tabs = document.getElementById('subjectFilterTabs');
    if (!tabs) return;
    tabs.innerHTML = `<button class="tab-btn active" onclick="App.filterBySubject('all', this)">📋 Semua</button>` +
      subjects.map(s =>
        `<button class="tab-btn" onclick="App.filterBySubject('${s.id}', this)">${s.icon} ${s.name}</button>`
      ).join('');
  },

  filterBySubject(id, btn) {
    Audio.click();
    document.querySelectorAll('#subjectFilterTabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.currentFilterSubject = id;
    this.renderQuestionList();
  },

  searchQuestions() {
    this.renderQuestionList();
  },

  renderQuestionList() {
    const allQ = this.getQuestions();
    const search = (document.getElementById('questionSearch')?.value || '').toLowerCase();
    const filter = this.currentFilterSubject;
    const subjects = this.getSubjects();

    let questions = allQ;
    if (filter && filter !== 'all') questions = questions.filter(q => q.subjectId === filter);
    if (search) questions = questions.filter(q =>
      q.question.toLowerCase().includes(search) ||
      q.options?.some(o => o.toLowerCase().includes(search))
    );

    const container = document.getElementById('questionList');
    if (questions.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">🔍</span>
        <div class="empty-title">Tidak ada soal</div>
        <div class="empty-desc">Tambah soal baru atau ubah filter pencarian!</div>
      </div>`;
      return;
    }

    container.innerHTML = questions.map(q => {
      const subj = subjects.find(s => s.id === q.subjectId) || { name: q.subjectId, icon: '📚', color: '#4361ee' };
      const imgBadge = q.imageData ? `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:99px;background:rgba(76,201,240,0.15);color:var(--accent2);font-size:10px;font-weight:700;margin-left:6px;">🖼️ Bergambar</span>` : '';
      return `<div class="question-list-item">
        <div class="q-content">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
            <span class="q-subject-tag" style="background:${subj.color}22;color:${subj.color}">${subj.icon} ${subj.name}</span>${imgBadge}
          </div>
          <div class="q-text-preview">${this.escapeHtml(q.question)}</div>
          <div style="font-size:11px;color:var(--green);font-weight:700;margin-top:4px">✅ Jawaban: ${q.answer}</div>
        </div>
        <div class="q-actions">
          <button class="action-btn edit" onclick="App.editQuestion('${q.id}')">✏️</button>
          <button class="action-btn delete" onclick="App.deleteQuestion('${q.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  },

  showAddQuestion() {
    document.getElementById('questionModalTitle').textContent = '➕ Tambah Soal';
    document.getElementById('editQuestionId').value = '';
    document.getElementById('qImageData').value = '';
    document.getElementById('qText').value = '';
    document.getElementById('qOptionA').value = '';
    document.getElementById('qOptionB').value = '';
    document.getElementById('qOptionC').value = '';
    document.getElementById('qOptionD').value = '';
    document.getElementById('qAnswer').value = 'A';
    document.getElementById('qExplanation').value = '';
    // Reset image preview
    document.getElementById('qImagePreviewWrap').style.display = 'none';
    document.getElementById('qImagePreview').src = '';
    document.getElementById('qImageFile').value = '';

    // Populate subject select
    const subjects = this.getSubjects();
    document.getElementById('qSubjectSelect').innerHTML = subjects.map(s =>
      `<option value="${s.id}">${s.icon} ${s.name}</option>`
    ).join('');

    this.showModal('questionModal');
  },

  // Image upload handler
  handleQuestionImage(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.showToast('⚠️ Gambar terlalu besar! Maksimal 2MB.', 'warning');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      document.getElementById('qImageData').value = dataUrl;
      document.getElementById('qImagePreview').src = dataUrl;
      document.getElementById('qImagePreviewWrap').style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  removeQuestionImage() {
    document.getElementById('qImageData').value = '';
    document.getElementById('qImagePreview').src = '';
    document.getElementById('qImagePreviewWrap').style.display = 'none';
    document.getElementById('qImageFile').value = '';
  },

  editQuestion(id) {
    const q = this.getQuestions().find(q => q.id === id);
    if (!q) return;

    document.getElementById('questionModalTitle').textContent = '✏️ Edit Soal';
    document.getElementById('editQuestionId').value = id;
    document.getElementById('qText').value = q.question;

    // Load image if exists
    document.getElementById('qImageData').value = q.imageData || '';
    document.getElementById('qImageFile').value = '';
    if (q.imageData) {
      document.getElementById('qImagePreview').src = q.imageData;
      document.getElementById('qImagePreviewWrap').style.display = 'block';
    } else {
      document.getElementById('qImagePreview').src = '';
      document.getElementById('qImagePreviewWrap').style.display = 'none';
    }

    const subjects = this.getSubjects();
    document.getElementById('qSubjectSelect').innerHTML = subjects.map(s =>
      `<option value="${s.id}" ${s.id === q.subjectId ? 'selected' : ''}>${s.icon} ${s.name}</option>`
    ).join('');

    const optLetters = ['A','B','C','D'];
    const ids = ['qOptionA','qOptionB','qOptionC','qOptionD'];
    q.options.forEach((opt, i) => {
      document.getElementById(ids[i]).value = opt.replace(/^[A-D]\.\s*/, '');
    });
    document.getElementById('qAnswer').value = q.answer;
    document.getElementById('qExplanation').value = q.explanation || '';

    this.showModal('questionModal');
  },

  saveQuestion() {
    const qText = document.getElementById('qText').value.trim();
    const optA = document.getElementById('qOptionA').value.trim();
    const optB = document.getElementById('qOptionB').value.trim();
    const optC = document.getElementById('qOptionC').value.trim();
    const optD = document.getElementById('qOptionD').value.trim();
    const answer = document.getElementById('qAnswer').value;
    const explanation = document.getElementById('qExplanation').value.trim();
    const subjectId = document.getElementById('qSubjectSelect').value;
    const editId = document.getElementById('editQuestionId').value;
    const imageData = document.getElementById('qImageData').value || '';

    if (!qText || !optA || !optB || !optC || !optD) {
      this.showToast('⚠️ Lengkapi semua kolom soal!', 'warning');
      return;
    }

    const questions = this.getQuestions();
    const questionData = {
      id: editId || 'q_' + Date.now(),
      subjectId,
      question: qText,
      options: [`A. ${optA}`, `B. ${optB}`, `C. ${optC}`, `D. ${optD}`],
      answer,
      explanation,
      imageData: imageData || null
    };

    if (editId) {
      const idx = questions.findIndex(q => q.id === editId);
      if (idx >= 0) questions[idx] = questionData;
    } else {
      questions.push(questionData);
    }

    Storage.set('sl_questions', questions);
    this.closeModal('questionModal');
    this.renderQuestionList();
    this.showToast(editId ? '✅ Soal berhasil diubah!' : '✅ Soal berhasil ditambah!', 'success');
    Audio.correct();
  },

  deleteQuestion(id) {
    this.showConfirm('🗑️ Hapus Soal', 'Soal ini akan dihapus permanen. Lanjutkan?', () => {
      const questions = this.getQuestions().filter(q => q.id !== id);
      Storage.set('sl_questions', questions);
      this.renderQuestionList();
      this.showToast('🗑️ Soal berhasil dihapus!', 'success');
    });
  },

  importQuestionsJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const questions = Array.isArray(data) ? data : (data.questions || []);
          const existing = this.getQuestions();
          const merged = [...existing];
          let added = 0;
          questions.forEach(q => {
            if (q.question && q.options && q.answer) {
              if (!merged.find(e => e.id === q.id)) {
                merged.push({ ...q, id: q.id || 'q_' + Date.now() + '_' + added });
                added++;
              }
            }
          });
          Storage.set('sl_questions', merged);
          this.renderQuestionList();
          this.showToast(`✅ Berhasil import ${added} soal dari JSON!`, 'success');
        } catch {
          this.showToast('❌ File JSON tidak valid!', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  exportQuestionsJSON() {
    const questions = this.getQuestions();
    // Strip large imageData to keep JSON smaller if desired — here we keep it
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soal-smart-learning-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast(`📤 Berhasil export ${questions.length} soal ke JSON!`, 'success');
  },

  // --------------------------------------------------------
  // EXCEL IMPORT / EXPORT
  // --------------------------------------------------------

  /** Trigger the hidden file input for Excel */
  importQuestionsExcel() {
    document.getElementById('excelFileInput').value = '';
    document.getElementById('excelFileInput').click();
  },

  /** Process .xlsx/.xls/.csv chosen by user */
  processExcelFile(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
      // Parse CSV directly
      const reader = new FileReader();
      reader.onload = (e) => this._parseCSVToQuestions(e.target.result);
      reader.readAsText(file, 'UTF-8');
      return;
    }

    // For .xlsx/.xls — use SheetJS via CDN (loaded on demand)
    this._loadSheetJS(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          /* global XLSX */
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          this._importRowsToQuestions(rows);
        } catch(err) {
          this.showToast('❌ File Excel tidak dapat dibaca: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  },

  /** Dynamically load SheetJS from CDN */
  _loadSheetJS(cb) {
    if (window.XLSX) { cb(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = cb;
    sc.onerror = () => this.showToast('❌ Gagal memuat library Excel. Cek koneksi internet.', 'error');
    document.head.appendChild(sc);
  },

  /** Parse CSV text into questions */
  _parseCSVToQuestions(csvText) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    const rows = lines.map(l => {
      // handle quoted commas
      const result = [];
      let cur = '', inQ = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      result.push(cur.trim());
      return result;
    });
    this._importRowsToQuestions(rows);
  },

  /**
   * Convert sheet rows to question objects and merge into storage.
   * Row format (0-indexed cols):
   *   0:subjectId  1:question  2:optA  3:optB  4:optC  5:optD  6:answer  7:explanation
   * Row 0 is assumed to be a header and is skipped.
   */
  _importRowsToQuestions(rows) {
    const dataRows = rows.slice(1); // skip header
    const existing = this.getQuestions();
    const existingIds = new Set(existing.map(q => q.id));
    let added = 0, skipped = 0, errors = 0;

    const newQuestions = [...existing];
    dataRows.forEach((row, idx) => {
      const subjectId = String(row[0] || '').trim();
      const question  = String(row[1] || '').trim();
      const optA      = String(row[2] || '').trim();
      const optB      = String(row[3] || '').trim();
      const optC      = String(row[4] || '').trim();
      const optD      = String(row[5] || '').trim();
      const answer    = String(row[6] || '').trim().toUpperCase();
      const expl      = String(row[7] || '').trim();

      if (!subjectId || !question || !optA || !optB || !answer) {
        if (subjectId || question) errors++;
        return;
      }
      if (!['A','B','C','D'].includes(answer)) { errors++; return; }

      const id = 'excel_' + Date.now() + '_' + (idx + 1);
      if (existingIds.has(id)) { skipped++; return; }

      newQuestions.push({
        id,
        subjectId,
        question,
        options: [
          `A. ${optA}`,
          `B. ${optB}`,
          `C. ${optC || '-'}`,
          `D. ${optD || '-'}`
        ],
        answer,
        explanation: expl,
        imageData: null
      });
      added++;
    });

    Storage.set('sl_questions', newQuestions);
    this.renderQuestionList();
    let msg = `✅ Import selesai: ${added} soal ditambahkan`;
    if (errors) msg += `, ${errors} baris dilewati (data kurang lengkap)`;
    this.showToast(msg, added > 0 ? 'success' : 'warning');
  },

  /** Export current questions to .xlsx using SheetJS */
  exportQuestionsExcel() {
    const questions = this.getQuestions();
    if (questions.length === 0) {
      this.showToast('⚠️ Tidak ada soal untuk diekspor!', 'warning');
      return;
    }
    this._loadSheetJS(() => {
      const header = ['subjectId','question','optionA','optionB','optionC','optionD','answer','explanation'];
      const rows = questions.map(q => {
        const opts = (q.options || []).map(o => o.replace(/^[A-D]\.\s*/, ''));
        return [
          q.subjectId || '',
          q.question  || '',
          opts[0] || '', opts[1] || '', opts[2] || '', opts[3] || '',
          q.answer      || '',
          q.explanation || ''
        ];
      });

      /* global XLSX */
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

      // Column widths
      ws['!cols'] = [
        {wch:14},{wch:50},{wch:22},{wch:22},{wch:22},{wch:22},{wch:8},{wch:40}
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Soal');
      XLSX.writeFile(wb, `soal-smart-learning-${Date.now()}.xlsx`);
      this.showToast(`📊 Berhasil export ${questions.length} soal ke Excel!`, 'success');
    });
  },

  /** Download a blank Excel template with header + 3 example rows */
  downloadExcelTemplate() {
    this._loadSheetJS(() => {
      const header = ['subjectId','question','optionA','optionB','optionC','optionD','answer','explanation'];
      const examples = [
        ['math',       '2 + 2 = ?',                        '2',        '3',          '4',          '5',          'C', '2+2=4'],
        ['science',    'Planet terdekat dari matahari?',   'Venus',    'Bumi',       'Merkurius',  'Mars',       'C', 'Merkurius adalah planet pertama'],
        ['indonesian', 'Sinonim dari kata "rajin" adalah?','Malas',    'Tekun',      'Lambat',     'Lemah',      'B', 'Rajin = Tekun'],
      ];

      /* global XLSX */
      const ws = XLSX.utils.aoa_to_sheet([header, ...examples]);
      ws['!cols'] = [
        {wch:14},{wch:50},{wch:22},{wch:22},{wch:22},{wch:22},{wch:8},{wch:40}
      ];

      // Style header row (basic)
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (!ws[addr]) continue;
        ws[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '4361EE' } },
          alignment: { horizontal: 'center' }
        };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template Soal');

      // Add info sheet
      const info = [
        ['=== PANDUAN PENGISIAN ==='],
        [''],
        ['Kolom','Nama','Keterangan'],
        ['A','subjectId','ID mata pelajaran: math | science | indonesian | atau ID kustom'],
        ['B','question','Teks soal (wajib diisi)'],
        ['C','optionA','Teks pilihan A (wajib diisi)'],
        ['D','optionB','Teks pilihan B (wajib diisi)'],
        ['E','optionC','Teks pilihan C (boleh kosong → akan jadi tanda -)'],
        ['F','optionD','Teks pilihan D (boleh kosong → akan jadi tanda -)'],
        ['G','answer','Jawaban benar: A / B / C / D  (huruf kapital, wajib)'],
        ['H','explanation','Pembahasan / penjelasan jawaban (boleh kosong)'],
        [''],
        ['CATATAN:'],
        ['• Baris pertama (header) TIDAK diimpor, jangan dihapus'],
        ['• Soal bergambar tidak bisa diimport via Excel, gunakan form manual'],
        ['• ID mapel kustom: lihat ID di halaman Kelola Mapel'],
      ];
      const wsInfo = XLSX.utils.aoa_to_sheet(info);
      wsInfo['!cols'] = [{wch:8},{wch:15},{wch:60}];
      XLSX.utils.book_append_sheet(wb, wsInfo, 'Panduan');

      XLSX.writeFile(wb, 'template-soal-smart-learning.xlsx');
      this.showToast('📥 Template Excel berhasil diunduh!', 'success');
    });
  },

  // --------------------------------------------------------
  // SUBJECT MANAGEMENT
  // --------------------------------------------------------
  renderSubjectList() {
    const subjects = this.getSubjects();
    const questions = this.getQuestions();
    const container = document.getElementById('subjectList');

    if (subjects.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-emoji">📚</span>
        <div class="empty-title">Belum ada mata pelajaran</div>
      </div>`;
      return;
    }

    container.innerHTML = subjects.map(s => {
      const qCount = questions.filter(q => q.subjectId === s.id).length;
      return `<div class="subject-card">
        <div class="subject-icon-wrap" style="background:${s.color}22">${s.icon}</div>
        <div class="subject-info">
          <div class="subject-name">${this.escapeHtml(s.name)}</div>
          <div class="subject-count">${qCount} soal tersedia</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="action-btn edit" onclick="App.editSubject('${s.id}')">✏️</button>
          <button class="action-btn delete" onclick="App.deleteSubject('${s.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  },

  showAddSubject() {
    document.getElementById('subjectModalTitle').textContent = '➕ Tambah Mapel';
    document.getElementById('editSubjectId').value = '';
    document.getElementById('subjectName').value = '';
    document.getElementById('subjectIcon').value = '📚';
    document.getElementById('subjectColor').value = '#4361ee';
    this.showModal('subjectModal');
  },

  editSubject(id) {
    const subj = this.getSubjects().find(s => s.id === id);
    if (!subj) return;
    document.getElementById('subjectModalTitle').textContent = '✏️ Edit Mapel';
    document.getElementById('editSubjectId').value = id;
    document.getElementById('subjectName').value = subj.name;
    document.getElementById('subjectIcon').value = subj.icon;
    document.getElementById('subjectColor').value = subj.color;
    this.showModal('subjectModal');
  },

  saveSubject() {
    const name = document.getElementById('subjectName').value.trim();
    const icon = document.getElementById('subjectIcon').value.trim() || '📚';
    const color = document.getElementById('subjectColor').value;
    const editId = document.getElementById('editSubjectId').value;

    if (!name) {
      this.showToast('⚠️ Masukkan nama mata pelajaran!', 'warning');
      return;
    }

    const subjects = this.getSubjects();
    const subjData = {
      id: editId || 'subj_' + Date.now(),
      name, icon, color
    };

    if (editId) {
      const idx = subjects.findIndex(s => s.id === editId);
      if (idx >= 0) subjects[idx] = subjData;
    } else {
      subjects.push(subjData);
    }

    Storage.set('sl_subjects', subjects);
    this.closeModal('subjectModal');
    this.renderSubjectList();
    this.populateSubjectSelects();
    this.showToast(editId ? '✅ Mapel berhasil diubah!' : '✅ Mapel berhasil ditambah!', 'success');
  },

  deleteSubject(id) {
    const qCount = this.getQuestions().filter(q => q.subjectId === id).length;
    this.showConfirm('🗑️ Hapus Mapel',
      `Mapel ini memiliki ${qCount} soal. Apakah kamu yakin menghapusnya?`, () => {
        const subjects = this.getSubjects().filter(s => s.id !== id);
        Storage.set('sl_subjects', subjects);
        this.renderSubjectList();
        this.populateSubjectSelects();
        this.showToast('🗑️ Mapel berhasil dihapus!', 'success');
      });
  },

  // --------------------------------------------------------
  // SETTINGS
  // --------------------------------------------------------
  showSettings() { this.showScreen('settingsScreen'); },

  toggleDarkMode(val) {
    this.settings.darkMode = val;
    document.documentElement.setAttribute('data-theme', val ? 'dark' : 'light');
    document.getElementById('darkModeToggle').textContent = val ? '☀️' : '🌙';
    this.saveSettings();
    Audio.click();
  },

  toggleSound(val) {
    this.settings.sound = val;
    document.getElementById('soundToggle').textContent = val ? '🔊' : '🔇';
    this.saveSettings();
  },

  toggleMusic(val) {
    this.settings.music = val;
    if (val) Audio.startMusic();
    else Audio.stopMusic();
    this.saveSettings();
  },

  toggleShuffle(val) {
    this.settings.shuffle = val;
    this.saveSettings();
  },

  toggleShuffleAnswers(val) {
    this.settings.shuffleAnswers = val;
    this.saveSettings();
  },

  saveSettings() {
    Storage.set('sl_settings', this.settings);
  },

  changePIN() {
    document.getElementById('oldPIN').value = '';
    document.getElementById('newPIN').value = '';
    document.getElementById('confirmPIN').value = '';
    this.showModal('changePINModal');
  },

  savePIN() {
    const oldPIN = document.getElementById('oldPIN').value;
    const newPIN = document.getElementById('newPIN').value;
    const confirmPIN = document.getElementById('confirmPIN').value;

    if (oldPIN !== this.settings.pin) {
      this.showToast('❌ PIN lama tidak benar!', 'error');
      return;
    }
    if (newPIN.length !== 6 || !/^\d+$/.test(newPIN)) {
      this.showToast('⚠️ PIN baru harus 6 digit angka!', 'warning');
      return;
    }
    if (newPIN !== confirmPIN) {
      this.showToast('⚠️ Konfirmasi PIN tidak cocok!', 'warning');
      return;
    }

    this.settings.pin = newPIN;
    this.saveSettings();
    this.closeModal('changePINModal');
    this.showToast('✅ PIN berhasil diubah!', 'success');
  },

  // Public: always require PIN first (called from settings buttons via checkPIN)
  resetAllData() {
    // This function is now only reachable after PIN via checkPIN('reset-data')
    // Kept as alias for backward compatibility
    this.checkPIN('reset-data');
  },

  loadDefaultData() {
    this.checkPIN('load-default');
  },

  // Internal: called AFTER PIN is verified
  _doResetAllData() {
    this.showConfirm('⚠️ Reset Semua Data',
      'SEMUA data termasuk soal, riwayat, dan pengaturan akan dihapus. Ini tidak bisa dibatalkan!', () => {
        localStorage.clear();
        this.showToast('🔄 Data berhasil direset! Memuat ulang...', 'info');
        setTimeout(() => location.reload(), 1500);
      });
  },

  _doLoadDefaultData() {
    this.showConfirm('📥 Muat Data Default',
      'Data soal default akan dimuat. Data soal yang ada tidak akan dihapus.', async () => {
        try {
          const resp = await fetch('./questions-data.json');
          const data = await resp.json();
          Storage.set('sl_subjects', data.subjects);

          const existing = this.getQuestions();
          const existingIds = new Set(existing.map(q => q.id));
          const newQ = data.questions.filter(q => !existingIds.has(q.id));
          Storage.set('sl_questions', [...existing, ...newQ]);

          this.populateSubjectSelects();
          this.showToast(`✅ Berhasil memuat ${newQ.length} soal default!`, 'success');
        } catch {
          this.showToast('❌ Gagal memuat data. Pastikan file questions-data.json ada.', 'error');
        }
      });
  },

  // --------------------------------------------------------
  // PIN SYSTEM
  // --------------------------------------------------------
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
    if (this.pinBuffer.length === 6) {
      setTimeout(() => this.pinSubmit(), 200);
    }
  },

  pinClear() {
    Audio.click();
    this.pinBuffer = this.pinBuffer.slice(0, -1);
    this.updatePINDisplay();
  },

  updatePINDisplay() {
    const dots = document.querySelectorAll('#pinDisplay .pin-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < this.pinBuffer.length);
    });
  },

  pinSubmit() {
    if (this.pinBuffer !== this.settings.pin) {
      this.showToast('❌ PIN salah!', 'error');
      document.getElementById('pinModal').querySelector('.modal-sheet').classList.add('shake');
      setTimeout(() => document.getElementById('pinModal').querySelector('.modal-sheet').classList.remove('shake'), 500);
      this.pinBuffer = '';
      this.updatePINDisplay();
      return;
    }

    this.closeModal('pinModal');
    this.pinBuffer = '';

    const target = this.pinTarget;
    if (target === 'questions') {
      this.showScreen('questionsScreen');
    } else if (target === 'subjects') {
      this.showScreen('subjectsScreen');
    } else if (target === 'reset-data') {
      this._doResetAllData();
    } else if (target === 'load-default') {
      this._doLoadDefaultData();
    } else if (target === 'delayed-result') {
      if (this.pinTarget.data) this.showResult(this.pinTarget.data);
    } else if (typeof target === 'function') {
      target();
    }

    Audio.correct();
    this.showToast('✅ PIN benar! Selamat datang, Guru!', 'success');
  },

  // --------------------------------------------------------
  // MODALS
  // --------------------------------------------------------
  showModal(id) {
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
  },

  showConfirm(title, message, onConfirm, emoji = '⚠️') {
    document.getElementById('confirmEmoji').textContent = emoji;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmYes').onclick = () => {
      this.closeModal('confirmModal');
      onConfirm();
    };
    this.showModal('confirmModal');
  },

  // Close modals when clicking overlay
  setupModalCloseOnOverlay() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('open');
          document.body.style.overflow = '';
        }
      });
    });
  },

  // --------------------------------------------------------
  // TOAST NOTIFICATIONS
  // --------------------------------------------------------
  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // --------------------------------------------------------
  // BACKGROUND STARS
  // --------------------------------------------------------
  createStarsBg() {
    const container = document.getElementById('starsBg');
    for (let i = 0; i < 20; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.cssText = `
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        animation-delay: ${Math.random() * 3}s;
        animation-duration: ${2 + Math.random() * 3}s;
        width: ${4 + Math.random() * 6}px;
        height: ${4 + Math.random() * 6}px;
        background: ${['#ffd60a','#4361ee','#f72585','#06d6a0'][Math.floor(Math.random()*4)]};
      `;
      container.appendChild(star);
    }
  },

  // --------------------------------------------------------
  // SERVICE WORKER
  // --------------------------------------------------------
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg => console.log('[App] SW registered:', reg.scope))
        .catch(err => console.log('[App] SW registration failed:', err));
    }
  },

  // --------------------------------------------------------
  // PWA INSTALL
  // --------------------------------------------------------
  deferredPrompt: null,

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const banner = document.getElementById('installBanner');
      if (banner) banner.classList.add('show');
    });

    document.getElementById('installBtn')?.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          this.showToast('🎉 Smart Learning berhasil diinstall!', 'success');
        }
        this.deferredPrompt = null;
        document.getElementById('installBanner').classList.remove('show');
      }
    });

    document.getElementById('dismissInstall')?.addEventListener('click', () => {
      document.getElementById('installBanner').classList.remove('show');
    });
  },

  // --------------------------------------------------------
  // NETWORK STATUS
  // --------------------------------------------------------
  setupNetworkStatus() {
    const badge = document.getElementById('offlineBadge');
    const update = () => {
      if (!navigator.onLine) {
        badge.classList.add('show');
        this.showToast('⚡ Kamu sedang offline. Mode Offline aktif!', 'warning');
      } else {
        badge.classList.remove('show');
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  },

  showExcelTemplateModal() {
    Audio.click();
    this.showModal('excelTemplateModal');
  },

  // --------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

};

// ============================================================
// DARK MODE TOGGLE (header button)
// ============================================================
document.getElementById('darkModeToggle')?.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  App.toggleDarkMode(!isDark);
  document.getElementById('darkModeSwitch').checked = !isDark;
  Audio.click();
});

// Sound toggle (header button)
document.getElementById('soundToggle')?.addEventListener('click', () => {
  App.settings.sound = !App.settings.sound;
  document.getElementById('soundSwitch').checked = App.settings.sound;
  document.getElementById('soundToggle').textContent = App.settings.sound ? '🔊' : '🔇';
  App.saveSettings();
});

// ============================================================
// INIT APP ON DOM READY
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.setupModalCloseOnOverlay();
});
