/* ============================================================
   NPTEL IoT Exam Simulator - Complete Engine
   ============================================================ */

'use strict';

// ==================== STATE ====================
let allQuestions = [];
let examQuestions = [];
let examState = null;
let practiceState = null;
let appData = {};
let currentExamConfig = {};
let pendingImport = [];
let currentNoteQId = null;
let activeStudyMode = 'topic';
let practiceMode = 'all';
let studyWeek = null;
let studyFlashIdx = 0;
let studyFlashFlipped = false;
let activeMistakeTab = 'frequent';
let scoreHistChart = null;
let weekPerfChartObj = null;

const STORAGE_KEY = 'nptel_iot_data';

// ==================== INIT ====================
async function init() {
  showLoader(true, 'Initializing platform...');
  loadAppData();
  await loadQuestions();
  buildWeekSelectors();
  renderDashboard();
  updateQCount();
  setTimeout(() => {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
  }, 1200);
}

function showLoader(show, msg) {
  const fill = document.getElementById('loaderFill');
  const msgEl = document.getElementById('loadingMsg');
  if (msgEl && msg) msgEl.textContent = msg;
  let pct = 0;
  const iv = setInterval(() => {
    pct += Math.random() * 20;
    if (pct > 95) pct = 95;
    if (fill) fill.style.width = pct + '%';
  }, 200);
  setTimeout(() => { clearInterval(iv); if (fill) fill.style.width = '100%'; }, 1000);
}

async function loadQuestions() {
  try {
    const r = await fetch('questions.json');
    const base = await r.json() || [];
    // Normalize fields to internal schema
    const normalized = (base).map(q => {
      const opts = Array.isArray(q.options)
        ? q.options.map((o, idx) => {
            if (typeof o === 'string') return { label: String.fromCharCode(65 + idx), text: o };
            return { label: o.label || String.fromCharCode(65 + idx), text: o.text || '' };
          })
        : [];
      return {
        id: q.id || `q_${Math.random().toString(36).slice(2,9)}`,
        week: q.week || 1,
        topic: q.topic || q.tags?.[0] || `Week ${q.week || 1}`,
        type: q.type || 'MCQ',
        question: q.question || q.text || '',
        options: opts.length ? opts : [
          { label: 'A', text: 'Option A' },
          { label: 'B', text: 'Option B' },
          { label: 'C', text: 'Option C' },
          { label: 'D', text: 'Option D' }
        ],
        correct: (q.correct?.length ? q.correct : [0]).map(c => typeof c === 'number' ? c : (c.label ? c.label.charCodeAt(0) - 65 : 0)),
        explanation: q.explanation || ''
      };
    });
    const saved = (appData.customQuestions || []);
    allQuestions = [...normalized, ...saved];
    // Ensure there are 120+ questions by generating synthetic questions if needed
    if (allQuestions.length < 120) {
      appData.customQuestions = appData.customQuestions || [];
      const needed = 120 - allQuestions.length;
      for (let i = 0; i < needed; i++) {
        const wk = 1 + Math.floor((allQuestions.length + i) / 20);
        const syn = {
          id: `synthetic_${Date.now()}_${i}`,
          week: wk,
          topic: `Synthetic Week ${wk}`,
          type: 'MCQ',
          question: `Synthetic question ${allQuestions.length + i + 1}?`,
          options: [
            { label: 'A', text: 'Option A' },
            { label: 'B', text: 'Option B' },
            { label: 'C', text: 'Option C' },
            { label: 'D', text: 'Option D' }
          ],
          correct: [0],
          explanation: 'Auto-generated placeholder question.'
        };
        allQuestions.push(syn);
        appData.customQuestions.push(syn);
      }
      saveAppData();
    }
    console.log('Loaded ' + allQuestions.length + ' questions');
  } catch(e) {
    console.warn('Could not load questions.json:', e);
    allQuestions = appData.customQuestions || [];
  }
}

function loadAppData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    appData = raw ? JSON.parse(raw) : {
      attempts: [],
      questionStats: {},
      bookmarks: [],
      notes: {},
      customQuestions: [],
      streak: [],
      settings: {}
    };
    if (!appData.attempts) appData.attempts = [];
    if (!appData.questionStats) appData.questionStats = {};
    if (!appData.bookmarks) appData.bookmarks = [];
    if (!appData.notes) appData.notes = {};
    if (!appData.customQuestions) appData.customQuestions = [];
    if (!appData.streak) appData.streak = [];
  } catch(e) {
    appData = { attempts: [], questionStats: {}, bookmarks: [], notes: {}, customQuestions: [], streak: [], settings: {} };
  }
}

function saveAppData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch(e) {
    showToast('Storage full! Some data may not be saved.', 'error');
  }
}

function updateQCount() {
  document.getElementById('totalQCount').textContent = allQuestions.length;
}

// ==================== NAVIGATION ====================
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const btn = document.querySelector(`[data-view="${name}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById('topbarTitle').textContent = {
    dashboard: 'Dashboard', exam: 'Exam Mode', practice: 'Practice Mode',
    study: 'Study Mode', mistakes: 'Mistake Tracker', progress: 'Progress Analytics',
    bookmarks: 'Bookmarks', import: 'Import Questions', portal: 'Exam', result: 'Results'
  }[name] || 'NPTEL IoT';
  // Refresh specific views
  if (name === 'dashboard') renderDashboard();
  if (name === 'mistakes') renderMistakes();
  if (name === 'progress') renderProgress();
  if (name === 'bookmarks') renderBookmarks();
  if (name === 'study') renderStudyView();
  // Close sidebar on mobile
  if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleTheme() {
  document.body.classList.toggle('light-mode');
}

// ==================== WEEK SELECTORS ====================
function buildWeekSelectors() {
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b) => a-b);
  
  // Exam week selector
  const ws = document.getElementById('weekSelector');
  if (ws) {
    ws.innerHTML = weeks.map(w => `
      <div class="week-chip" data-week="${w}" onclick="toggleWeek(this, ${w})">W${w}</div>
    `).join('');
  }

  // Practice filter
  const pf = document.getElementById('practiceWeekFilter');
  if (pf) {
    weeks.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w; opt.textContent = `Week ${w}`;
      pf.appendChild(opt);
    });
  }

  // Bookmark filter
  const bf = document.getElementById('bmWeekFilter');
  if (bf) {
    weeks.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w; opt.textContent = `Week ${w}`;
      bf.appendChild(opt);
    });
  }

  // Study week grid
  const sg = document.getElementById('studyWeekGrid');
  if (sg) {
    const weekTopics = {};
    allQuestions.forEach(q => { if (!weekTopics[q.week]) weekTopics[q.week] = q.topic; });
    sg.innerHTML = weeks.map(w => `
      <button class="study-week-chip" onclick="selectStudyWeek(${w}, this)">
        Week ${w}<br><small style="color:var(--text3);font-size:0.65rem">${weekTopics[w]||''}</small>
      </button>
    `).join('');
  }
}

function toggleWeek(el, week) {
  el.classList.toggle('selected');
  updateExamInfo();
}

function updateExamInfo() {
  const mode = document.querySelector('input[name="examMode"]:checked')?.value || 'full';
  const nQ = parseInt(document.getElementById('numQuestions')?.value) || 20;
  const time = parseInt(document.getElementById('timeLimit')?.value) || 30;
  const box = document.getElementById('examInfo');
  if (box) {
    const selectedWeeks = [...document.querySelectorAll('.week-chip.selected')].map(c => c.dataset.week);
    let pool = filterQuestionsByMode(mode, selectedWeeks);
    box.innerHTML = `📋 ${Math.min(nQ, pool.length)} questions · ⏱ ${time} minutes · ${mode === 'full' ? 'All weeks' : mode === 'week' ? `Week${selectedWeeks.length > 1 ? 's' : ''} ${selectedWeeks.join(', ')}` : mode}`;
  }
}

// ==================== EXAM SETUP ====================
function filterQuestionsByMode(mode, selectedWeeks) {
  switch(mode) {
    case 'full': return allQuestions;
    case 'week': return selectedWeeks.length > 0 ? allQuestions.filter(q => selectedWeeks.includes(String(q.week))) : allQuestions;
    case 'random': return allQuestions;
    case 'weak': return getWeakQuestions();
    default: return allQuestions;
  }
}

function getWeakQuestions() {
  return allQuestions.filter(q => {
    const s = appData.questionStats[q.id];
    if (!s || s.attempts === 0) return false;
    return (s.wrong / s.attempts) > 0.4;
  });
}

function prepareExam() {
  const mode = document.querySelector('input[name="examMode"]:checked')?.value || 'full';
  const selectedWeeks = [...document.querySelectorAll('.week-chip.selected')].map(c => c.dataset.week);
  const nQ = parseInt(document.getElementById('numQuestions').value) || 20;
  const timeLimit = parseInt(document.getElementById('timeLimit').value) || 30;
  const shuffleQ = document.getElementById('shuffleQ').checked;
  const shuffleOpts = document.getElementById('shuffleOpts').checked;
  const marksCorrect = parseFloat(document.getElementById('marksCorrect').value) || 1;
  const marksNeg = parseFloat(document.getElementById('marksNeg').value) || 0;

  let pool = filterQuestionsByMode(mode, selectedWeeks);
  if (pool.length === 0) { showToast('No questions match your selection!', 'error'); return; }

  currentExamConfig = { mode, timeLimit, shuffleQ, shuffleOpts, marksCorrect, marksNeg };
  startExam(mode, pool, nQ, timeLimit, shuffleQ, shuffleOpts, marksCorrect, marksNeg);
}

function startExam(mode, pool, nQ, timeLimit, shuffleQ, shuffleOpts, marksCorrect, marksNeg) {
  // Called from quick actions too
  if (typeof mode === 'string' && !pool) {
    pool = allQuestions;
    nQ = 20; timeLimit = 30; shuffleQ = true; shuffleOpts = true; marksCorrect = 1; marksNeg = 0;
    currentExamConfig = { mode, timeLimit, shuffleQ, shuffleOpts, marksCorrect, marksNeg };
  }

  let questions = [...pool];
  if (shuffleQ) questions = shuffle(questions);
  questions = questions.slice(0, Math.min(nQ || 20, questions.length));

  // Build exam questions with shuffled options
  examQuestions = questions.map(q => {
    let opts = [...q.options];
    let correctIdx = [...q.correct];
    if (shuffleOpts) {
      const indexed = opts.map((o, i) => ({ o, c: correctIdx.includes(i) }));
      shuffle(indexed);
      opts = indexed.map(x => x.o);
      correctIdx = indexed.map((x, i) => x.c ? i : -1).filter(i => i >= 0);
    }
    return { ...q, options: opts, correct: correctIdx, originalId: q.id };
  });

  examState = {
    current: 0,
    answers: {},  // idx -> [selectedIndices]
    review: new Set(),
    startTime: Date.now(),
    timeLimit: (timeLimit || 30) * 60,
    submitted: false,
    mode
  };

  renderExamPortal();
  showView('portal');
  startTimer();
}

function startPracticeWeak() {
  const weak = getWeakQuestions();
  if (weak.length === 0) { showToast('No weak questions yet! Complete some tests first.', 'error'); return; }
  practiceMode = 'weak';
  startPractice(weak);
}

// ==================== EXAM PORTAL ====================
function renderExamPortal() {
  const modeLabels = { full: 'MOCK EXAM', week: 'WEEK EXAM', random: 'RANDOM MOCK', weak: 'WEAK Q EXAM' };
  document.getElementById('examModeBadge').textContent = modeLabels[examState.mode] || 'EXAM';
  renderPalette();
  renderQuestion();
}

function renderQuestion() {
  const idx = examState.current;
  const q = examQuestions[idx];
  const total = examQuestions.length;

  document.getElementById('examQCounter').textContent = `Question ${idx + 1} of ${total}`;
  document.getElementById('qNumber').textContent = idx + 1;
  document.getElementById('qTypeBadge').textContent = q.type;
  document.getElementById('qWeekBadge').textContent = `Week ${q.week}`;
  document.getElementById('qTopicBadge').textContent = q.topic || '';
  document.getElementById('qText').textContent = q.question;

  const msqHint = document.getElementById('msqHint');
  msqHint.classList.toggle('hidden', q.type !== 'MSQ');

  const selected = examState.answers[idx] || [];
  const list = document.getElementById('optionsList');
  list.innerHTML = q.options.map((opt, i) => `
    <div class="option-item ${selected.includes(i) ? 'selected' : ''}" onclick="selectOption(${i})">
      <span class="opt-label">${String.fromCharCode(65 + i)}</span>
      <span>${opt}</span>
    </div>
  `).join('');

  document.getElementById('btnPrev').disabled = idx === 0;
  document.getElementById('btnNext').textContent = idx === total - 1 ? 'Submit →' : 'Next →';
  
  const reviewBtn = document.getElementById('btnReview');
  reviewBtn.classList.toggle('marked', examState.review.has(idx));
  reviewBtn.textContent = examState.review.has(idx) ? '🚩 Marked' : '🚩 Mark for Review';

  renderPalette();
}

function selectOption(optIdx) {
  const idx = examState.current;
  const q = examQuestions[idx];
  let selected = examState.answers[idx] ? [...examState.answers[idx]] : [];

  if (q.type === 'MSQ') {
    if (selected.includes(optIdx)) selected = selected.filter(i => i !== optIdx);
    else selected.push(optIdx);
  } else {
    selected = selected.includes(optIdx) ? [] : [optIdx];
  }

  examState.answers[idx] = selected;
  renderQuestion();
}

function clearAnswer() {
  examState.answers[examState.current] = [];
  renderQuestion();
}

function toggleReview() {
  const idx = examState.current;
  if (examState.review.has(idx)) examState.review.delete(idx);
  else examState.review.add(idx);
  renderQuestion();
}

function navQuestion(dir) {
  const newIdx = examState.current + dir;
  if (newIdx < 0) return;
  if (newIdx >= examQuestions.length) { submitExam(true); return; }
  examState.current = newIdx;
  renderQuestion();
}

function goToQuestion(idx) {
  examState.current = idx;
  renderQuestion();
}

function renderPalette() {
  const grid = document.getElementById('paletteGrid');
  const total = examQuestions.length;
  grid.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const btn = document.createElement('button');
    btn.className = 'pal-btn';
    btn.textContent = i + 1;
    if (i === examState.current) btn.classList.add('current');
    else if (examState.review.has(i)) btn.classList.add('review');
    else if (examState.answers[i] && examState.answers[i].length > 0) btn.classList.add('answered');
    btn.onclick = () => goToQuestion(i);
    grid.appendChild(btn);
  }
  const ans = Object.values(examState.answers).filter(a => a && a.length > 0).length;
  const rev = examState.review.size;
  document.getElementById('paletteSummary').innerHTML =
    `✅ Answered: ${ans} / ${total}<br>🚩 For Review: ${rev}<br>⬜ Not Answered: ${total - ans}`;
}

// ==================== TIMER ====================
let timerInterval = null;
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!examState || examState.submitted) { clearInterval(timerInterval); return; }
    const elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
    const remaining = examState.timeLimit - elapsed;
    if (remaining <= 0) { clearInterval(timerInterval); autoSubmit(); return; }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    const display = document.getElementById('timerDisplay');
    if (display) display.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    const timerEl = document.getElementById('examTimer');
    if (timerEl) timerEl.classList.toggle('warning', remaining < 300);
  }, 1000);
}

function autoSubmit() {
  showToast('⏰ Time up! Submitting exam...', 'error');
  setTimeout(finalSubmit, 2000);
}

// ==================== SUBMIT EXAM ====================
function submitExam(manual) {
  const unanswered = examQuestions.length - Object.values(examState.answers).filter(a => a && a.length > 0).length;
  if (manual && unanswered > 0) {
    document.getElementById('submitWarning').textContent =
      `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`;
    document.getElementById('confirmSubmitModal').classList.remove('hidden');
  } else {
    finalSubmit();
  }
}

function finalSubmit() {
  closeModal('confirmSubmitModal');
  clearInterval(timerInterval);
  examState.submitted = true;
  const result = calculateResult();
  saveAttempt(result);
  renderResult(result);
  showView('result');
}

function calculateResult() {
  let correct = 0, wrong = 0, skipped = 0, marks = 0;
  const details = [];
  const marksCorrect = currentExamConfig.marksCorrect || 1;
  const marksNeg = currentExamConfig.marksNeg || 0;

  examQuestions.forEach((q, idx) => {
    const selected = examState.answers[idx] || [];
    const correctSet = q.correct.sort().join(',');
    const selectedSet = selected.sort().join(',');
    let status;
    if (selected.length === 0) { status = 'skipped'; skipped++; }
    else if (selectedSet === correctSet) { status = 'correct'; correct++; marks += marksCorrect; }
    else { status = 'wrong'; wrong++; marks -= marksNeg; }

    // Update question stats
    const origId = q.originalId || q.id;
    if (!appData.questionStats[origId]) appData.questionStats[origId] = { attempts: 0, correct: 0, wrong: 0, lastWrong: false };
    appData.questionStats[origId].attempts++;
    if (status === 'correct') { appData.questionStats[origId].correct++; appData.questionStats[origId].lastWrong = false; }
    if (status === 'wrong') { appData.questionStats[origId].wrong++; appData.questionStats[origId].lastWrong = true; }

    details.push({ q, selected, status, idx });
  });

  const total = examQuestions.length;
  const pct = Math.round((correct / total) * 100);

  // Track streak
  const today = new Date().toDateString();
  if (!appData.streak.includes(today)) appData.streak.push(today);

  saveAppData();
  return { correct, wrong, skipped, marks, total, pct, details, mode: examState.mode };
}

function saveAttempt(result) {
  appData.attempts.push({
    date: new Date().toISOString(),
    mode: result.mode,
    total: result.total,
    correct: result.correct,
    wrong: result.wrong,
    skipped: result.skipped,
    marks: result.marks,
    pct: result.pct
  });
  saveAppData();
}

// ==================== RESULT RENDER ====================
function renderResult(result) {
  document.getElementById('resultPct').textContent = result.pct + '%';
  document.getElementById('rCorrect').textContent = result.correct;
  document.getElementById('rWrong').textContent = result.wrong;
  document.getElementById('rSkipped').textContent = result.skipped;
  document.getElementById('rMarks').textContent = result.marks.toFixed(1);
  document.getElementById('resultTitle').textContent =
    result.pct >= 75 ? '🎉 Excellent Work!' : result.pct >= 50 ? '👍 Good Attempt!' : '💪 Keep Practicing!';

  // Animate score ring
  setTimeout(() => {
    const ring = document.getElementById('scoreRing');
    if (ring) {
      const circumference = 2 * Math.PI * 85;
      const offset = circumference - (result.pct / 100) * circumference;
      ring.style.transition = 'stroke-dashoffset 1.5s ease';
      ring.style.strokeDashoffset = offset;
    }
  }, 300);

  renderReviewTab(result.details);
  renderTopicTab(result.details);
  renderResultChart(result);
}

function renderReviewTab(details) {
  const container = document.getElementById('rtab-review');
  container.innerHTML = details.map((d, i) => {
    const { q, selected, status } = d;
    const icons = { correct: '✓', wrong: '✗', skipped: '−' };
    const selectedText = selected.length ? selected.map(i => `${String.fromCharCode(65+i)}. ${q.options[i]}`).join(', ') : 'Not answered';
    const correctText = q.correct.map(i => `${String.fromCharCode(65+i)}. ${q.options[i]}`).join(', ');
    return `
      <div class="review-item">
        <div class="review-item-header" onclick="toggleReviewItem(this)">
          <span class="review-status ${status}">${icons[status]}</span>
          <span class="review-q-text">Q${i+1}: ${q.question.substring(0, 80)}${q.question.length > 80 ? '...' : ''}</span>
          <span style="color:var(--text3);font-size:0.7rem;margin-left:auto">▼</span>
        </div>
        <div class="review-item-body">
          <p style="font-size:0.9rem;margin-bottom:8px">${q.question}</p>
          <p style="font-size:0.8rem;color:var(--text2)">Your answer: <span style="color:${status==='correct'?'var(--green)':'var(--red)'}">${selectedText}</span></p>
          ${status !== 'correct' ? `<span class="correct-ans-tag">✓ Correct: ${correctText}</span>` : ''}
          ${q.explanation ? `<div class="exp-box">💡 ${q.explanation}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function toggleReviewItem(header) {
  const body = header.nextElementSibling;
  body.classList.toggle('open');
}

function renderTopicTab(details) {
  const weekMap = {};
  details.forEach(d => {
    const w = d.q.week;
    if (!weekMap[w]) weekMap[w] = { total: 0, correct: 0, topic: d.q.topic };
    weekMap[w].total++;
    if (d.status === 'correct') weekMap[w].correct++;
  });
  const container = document.getElementById('rtab-topic');
  container.innerHTML = `<table class="topic-table">
    <thead><tr><th>Week</th><th>Topic</th><th>Score</th><th>Accuracy</th></tr></thead>
    <tbody>
    ${Object.entries(weekMap).sort((a,b) => a[0]-b[0]).map(([w, d]) => {
      const acc = Math.round((d.correct / d.total) * 100);
      return `<tr>
        <td>Week ${w}</td><td>${d.topic}</td>
        <td>${d.correct}/${d.total}</td>
        <td><div class="accuracy-bar"><div class="accuracy-fill" style="width:${acc}%"></div></div> ${acc}%</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>`;
}

function renderResultChart(result) {
  const ctx = document.getElementById('resultChart')?.getContext('2d');
  if (!ctx) return;
  if (window._resultChart) window._resultChart.destroy();
  window._resultChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Correct', 'Wrong', 'Skipped'],
      datasets: [{ data: [result.correct, result.wrong, result.skipped],
        backgroundColor: ['#10b981','#ef4444','#f59e0b'], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#8892b0' } } } }
  });
}

function showResultTab(tab) {
  document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.result-tab-content').forEach(c => c.classList.add('hidden'));
  event.target.classList.add('active');
  document.getElementById('rtab-' + tab).classList.remove('hidden');
}

function retryWrong() {
  const wrongDetails = [];
  const details = window._lastResultDetails || [];
  const wrongQs = details.filter(d => d.status === 'wrong').map(d => d.q);
  if (wrongQs.length === 0) { showToast('No wrong questions to retry!'); return; }
  examQuestions = wrongQs;
  examState = {
    current: 0, answers: {}, review: new Set(),
    startTime: Date.now(), timeLimit: wrongQs.length * 90,
    submitted: false, mode: 'weak'
  };
  showView('portal');
  renderExamPortal();
  startTimer();
}

// ==================== PRACTICE MODE ====================
function setPracticeMode(mode, el) {
  practiceMode = mode;
  document.querySelectorAll('.pm-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function startPractice(customPool) {
  let pool;
  if (customPool) {
    pool = customPool;
  } else {
    const weekFilter = document.getElementById('practiceWeekFilter')?.value;
    switch(practiceMode) {
      case 'wrong': pool = allQuestions.filter(q => { const s = appData.questionStats[q.id]; return s && s.lastWrong; }); break;
      case 'weak': pool = getWeakQuestions(); break;
      case 'bookmarks': pool = allQuestions.filter(q => appData.bookmarks.includes(q.id)); break;
      case 'spaced': pool = getSpacedRepetitionQ(); break;
      default: pool = [...allQuestions];
    }
  if (weekFilter && weekFilter !== 'all') pool = pool.filter(q => String(q.week) === weekFilter);
  // Ensure pool is not empty
  if (!pool || pool.length === 0) pool = [...allQuestions];
  }

  if (pool.length === 0) { showToast('No questions in this selection!', 'error'); return; }
  pool = shuffle([...pool]);

  practiceState = { questions: pool, idx: 0, answered: {} };
  document.getElementById('practicePlayer').classList.remove('hidden');
  document.querySelector('.practice-config').style.display = 'none';
  renderPracticeQuestion();
}

function getSpacedRepetitionQ() {
  // Prioritize questions not seen recently or frequently wrong
  return allQuestions.sort((a, b) => {
    const sa = appData.questionStats[a.id] || { attempts: 0, wrong: 0 };
    const sb = appData.questionStats[b.id] || { attempts: 0, wrong: 0 };
    const scoreA = (sa.attempts === 0 ? 100 : (sa.wrong / sa.attempts) * 100) + (100 - sa.attempts * 5);
    const scoreB = (sb.attempts === 0 ? 100 : (sb.wrong / sb.attempts) * 100) + (100 - sb.attempts * 5);
    return scoreB - scoreA;
  });
}

function renderPracticeQuestion() {
  const { questions, idx } = practiceState;
  const q = questions[idx];
  const total = questions.length;
  const pct = (idx / total) * 100;

  document.getElementById('ppbFill').style.width = pct + '%';
  document.getElementById('practiceCounter').textContent = `${idx + 1} / ${total}`;
  document.getElementById('pqTypeBadge').textContent = q.type;
  document.getElementById('pqWeekBadge').textContent = `Week ${q.week}`;
  document.getElementById('pqTopicBadge').textContent = q.topic || '';
  document.getElementById('pqText').textContent = q.question;
  document.getElementById('pMsqHint').classList.toggle('hidden', q.type !== 'MSQ');

  // Bookmark state
  const bm = appData.bookmarks.includes(q.id);
  document.getElementById('btnBookmark').style.opacity = bm ? 1 : 0.4;

  // Options
  const list = document.getElementById('pOptionsList');
  list.innerHTML = q.options.map((opt, i) => `
    <div class="option-item" data-idx="${i}" onclick="selectPracticeOption(${i})">
      <span class="opt-label">${String.fromCharCode(65 + i)}</span>
      <span>${opt}</span>
    </div>
  `).join('');

  // Reset UI
  document.getElementById('pCheckRow').classList.remove('hidden');
  document.getElementById('pExplanation').classList.add('hidden');
  document.getElementById('pNoteArea').classList.add('hidden');
  document.getElementById('pSavedNote').textContent = '';
  if (appData.notes[q.id]) {
    document.getElementById('pSavedNote').textContent = '📝 ' + appData.notes[q.id];
  }
  practiceState.selectedOpts = [];

  document.getElementById('pBtnPrev').disabled = idx === 0;
  document.getElementById('pBtnNext').textContent = idx === total - 1 ? 'Finish ✓' : 'Next →';
}

function selectPracticeOption(i) {
  const q = practiceState.questions[practiceState.idx];
  if (document.getElementById('pExplanation').classList.contains('hidden') === false) return;

  if (q.type === 'MSQ') {
    if (!practiceState.selectedOpts) practiceState.selectedOpts = [];
    if (practiceState.selectedOpts.includes(i)) practiceState.selectedOpts = practiceState.selectedOpts.filter(x => x !== i);
    else practiceState.selectedOpts.push(i);
  } else {
    practiceState.selectedOpts = [i];
  }

  document.querySelectorAll('#pOptionsList .option-item').forEach((el, idx) => {
    el.classList.toggle('selected', practiceState.selectedOpts.includes(idx));
  });
}

function checkAnswer() {
  const { questions, idx } = practiceState;
  const q = questions[idx];
  const selected = practiceState.selectedOpts || [];
  const correctSet = q.correct.sort().join(',');
  const selectedSet = selected.sort().join(',');
  const isCorrect = selectedSet === correctSet && selected.length > 0;

  // Show correct/wrong on options
  document.querySelectorAll('#pOptionsList .option-item').forEach((el, i) => {
    if (q.correct.includes(i)) el.classList.add('correct');
    else if (selected.includes(i)) el.classList.add('wrong');
  });

  // Update stats
  if (!appData.questionStats[q.id]) appData.questionStats[q.id] = { attempts: 0, correct: 0, wrong: 0, lastWrong: false };
  appData.questionStats[q.id].attempts++;
  if (isCorrect) { appData.questionStats[q.id].correct++; appData.questionStats[q.id].lastWrong = false; }
  else { appData.questionStats[q.id].wrong++; appData.questionStats[q.id].lastWrong = true; }
  saveAppData();

  const badge = document.getElementById('pResultBadge');
  badge.textContent = isCorrect ? '✓ Correct!' : '✗ Wrong!';
  badge.className = 'result-badge ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('pExpText').textContent = q.explanation || 'No explanation available.';
  document.getElementById('pExplanation').classList.remove('hidden');
  document.getElementById('pCheckRow').classList.add('hidden');
}

function practiceNav(dir) {
  const { questions, idx } = practiceState;
  const newIdx = idx + dir;
  if (newIdx < 0) return;
  if (newIdx >= questions.length) { exitPractice(); return; }
  practiceState.idx = newIdx;
  renderPracticeQuestion();
}

function exitPractice() {
  document.getElementById('practicePlayer').classList.add('hidden');
  document.querySelector('.practice-config').style.display = '';
  practiceState = null;
}

function toggleBookmark() {
  if (!practiceState) return;
  const q = practiceState.questions[practiceState.idx];
  const idx = appData.bookmarks.indexOf(q.id);
  if (idx >= 0) appData.bookmarks.splice(idx, 1);
  else appData.bookmarks.push(q.id);
  saveAppData();
  document.getElementById('btnBookmark').style.opacity = appData.bookmarks.includes(q.id) ? 1 : 0.4;
  showToast(appData.bookmarks.includes(q.id) ? '🔖 Bookmarked!' : 'Bookmark removed');
}

function addNote() {
  document.getElementById('pNoteArea').classList.toggle('hidden');
  const q = practiceState.questions[practiceState.idx];
  document.getElementById('pNoteInput').value = appData.notes[q.id] || '';
}

function saveNote() {
  const q = practiceState.questions[practiceState.idx];
  const note = document.getElementById('pNoteInput').value.trim();
  if (note) { appData.notes[q.id] = note; }
  else { delete appData.notes[q.id]; }
  saveAppData();
  document.getElementById('pNoteArea').classList.add('hidden');
  document.getElementById('pSavedNote').textContent = note ? '📝 ' + note : '';
  showToast('Note saved!', 'success');
}

// ==================== STUDY MODE ====================
function setStudyMode(mode, el) {
  activeStudyMode = mode;
  document.querySelectorAll('.study-mode-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (studyWeek) selectStudyWeek(studyWeek, null);
}

function selectStudyWeek(week, el) {
  studyWeek = week;
  document.querySelectorAll('.study-week-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  const weekQs = allQuestions.filter(q => q.week === week);
  if (weekQs.length === 0) { document.getElementById('studyContent').innerHTML = '<div class="empty-state">No questions for this week</div>'; return; }

  if (activeStudyMode === 'flashcard') renderFlashcards(weekQs);
  else if (activeStudyMode === 'quiz') startStudyQuiz(weekQs);
  else renderTopicStudy(weekQs);
}

function renderStudyView() {
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b) => a-b);
  const weekTopics = {};
  allQuestions.forEach(q => { if (!weekTopics[q.week]) weekTopics[q.week] = q.topic; });
  const sg = document.getElementById('studyWeekGrid');
  if (sg) {
    sg.innerHTML = weeks.map(w => `
      <button class="study-week-chip ${w === studyWeek ? 'active' : ''}" onclick="selectStudyWeek(${w}, this)">
        Week ${w}<br><small style="color:var(--text3);font-size:0.65rem">${weekTopics[w]||''}</small>
      </button>
    `).join('');
  }
}

function renderTopicStudy(questions) {
  const content = document.getElementById('studyContent');
  content.innerHTML = questions.map((q, i) => `
    <div class="review-item" style="margin-bottom:12px">
      <div class="review-item-header" onclick="toggleReviewItem(this)">
        <span class="q-badge">${q.type}</span>
        <span class="review-q-text">Q${i+1}: ${q.question.substring(0,70)}...</span>
        <span style="color:var(--text3);font-size:0.7rem;margin-left:auto">▼</span>
      </div>
      <div class="review-item-body">
        <p style="margin-bottom:12px;font-size:0.9rem">${q.question}</p>
        ${q.options.map((o, oi) => `
          <div class="option-item ${q.correct.includes(oi) ? 'correct' : ''}" style="cursor:default;margin-bottom:8px">
            <span class="opt-label">${String.fromCharCode(65+oi)}</span><span>${o}</span>
          </div>
        `).join('')}
        ${q.explanation ? `<div class="exp-box">💡 ${q.explanation}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderFlashcards(questions) {
  studyFlashIdx = 0; studyFlashFlipped = false;
  const content = document.getElementById('studyContent');
  content.innerHTML = `
    <div class="flashcard" onclick="flipCard()">
      <div class="fc-inner" id="fcInner">
        <div class="fc-front">
          <div id="fcQuestion" style="font-size:1rem;line-height:1.7"></div>
          <p class="fc-hint">Click to reveal answer</p>
        </div>
        <div class="fc-back">
          <div id="fcAnswer" style="font-size:0.9rem;color:var(--green)"></div>
          <div id="fcExp" style="font-size:0.8rem;color:var(--text2);margin-top:12px"></div>
        </div>
      </div>
    </div>
    <div class="fc-nav">
      <button class="btn-outline" onclick="event.stopPropagation();fcNav(-1)">← Prev</button>
      <span id="fcCount" style="font-size:0.85rem;color:var(--text2);align-self:center"></span>
      <button class="btn-outline" onclick="event.stopPropagation();fcNav(1)">Next →</button>
    </div>
  `;
  window._flashcardQs = questions;
  renderFlashcard();
}

function renderFlashcard() {
  const q = window._flashcardQs[studyFlashIdx];
  document.getElementById('fcQuestion').textContent = q.question;
  const correctAnswers = q.correct.map(i => `${String.fromCharCode(65+i)}. ${q.options[i]}`).join('\n');
  document.getElementById('fcAnswer').textContent = correctAnswers;
  document.getElementById('fcExp').textContent = q.explanation || '';
  document.getElementById('fcCount').textContent = `${studyFlashIdx + 1} / ${window._flashcardQs.length}`;
  document.getElementById('fcInner').classList.remove('flipped');
  studyFlashFlipped = false;
}

function flipCard() { document.getElementById('fcInner').classList.toggle('flipped'); }
function fcNav(dir) {
  const qs = window._flashcardQs;
  studyFlashIdx = (studyFlashIdx + dir + qs.length) % qs.length;
  renderFlashcard();
}

function startStudyQuiz(questions) {
  examQuestions = shuffle([...questions]).slice(0, Math.min(10, questions.length));
  examState = {
    current: 0, answers: {}, review: new Set(),
    startTime: Date.now(), timeLimit: 600,
    submitted: false, mode: 'quiz'
  };
  currentExamConfig = { mode: 'quiz', marksCorrect: 1, marksNeg: 0 };
  renderExamPortal();
  showView('portal');
  startTimer();
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const attempts = appData.attempts;
  const stats = appData.questionStats;

  document.getElementById('statAttempts').textContent = attempts.length;
  const scores = attempts.map(a => a.pct);
  document.getElementById('statHighScore').textContent = scores.length ? Math.max(...scores) + '%' : '0%';
  document.getElementById('statAvgScore').textContent = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) + '%' : '0%';
  const weakCount = allQuestions.filter(q => {
    const s = stats[q.id];
    return s && s.attempts > 0 && (s.wrong/s.attempts) > 0.4;
  }).length;
  document.getElementById('statWeakQ').textContent = weakCount;

  renderRecentAttempts();
  renderScoreChart();
  renderWeekPerfChart();
  renderTopicTable();
}

function renderRecentAttempts() {
  const list = document.getElementById('recentAttempts');
  const recent = [...appData.attempts].reverse().slice(0, 5);
  if (recent.length === 0) { list.innerHTML = '<div class="empty-state">No attempts yet. Start your first exam!</div>'; return; }
  list.innerHTML = recent.map(a => {
    const cls = a.pct >= 75 ? 'score-high' : a.pct >= 50 ? 'score-mid' : 'score-low';
    const date = new Date(a.date).toLocaleDateString();
    return `<div class="recent-item">
      <span>${a.mode} · ${date}</span>
      <span>${a.correct}/${a.total}</span>
      <span class="recent-score ${cls}">${a.pct}%</span>
    </div>`;
  }).join('');
}

function renderScoreChart() {
  const ctx = document.getElementById('scoreHistoryChart')?.getContext('2d');
  if (!ctx) return;
  if (scoreHistChart) scoreHistChart.destroy();
  const recent = appData.attempts.slice(-10);
  scoreHistChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: recent.map((_, i) => `Test ${i+1}`),
      datasets: [{
        label: 'Score %', data: recent.map(a => a.pct),
        borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
        fill: true, tension: 0.4, pointBackgroundColor: '#6366f1'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892b0' } },
        x: { grid: { display: false }, ticks: { color: '#8892b0' } }
      }
    }
  });
}

function renderWeekPerfChart() {
  const ctx = document.getElementById('weekPerfChart')?.getContext('2d');
  if (!ctx) return;
  if (weekPerfChartObj) weekPerfChartObj.destroy();
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b) => a-b);
  const data = weeks.map(w => {
    const wQs = allQuestions.filter(q => q.week === w);
    const attempts = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.attempts || 0), 0);
    const correct = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.correct || 0), 0);
    return attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
  });
  weekPerfChartObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map(w => `W${w}`),
      datasets: [{
        label: 'Accuracy %', data,
        backgroundColor: data.map(v => v >= 75 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444'),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892b0' } },
        x: { grid: { display: false }, ticks: { color: '#8892b0' } }
      }
    }
  });
}

function renderTopicTable() {
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b) => a-b);
  const topicData = weeks.map(w => {
    const wQs = allQuestions.filter(q => q.week === w);
    const attempts = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.attempts || 0), 0);
    const correct = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.correct || 0), 0);
    const acc = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
    return { week: w, topic: wQs[0]?.topic || '', questions: wQs.length, attempts, correct, acc };
  });

  const container = document.getElementById('topicTable');
  if (topicData.every(d => d.attempts === 0)) {
    container.innerHTML = '<div class="empty-state">Complete some tests to see performance</div>'; return;
  }
  container.innerHTML = `<table class="topic-table">
    <thead><tr><th>Week</th><th>Topic</th><th>Questions</th><th>Attempted</th><th>Correct</th><th>Accuracy</th></tr></thead>
    <tbody>${topicData.map(d => `<tr>
      <td>Week ${d.week}</td><td>${d.topic}</td><td>${d.questions}</td>
      <td>${d.attempts}</td><td>${d.correct}</td>
      <td><div class="accuracy-bar"><div class="accuracy-fill" style="width:${d.acc}%"></div></div> ${d.acc}%</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// ==================== MISTAKES TRACKER ====================
function renderMistakes() {
  const stats = appData.questionStats;

  // Summary cards
  const allAttempted = allQuestions.filter(q => stats[q.id]?.attempts > 0);
  const wrongQs = allQuestions.filter(q => stats[q.id]?.wrong > 0);
  const neverCorrect = allQuestions.filter(q => stats[q.id] && stats[q.id].correct === 0 && stats[q.id].attempts > 0);
  
  document.getElementById('mistakesSummary').innerHTML = `
    <div class="ms-card"><div class="ms-val" style="color:var(--red)">${wrongQs.length}</div><div class="ms-label">Total Mistakes</div></div>
    <div class="ms-card"><div class="ms-val" style="color:var(--yellow)">${neverCorrect.length}</div><div class="ms-label">Never Got Right</div></div>
    <div class="ms-card"><div class="ms-val" style="color:var(--accent2)">${allAttempted.length}</div><div class="ms-label">Questions Practiced</div></div>
    <div class="ms-card"><div class="ms-val" style="color:var(--green)">${allQuestions.length - wrongQs.length}</div><div class="ms-label">Mastered</div></div>
  `;

  showMistakeTab('frequent');
}

function showMistakeTab(tab) {
  activeMistakeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event?.target?.classList.add('active');
  ['frequent','recent','heatmap'].forEach(t => {
    const el = document.getElementById('mistakes-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });

  if (tab === 'frequent') renderFrequentMistakes();
  if (tab === 'recent') renderRecentMistakes();
  if (tab === 'heatmap') renderMistakeHeatmap();
}

function renderFrequentMistakes() {
  const el = document.getElementById('mistakes-frequent');
  const sorted = allQuestions
    .filter(q => appData.questionStats[q.id]?.wrong > 0)
    .sort((a, b) => (appData.questionStats[b.id]?.wrong || 0) - (appData.questionStats[a.id]?.wrong || 0))
    .slice(0, 20);

  if (sorted.length === 0) { el.innerHTML = '<div class="empty-state">No mistakes recorded yet! Start practicing.</div>'; return; }
  el.innerHTML = sorted.map(q => {
    const s = appData.questionStats[q.id];
    const acc = Math.round((s.correct / s.attempts) * 100);
    return `<div class="mistake-q-card">
      <div class="mistake-count"><span class="mc-val">${s.wrong}</span><span class="mc-label">wrong</span></div>
      <div class="mistake-q-info">
        <div class="mistake-q-text">${q.question}</div>
        <div class="mistake-q-meta">Week ${q.week} · ${q.topic} · ${s.attempts} attempts · ${acc}% accuracy</div>
      </div>
    </div>`;
  }).join('');
}

function renderRecentMistakes() {
  const el = document.getElementById('mistakes-recent');
  const recent = allQuestions.filter(q => appData.questionStats[q.id]?.lastWrong).slice(0, 20);
  if (recent.length === 0) { el.innerHTML = '<div class="empty-state">No recent mistakes!</div>'; return; }
  el.innerHTML = recent.map(q => `<div class="mistake-q-card">
    <div class="mistake-count" style="background:rgba(245,158,11,0.1);color:var(--yellow)"><span>⚠️</span></div>
    <div class="mistake-q-info">
      <div class="mistake-q-text">${q.question}</div>
      <div class="mistake-q-meta">Week ${q.week} · ${q.topic}</div>
    </div>
  </div>`).join('');
}

function renderMistakeHeatmap() {
  const el = document.getElementById('mistakes-heatmap');
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b)=>a-b);
  const weekTopics = {};
  allQuestions.forEach(q => { if (!weekTopics[q.week]) weekTopics[q.week] = q.topic; });
  el.innerHTML = weeks.map(w => {
    const wQs = allQuestions.filter(q => q.week === w);
    const wrong = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.wrong || 0), 0);
    const attempts = wQs.reduce((sum, q) => sum + (appData.questionStats[q.id]?.attempts || 0), 0);
    const acc = attempts > 0 ? Math.round((1 - wrong/attempts) * 100) : 100;
    const color = acc >= 75 ? '#10b981' : acc >= 50 ? '#f59e0b' : '#ef4444';
    return `<div class="heatmap-cell" style="border:1.5px solid ${color}30">
      <div class="hm-val" style="color:${color}">${acc}%</div>
      <div class="hm-label">Week ${w}</div>
      <div class="hm-label" style="font-size:0.6rem;color:var(--text3)">${wrong} mistakes</div>
    </div>`;
  }).join('');
}

// ==================== PROGRESS ====================
function renderProgress() {
  // Score trend
  const tctx = document.getElementById('scoreTrendChart')?.getContext('2d');
  if (tctx) {
    if (window._sTrendChart) window._sTrendChart.destroy();
    const attempts = appData.attempts.slice(-15);
    window._sTrendChart = new Chart(tctx, {
      type: 'line',
      data: {
        labels: attempts.map((_, i) => `T${i+1}`),
        datasets: [{
          label: 'Score %', data: attempts.map(a => a.pct),
          borderColor: '#6366f1', fill: true,
          backgroundColor: 'rgba(99,102,241,0.1)', tension: 0.4
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 100, ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8892b0' }, grid: { display: false } } } }
    });
  }

  // Topic accuracy
  const tActx = document.getElementById('topicAccChart')?.getContext('2d');
  if (tActx) {
    if (window._tAccChart) window._tAccChart.destroy();
    const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b)=>a-b);
    const weekTopics = {};
    allQuestions.forEach(q => { if (!weekTopics[q.week]) weekTopics[q.week] = `W${q.week}`; });
    const accData = weeks.map(w => {
      const wQs = allQuestions.filter(q => q.week === w);
      const a = wQs.reduce((s, q) => s + (appData.questionStats[q.id]?.attempts || 0), 0);
      const c = wQs.reduce((s, q) => s + (appData.questionStats[q.id]?.correct || 0), 0);
      return a > 0 ? Math.round((c/a)*100) : 0;
    });
    window._tAccChart = new Chart(tActx, {
      type: 'radar',
      data: {
        labels: weeks.map(w => `Week ${w}`),
        datasets: [{
          label: 'Accuracy %', data: accData,
          backgroundColor: 'rgba(99,102,241,0.15)', borderColor: '#6366f1',
          pointBackgroundColor: '#6366f1'
        }]
      },
      options: { responsive: true, scales: { r: { min: 0, max: 100, ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.1)' } } }, plugins: { legend: { display: false } } }
    });
  }

  // Heatmap
  const weeks = [...new Set(allQuestions.map(q => q.week))].sort((a,b)=>a-b);
  const hm = document.getElementById('accuracyHeatmap');
  if (hm) {
    hm.innerHTML = weeks.map(w => {
      const wQs = allQuestions.filter(q => q.week === w);
      const a = wQs.reduce((s, q) => s + (appData.questionStats[q.id]?.attempts || 0), 0);
      const c = wQs.reduce((s, q) => s + (appData.questionStats[q.id]?.correct || 0), 0);
      const acc = a > 0 ? Math.round((c/a)*100) : 0;
      const col = acc >= 75 ? '#10b981' : acc >= 50 ? '#f59e0b' : acc > 0 ? '#ef4444' : '#252840';
      return `<div class="acc-cell" style="background:${col}">
        <div class="acc-cell-week">Week ${w}</div>
        <div class="acc-cell-val">${acc}%</div>
      </div>`;
    }).join('');
  }

  // Q type chart
  const qtctx = document.getElementById('qTypeChart')?.getContext('2d');
  if (qtctx) {
    if (window._qtChart) window._qtChart.destroy();
    const mcqA = allQuestions.filter(q=>q.type==='MCQ').reduce((s,q)=>s+(appData.questionStats[q.id]?.attempts||0),0);
    const mcqC = allQuestions.filter(q=>q.type==='MCQ').reduce((s,q)=>s+(appData.questionStats[q.id]?.correct||0),0);
    const msqA = allQuestions.filter(q=>q.type==='MSQ').reduce((s,q)=>s+(appData.questionStats[q.id]?.attempts||0),0);
    const msqC = allQuestions.filter(q=>q.type==='MSQ').reduce((s,q)=>s+(appData.questionStats[q.id]?.correct||0),0);
    window._qtChart = new Chart(qtctx, {
      type: 'bar',
      data: {
        labels: ['MCQ', 'MSQ'],
        datasets: [
          { label: 'Attempted', data: [mcqA, msqA], backgroundColor: 'rgba(99,102,241,0.5)', borderRadius: 6 },
          { label: 'Correct', data: [mcqC, msqC], backgroundColor: 'rgba(16,185,129,0.5)', borderRadius: 6 }
        ]
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#8892b0' } } },
        scales: { y: { ticks: { color: '#8892b0' }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#8892b0' }, grid: { display: false } } } }
    });
  }

  // Streak calendar (last 60 days)
  const cal = document.getElementById('streakCalendar');
  if (cal) {
    const days = [];
    for (let i = 59; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toDateString());
    }
    cal.innerHTML = days.map(d => `<div class="streak-day ${appData.streak.includes(d) ? 'active' : ''}" title="${d}"></div>`).join('');
  }
}

// ==================== BOOKMARKS ====================
function renderBookmarks() {
  const weekFilter = document.getElementById('bmWeekFilter')?.value;
  let bms = allQuestions.filter(q => appData.bookmarks.includes(q.id));
  if (weekFilter && weekFilter !== 'all') bms = bms.filter(q => String(q.week) === weekFilter);
  
  const list = document.getElementById('bookmarkList');
  if (bms.length === 0) { list.innerHTML = '<div class="empty-state">No bookmarks yet. Bookmark questions during practice!</div>'; return; }
  list.innerHTML = bms.map(q => `
    <div class="bm-card">
      <div style="flex:1">
        <div style="font-size:0.7rem;color:var(--text3);margin-bottom:6px">Week ${q.week} · ${q.type} · ${q.topic}</div>
        <div style="font-size:0.9rem">${q.question}</div>
      </div>
      <button class="bm-remove" onclick="removeBookmark('${q.id}')">✕</button>
    </div>
  `).join('');
}

function removeBookmark(id) {
  appData.bookmarks = appData.bookmarks.filter(b => b !== id);
  saveAppData();
  renderBookmarks();
  showToast('Bookmark removed');
}

function practiceBookmarks() {
  const bms = allQuestions.filter(q => appData.bookmarks.includes(q.id));
  if (bms.length === 0) { showToast('No bookmarks yet!', 'error'); return; }
  practiceMode = 'bookmarks';
  startPractice(bms);
  showView('practice');
}

// ==================== IMPORT ====================
function showImportTab(tab) {
  document.querySelectorAll('.itab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.import-panel').forEach(p => p.classList.add('hidden'));
  event.target.classList.add('active');
  document.getElementById('itab-' + tab).classList.remove('hidden');
}

// PDF Import - Complete PDF.js based extraction
async function handlePDFUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const progress = document.getElementById('pdfProgress');
  const fill = document.getElementById('pdfProgFill');
  const msg = document.getElementById('pdfProgressMsg');
  progress.classList.remove('hidden');

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    const arrayBuffer = await file.arrayBuffer();
    fill.style.width = '20%'; msg.textContent = 'Loading PDF...';
    
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdfDoc.numPages;
    fill.style.width = '40%'; msg.textContent = `Extracting ${totalPages} pages...`;
    
    let fullText = '';
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n--- PAGE ${pageNum} ---\n` + pageText;
      fill.style.width = (40 + (pageNum / totalPages) * 40) + '%';
    }

    msg.textContent = 'Parsing questions...';
    fill.style.width = '85%';
    
    const questions = parseQuestionsFromText(fullText);
    fill.style.width = '100%';
    msg.textContent = `Found ${questions.length} questions!`;
    
    if (questions.length > 0) {
      setTimeout(() => { progress.classList.add('hidden'); showImportPreview(questions); }, 1000);
    } else {
      msg.textContent = 'Could not auto-detect questions. Try Paste mode instead.';
      showToast('Try pasting the text manually in Paste mode', 'error');
    }
  } catch(e) {
    console.error(e);
    msg.textContent = 'Error reading PDF. Try the Paste Text method.';
    showToast('PDF parse error. Use Paste mode.', 'error');
  }
}

// Universal question text parser - handles NPTEL format
function parseQuestionsFromText(text) {
  const questions = [];
  let currentWeek = 1;

  // Clean and normalize text
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Detect all weeks in the document
  const weekMatches = text.match(/week\s*[:\-]?\s*(\d+)/gi);
  const weeksFound = [...new Set(weekMatches ? weekMatches.map(w => { const m = w.match(/\d+/); return m ? parseInt(m[0]) : 1; }) : [1])];
  if (weeksFound.length > 0) currentWeek = Math.min(...weeksFound);

  // Split by multiple possible question patterns
  // Try to split by "Q1", "Q.", "Question 1", "1." etc.
  let questionBlocks = [];
  
  // Pattern 1: Find numbered questions like "Q1.", "Q1)", "Question 1.", "1.", "1)"
  const qPattern1 = /(?:\bQ\.?\s*\d+|Question\s*\d+|\b\d+[\.)])\s*/gi;
  questionBlocks = text.split(qPattern1).filter(b => b.trim().length > 20);
  
  // If no questions found, try splitting by option patterns A. B. C. D.
  if (questionBlocks.length < 2) {
    const optPattern = /\b[A-D][.)]\s+/gi;
    let parts = text.split(optPattern);
    // Re-group into question blocks
    questionBlocks = [];
    let currentBlock = '';
    parts.forEach((part, idx) => {
      if (idx % 5 === 0) { // Every 5 parts is roughly one question
        if (currentBlock) questionBlocks.push(currentBlock);
        currentBlock = part;
      } else {
        currentBlock += ' ' + part;
      }
    });
    if (currentBlock) questionBlocks.push(currentBlock);
  }

  // Process each block
  let qNum = 1;
  questionBlocks.forEach(block => {
    block = block.trim();
    if (block.length < 30) return; // Skip too short blocks
    
    // Try to extract question number for week detection
    const weekMatch = block.match(/week\s*[:\-]?\s*(\d+)/i);
    if (weekMatch) currentWeek = parseInt(weekMatch[1]);

    // Remove question number prefix safely (guard against potential regex issues)
    let cleanBlock = block;
    try {
      cleanBlock = block.replace(/^(?:Q\.?\s*\d+|Question\s*\d+|\d+[.)]\s*)/i, '').trim();
    } catch (e) {
      cleanBlock = block;
    }
    
    // Extract question text (everything before options)
    let qText = cleanBlock;
    let optLines = [];
    
    // Find option lines (starting with A. B. C. D.)
    const optMatches = cleanBlock.match(/[A-D][.)]\s+[^\n]+/gi);
    if (optMatches && optMatches.length >= 2) {
      optLines = optMatches.map(o => o.replace(/^[A-D][\.\)]\s*/, '').trim());
      // Get question text before first option
      const firstOptIdx = cleanBlock.indexOf(optMatches[0]);
      qText = cleanBlock.substring(0, firstOptIdx).trim();
    } else {
      // Try alternative: options on separate lines
      const lines = cleanBlock.split('\n').filter(l => l.trim().length > 2);
      const optStartIdx = lines.findIndex(l => /^[A-D][\.\)]/.test(l));
      if (optStartIdx > 0) {
        optLines = lines.slice(optStartIdx, optStartIdx + 4).map(l => l.replace(/^[A-D][\.\)]\s*/, '').trim());
        qText = lines.slice(0, optStartIdx).join(' ').trim();
      }
    }

    if (optLines.length < 2 || qText.length < 10) return;

    // Extract correct answer
    let correctIdx = [0];
    let explanation = '';
    
    // Look for answer patterns in the whole original text area
    const answerPatterns = [
      /\b(?:correct|answer|ans|key)\s*[:]?\s*([A-D,\s]+)/gi,
      /\b(?:answer|correct)\s+(?:is\b)?\s*([A-D])/gi
    ];
    
    const blockLower = cleanBlock.toLowerCase();
    for (const pattern of answerPatterns) {
      const match = blockLower.match(pattern);
      if (match) {
        const letters = match[0].match(/[A-D]/g);
        if (letters) {
          correctIdx = letters.map(l => l.charCodeAt(0) - 65);
          break;
        }
      }
    }

    // Try to find explanation
    const expPatterns = [/\b(?:explanation|solution|exp)[:\s]*(.+)/gi, /\b(?:because|therefore|thus)[:\s]*(.+)/gi];
    for (const pattern of expPatterns) {
      const match = cleanBlock.match(pattern);
      if (match && match[1]) {
        explanation = match[1].substring(0, 200);
        break;
      }
    }

    const type = correctIdx.length > 1 ? 'MSQ' : 'MCQ';
    questions.push({
      id: `import_${Date.now()}_${qNum++}`,
      week: currentWeek,
      topic: `Week ${currentWeek}`,
      type: optLines.length > 2 && correctIdx.length > 1 ? 'MSQ' : 'MCQ',
      question: qText.substring(0, 500),
      options: optLines.slice(0, 4),
      correct: correctIdx.filter(i => i >= 0 && i < optLines.length).length > 0 ? correctIdx.filter(i => i >= 0 && i < optLines.length) : [0],
      explanation: explanation || ''
    });
  });

  // If still no questions, try an even simpler approach
  if (questions.length < 2) {
    const lines = text.split('\n');
    let i = 0;
    let questionText = '';
    let options = [];
    let foundCorrect = false;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Skip empty or very short lines
      if (line.length < 3) { i++; continue; }
      
      // Check for week marker
      const wm = line.match(/week\s*[:\-]?\s*(\d+)/i);
      if (wm) { currentWeek = parseInt(wm[1]); }
      
      // Question detection (starts with number or Q)
      if (line.match(/^(\d+[\.\)]|Q[\.\)]?\s*\d+)/i)) {
        // Save previous question if exists
        if (questionText && options.length >= 2) {
          questions.push({
            id: `import_${Date.now()}_${questions.length + 1}`,
            week: currentWeek,
            topic: `Week ${currentWeek}`,
            type: 'MCQ',
            question: questionText.substring(0, 500),
            options: options.slice(0, 4),
            correct: foundCorrect ? [0] : [0], // Default to first option
            explanation: ''
          });
        }
        // Start new question
        questionText = line.replace(/^(\d+[\.\)]|Q[\.\)]?\s*\d+)\s*/, '');
        options = [];
        foundCorrect = false;
      }
      // Option detection
      else if (line.match(/^[A-D][\.\)]/i) && options.length < 4) {
        options.push(line.replace(/^[A-D][\.\)]\s*/, ''));
      }
      // Answer detection
      else if (line.match(/^(?:answer|correct|ans)[:\s]*[A-D]/i)) {
        const ans = line.match(/[A-D]/i);
        if (ans) {
          correctIdx = [ans[0].charCodeAt(0) - 65];
          foundCorrect = true;
        }
      }
      
      i++;
    }
    
    // Add last question
    if (questionText && options.length >= 2) {
      questions.push({
        id: `import_${Date.now()}_${questions.length + 1}`,
        week: currentWeek,
        topic: `Week ${currentWeek}`,
        type: 'MCQ',
        question: questionText.substring(0, 500),
        options: options.slice(0, 4),
        correct: correctIdx || [0],
        explanation: ''
      });
    }
  }

  return questions;
}

async function handleWordUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
      const questions = parseQuestionsFromText(result.value);
      if (questions.length > 0) showImportPreview(questions);
      else showToast('No questions detected. Try Paste mode.', 'error');
    } catch(err) {
      showToast('Could not read Word file', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parsePasteInput() {
  const text = document.getElementById('pasteInput').value;
  if (!text.trim()) { showToast('Please paste some text first', 'error'); return; }
  const questions = parseQuestionsFromText(text);
  if (questions.length > 0) showImportPreview(questions);
  else showToast('Could not parse questions. Check the format hint above.', 'error');
}

function showImportPreview(questions) {
  pendingImport = questions;
  document.getElementById('previewCount').textContent = questions.length;
  const list = document.getElementById('previewList');
  list.innerHTML = questions.map((q, i) => `
    <div class="preview-q-card">
      <div class="pq-meta">Week ${q.week} · ${q.type}</div>
      <strong>Q${i+1}: ${q.question}</strong>
      <div class="pq-options">${q.options.map((o, oi) => `${String.fromCharCode(65+oi)}. ${o}`).join(' | ')}</div>
      <div class="pq-correct">✓ ${q.correct.map(i => String.fromCharCode(65+i)).join(', ')}</div>
    </div>
  `).join('');
  document.getElementById('importPreview').classList.remove('hidden');
}

function closePreview() {
  document.getElementById('importPreview').classList.add('hidden');
  pendingImport = [];
}

function saveImportedQuestions() {
  if (pendingImport.length === 0) {
    showToast('No questions to save', 'error');
    return;
  }
  
  // Add to custom questions in appData
  appData.customQuestions = appData.customQuestions || [];
  pendingImport.forEach(q => {
    // Ensure each question has a unique ID
    q.id = q.id || `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    appData.customQuestions.push(q);
  });
  
  // Save to localStorage
  saveAppData();
  
  // Also update allQuestions array
  allQuestions = [...allQuestions, ...pendingImport];
  updateQCount();
  buildWeekSelectors();
  
  const importCount = pendingImport.length;
  document.getElementById('importPreview').classList.add('hidden');
  pendingImport = [];
  
  showToast(`✅ ${importCount} questions imported! Total: ${allQuestions.length}`, 'success');
  showView('dashboard');
}

function addManualQuestion() {
  const week = parseInt(document.getElementById('mWeek').value) || 1;
  const topic = document.getElementById('mTopic').value.trim() || `Week ${week}`;
  const type = document.getElementById('mType').value;
  const question = document.getElementById('mQuestion').value.trim();
  const opts = [...document.querySelectorAll('.opt-input')].map(i => i.value.trim()).filter(o => o);
  const correctStr = document.getElementById('mCorrect').value.trim().toUpperCase();
  const explanation = document.getElementById('mExplanation').value.trim();

  if (!question || opts.length < 2) { showToast('Please fill question and at least 2 options', 'error'); return; }

  const correctIdx = correctStr.split(',').map(c => c.trim().charCodeAt(0) - 65).filter(n => n >= 0 && n < opts.length);
  if (correctIdx.length === 0) { showToast('Please specify correct answer(s)', 'error'); return; }

  const q = { id: `manual_${Date.now()}`, week, topic, type, question, options: opts, correct: correctIdx, explanation };
  showImportPreview([q]);
}

// ==================== EXPORT ====================
function exportResults() {
  const data = {
    exportDate: new Date().toISOString(),
    totalAttempts: appData.attempts.length,
    attempts: appData.attempts,
    questionStats: appData.questionStats,
    summary: {
      avgScore: appData.attempts.length ? Math.round(appData.attempts.reduce((s,a)=>s+a.pct,0)/appData.attempts.length) : 0,
      highScore: appData.attempts.length ? Math.max(...appData.attempts.map(a=>a.pct)) : 0
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'nptel_iot_results.json';
  a.click();
  showToast('Results exported!', 'success');
}

// ==================== UTILITY ====================
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function saveModalNote() {
  if (currentNoteQId) {
    appData.notes[currentNoteQId] = document.getElementById('noteModalInput').value;
    saveAppData();
  }
  closeModal('noteModal');
  showToast('Note saved!', 'success');
}

// Force initialize on load
window.addEventListener('DOMContentLoaded', () => {
  // Initialize app immediately
  init();
});

// Also handle window load as backup
window.addEventListener('load', init);
