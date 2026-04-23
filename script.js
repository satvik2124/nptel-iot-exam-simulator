// NPTEL IoT Exam Simulator - Core logic (vanilla JS, single-file approach)
// This file wires up: import, parsing, preview, exam engine, dashboard, study, and storage

// Global state
let QUESTION_BANK = []; // loaded questions
let IMPORT_PREVIEW = []; // temporary preview during import
let CURRENT_SESSION = null; // active exam session
let QUESTION_INDEX_MAP = []; // for current palette order
let TIMER_INTERVAL = null;

// Helpers
const storageKey = "nptele_questions_v1";
function loadQuestionsFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      QUESTION_BANK = JSON.parse(raw);
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}
function saveQuestionsToStorage() {
  localStorage.setItem(storageKey, JSON.stringify(QUESTION_BANK));
}
function fetchDefaultQuestions() {
  // Load bundled sample if available
  return fetch("questions.json").then(r => r.json()).catch(() => []);
}
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function generateId(prefix="q") { return prefix + "_" + Math.random().toString(36).slice(2,9); }
function formatTime(s) {
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return [h>0?String(h).padStart(2,'0'):null, String(m).padStart(2,'0'), String(sec).padStart(2,'0')].filter(x=>x!==null).join(':');
}

// Import: PDF parsing
async function parsePDFFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Use PDF.js to extract text per page
  const loadingTask = pdfjsLib.getDocument({data: arrayBuffer});
  const pdf = await loadingTask.promise;
  let pagesText = [];
  for (let i=1; i<=pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const txtContent = await page.getTextContent();
      const strings = txtContent.items.map(it => it.str);
      pagesText.push(strings.join(" "));
    } catch (e) {
      // skip problematic page
      pagesText.push("");
    }
  }
  const fullText = pagesText.join("\n");
  // OCR fallback placeholder if empty
  if (!fullText || fullText.trim().length < 20) {
    // Try simple OCR via Tesseract on the entire image would require rendering pages to canvas;
    // For brevity, skip OCR here and rely on manual edits from preview.
  }
  return fullText;
}

function tryParseBlocksFromText(text) {
  // Very lightweight heuristic parser
  // Split into candidate blocks by double newline
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(b => b.length>0);
  const questions = [];
  for (const block of blocks) {
    // detect options A-D
    const aIdx = block.indexOf("A.");
    const bIdx = block.indexOf("B.");
    const cIdx = block.indexOf("C.");
    const dIdx = block.indexOf("D.");
    let qText = "";
    let opts = [];
    if (aIdx>-1 && bIdx>-1 && cIdx>-1 && dIdx>-1) {
      qText = block.substring(0, aIdx).trim();
      const oA = block.substring(aIdx+2, bIdx).trim();
      const oB = block.substring(bIdx+2, cIdx).trim();
      const oC = block.substring(cIdx+2, dIdx).trim();
      const oD = block.substring(dIdx+2, block.length).trim();
      opts = [oA,oB,oC,oD];
    } else {
      // Fallback: break block by lines with A/B/C/D markers
      const lines = block.split(/\n/);
      let idxA=-1, idxB=-1, idxC=-1, idxD=-1;
      for (let i=0;i<lines.length;i++){
        const l = lines[i].trim();
        if (l.startsWith("A.")) { idxA = i; }
        else if (l.startsWith("B.")) { idxB = i; }
        else if (l.startsWith("C.")) { idxC = i; }
        else if (l.startsWith("D.")) { idxD = i; }
      }
      if (idxA>=0 && idxB>=0 && idxC>=0 && idxD>=0) {
        qText = lines.slice(0, idxA).join(" ").trim();
        const a = lines[idxA].replace(/^[A.]\s*/,'').trim();
        const b = lines[idxB].replace(/^[B.]\s*/,'').trim();
        const c = lines[idxC].replace(/^[C.]\s*/,'').trim();
        const d = lines[idxD].replace(/^[D.]\s*/,'').trim();
        opts = [a,b,c,d];
      }
    }
    if (qText && opts.length===4) {
      const q = {
        id: generateId(),
        week: 1,
        text: qText,
        options: opts.map((t,i)=>({label: ["A","B","C","D"][i], text: t})),
        correct: [], // unknown
        explanation: "",
        tags: ["week-1"]
      };
      questions.push(q);
    }
  }
  return questions;
}

// Convert parsed blocks to questions.json structure
function convertBlocksToQuestions(blocks) {
  // Normalize to required shape
  return blocks.map((b, idx) => ({
    id: b.id || generateId("q"),
    week: b.week || 1,
    text: b.text || "",
    options: b.options.map((t,i)=>({label: ["A","B","C","D"][i], text: t})),
    correct: b.correct && b.correct.length ? b.correct : [0], // default to first option
    explanation: b.explanation || "",
    tags: b.tags || [`week-${b.week||1}`]
  }));
}

function renderPreviewList(items) {
  const el = document.getElementById("previewList");
  el.innerHTML = "";
  items.forEach((q, idx) => {
    const div = document.createElement("div");
    div.className = "preview-item";
    div.innerHTML = `
      <div><strong>Q${idx+1}</strong> (${q.week})</div>
      <div class="q-text" contenteditable="false">${escapeHtml(q.text)}</div>
      <ol type="A" class="opts">
        ${q.options.map(o => `<li>${escapeHtml(o.text)}</li>`).join("")}
      </ol>
      <div class="muted">Correct: ${q.correct.map(i => ["A","B","C","D"][i]).join(", ")}</div>
      <div>Explanation: <span class="muted">${escapeHtml(q.explanation || "")}</span></div>
    `;
    el.appendChild(div);
  });
}
function escapeHtml(s){ return (""+s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Import handlers
document.addEventListener("DOMContentLoaded", () => {
  // Initialize
  loadQuestionsFromStorage();
  fetchDefaultQuestions().then((q)=>{ if(q && q.length>0){ QUESTION_BANK = q; saveQuestionsToStorage(); } });
  // Tabs
  document.querySelectorAll(".topnav button").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".panel").forEach(p => p.hidden = true);
      document.getElementById(tab).hidden = false;
    });
  });
  // PDF import
  const pdfInput = document.getElementById("pdfInput");
  pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await parsePDFFile(file);
    const blocks = tryParseBlocksFromText(text);
    IMPORT_PREVIEW = convertBlocksToQuestions(blocks.map(b => ({
      week: b.week || 1,
      text: b.text || "",
      options: b.options?.map(o => o.text) || [],
      correct: b.correct || [],
      explanation: b.explanation || "",
      tags: b.tags || []
    })));
    renderPreviewList(IMPORT_PREVIEW);
    document.getElementById("saveImported").disabled = false;
  });
  // Word import
  const wordInput = document.getElementById("wordInput");
  wordInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuf = await file.arrayBuffer();
    Mammoth.convertToHtml({arrayBuffer: arrayBuf})
      .then(result => {
        const text = (result.value || "").replace(/<[^>]+>/g, " ").trim();
        const blocks = tryParseBlocksFromText(text);
        IMPORT_PREVIEW = convertBlocksToQuestions(blocks.map(b => ({
          week: b.week || 1,
          text: b.text || "",
          options: b.options?.map(o => o.text) || [],
          correct: b.correct || [],
          explanation: b.explanation || "",
          tags: b.tags || []
        })));
        renderPreviewList(IMPORT_PREVIEW);
        document.getElementById("saveImported").disabled = false;
      });
  });
  // Demo parse
  document.getElementById("demoParse").addEventListener("click", () => {
    const sample = [
      {
        week:1,
        text:"What is the unit of electrical resistance?",
        options:["Ohm","Newton","Hertz","Joule"],
        correct:[0],
        explanation:"The unit of resistance is the Ohm (Ω)."
      },
      {
        week:1,
        text:"Which protocol is commonly used for IoT devices in home automation?",
        options:["HTTP","MQTT","FTP","SMTP"],
        correct:[1],
        explanation:"MQTT is lightweight and designed for unreliable networks."
      }
    ];
    IMPORT_PREVIEW = sample.map(s => ({
      id: generateId("q"),
      week: s.week,
      text: s.text,
      options: s.options.map((t,i)=>({label: ["A","B","C","D"][i], text: t})),
      correct: s.correct,
      explanation: s.explanation,
      tags: [`week-${s.week}`]
    }));
    renderPreviewList(IMPORT_PREVIEW);
    document.getElementById("saveImported").disabled = false;
  });
  // Save imported
  document.getElementById("saveImported").addEventListener("click", () => {
    if (!IMPORT_PREVIEW.length) return;
    // Merge with bank
    const merged = QUESTION_BANK.concat(IMPORT_PREVIEW.map(q => ({
      id: q.id,
      week: q.week,
      text: q.text,
      options: q.options,
      correct: q.correct,
      explanation: q.explanation,
      tags: q.tags
    })));
    QUESTION_BANK = merged;
    saveQuestionsToStorage();
    IMPORT_PREVIEW = [];
    document.getElementById("previewList").innerHTML = "";
    document.getElementById("saveImported").disabled = true;
    alert("Imported questions saved. Total: " + QUESTION_BANK.length);
  });
  // Start demo: load questions into exam queue
  document.getElementById("startMock").addEventListener("click", () => {
    startExamSession();
  });
  // Prev/Next
  document.getElementById("prevBtn").addEventListener("click", ()=> navigateQuestion(-1));
  document.getElementById("nextBtn").addEventListener("click", ()=> navigateQuestion(+1));
  document.getElementById("markForReview").addEventListener("click", ()=> toggleMarkCurrent());
  document.getElementById("submitExam").addEventListener("click", ()=> submitExam());
  document.getElementById("clearAnswer").addEventListener("click", ()=> clearCurrentAnswer());
  // Initialize
  // Load default questions into memory for editing
  if (QUESTION_BANK.length===0) {
    QUESTION_BANK = [];
    saveQuestionsToStorage();
  }
});

function startExamSession() {
  if (!QUESTION_BANK || QUESTION_BANK.length===0) {
    alert("No questions loaded. Import or add questions first.");
    return;
  }
  const pool = QUESTION_BANK.slice();
  const mode = document.getElementById("modeSelect").value;
  let chosen = [];
  if (mode === "full") {
    chosen = pool;
  } else if (mode === "week") {
    chosen = pool.filter(q => q.week <= 2); // simple filter
  } else {
    chosen = pool;
  }
  // Shuffle questions order
  const shuffled = shuffleArray(chosen);
  // Build per-question session data
  const sessions = shuffled.map((q, idx) => ({
    qid: q.id,
    index: idx,
    shuffledIndices: shuffleArray([0,1,2,3]),
    answered: [],
    marked: false
  }));
  CURRENT_SESSION = {
    id: Date.now(),
    questions: shuffled.map((q, i) => ({
      ...q,
      sessionMeta: sessions.find(s => s.qid === q.id)
    })),
    startTs: Date.now(),
    durationSec: 20 * 60, // 20 minutes
    answered: new Array(shuffled.length).fill(null),
    mode
  };
  QUESTION_INDEX_MAP = CURRENT_SESSION.questions.map((q,i)=>i);
  renderQuestionAtIndex(0);
  // Timer
  startTimer(CURRENT_SESSION.durationSec);
  // Show exam panel
  document.getElementById("exam").hidden = false;
  document.getElementById("import").hidden = true;
}

function renderQuestionAtIndex(i) {
  if (!CURRENT_SESSION) return;
  const q = CURRENT_SESSION.questions[i];
  // compute order once per question
  const order = q.sessionMeta?.shuffledIndices ?? [0,1,2,3];
  // render question
  document.getElementById("qCounter").textContent = `Q${i+1}`;
  document.getElementById("qWeek").textContent = `Week ${q.week}`;
  const textEl = document.getElementById("questionText");
  textEl.textContent = q.text;
  const optionsEl = document.getElementById("options");
  optionsEl.innerHTML = "";
  // Determine if MSQ
  const isMSQ = q.correct?.length > 1;
  // Create inputs
  const selectedPositions = CURRENT_SESSION.answered[i] || [];
  order.forEach((origIndex, pos) => {
    const o = q.options[origIndex] || {text: ""};
    const inputId = `opt_${i}_${pos}`;
    const label = document.createElement("label");
    label.className = "option-item";
    const input = document.createElement(isMSQ ? "input" : "input");
    input.type = isMSQ ? "checkbox" : "radio";
    input.name = `q_${i}`;
    input.id = inputId;
    input.checked = selectedPositions.includes(pos);
    input.dataset.pos = pos;
    const span = document.createElement("span");
    span.textContent = ` ${o.label}. ${o.text}`;
    label.appendChild(input);
    label.appendChild(span);
    const container = document.createElement("div");
    container.appendChild(label);
    optionsEl.appendChild(container);
  });
  // Set palette
  renderPalette();
}

function renderPalette() {
  const paletteEl = document.getElementById("palette");
  paletteEl.innerHTML = "";
  const n = CURRENT_SESSION?.questions?.length || 0;
  for (let i=0;i<n;i++){
    const btn = document.createElement("button");
    btn.className = "pill";
    btn.textContent = i+1;
    btn.title = "Question " + (i+1);
    btn.style.opacity = "0.9";
    btn.addEventListener("click", () => renderQuestionAtIndex(i));
    // status dot
    const answered = CURRENT_SESSION?.answered?.[i];
    if (answered != null) btn.style.background = "#3b82f6";
    paletteEl.appendChild(btn);
  }
}

function navigateQuestion(delta) {
  if (!CURRENT_SESSION) return;
  const idx = getCurrentIndex();
  let next = idx + delta;
  if (next < 0) next = 0;
  if (next >= CURRENT_SESSION.questions.length) next = CURRENT_SESSION.questions.length - 1;
  renderQuestionAtIndex(next);
}

function getCurrentIndex() {
  // naive: based on a displayed Q number
  const qCounter = document.getElementById("qCounter").textContent;
  const num = parseInt(qCounter.replace(/\D/g, "")) - 1;
  return isNaN(num) ? 0 : Math.max(0, Math.min(CURRENT_SESSION.questions.length-1, num));
}

function collectCurrentAnswer() {
  // Read inputs for current question
  const idx = getCurrentIndex();
  const q = CURRENT_SESSION.questions[idx];
  if (!q) return [];
  const isMSQ = q.correct?.length > 1;
  const order = q.sessionMeta?.shuffledIndices ?? [0,1,2,3];
  const selections = [];
  for (let pos=0; pos<order.length; pos++) {
    const input = document.querySelector(`#opt_${idx}_${pos}`);
    if (input && input.checked) selections.push(pos);
  }
  return selections;
}

function clearCurrentAnswer() {
  const idx = getCurrentIndex();
  const q = CURRENT_SESSION.questions[idx];
  if (!q) return;
  const order = q.sessionMeta?.shuffledIndices ?? [0,1,2,3];
  order.forEach((_, pos)=> {
    const el = document.querySelector(`#opt_${idx}_${pos}`);
    if (el) el.checked = false;
  });
  CURRENT_SESSION.answered[idx] = [];
  renderPalette();
}

function toggleMarkCurrent() {
  const idx = getCurrentIndex();
  if (!CURRENT_SESSION) return;
  const x = CURRENT_SESSION.questions[idx];
  if (!x) return;
  x.sessionMeta.marked = !x.sessionMeta.marked;
  renderPalette();
}

function startTimer(sec) {
  let remaining = sec;
  const display = document.getElementById("timerDisplay");
  if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
  TIMER_INTERVAL = setInterval(() => {
    const mins = Math.floor(remaining/60);
    const secs = remaining%60;
    display.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    if (remaining<=0) {
      clearInterval(TIMER_INTERVAL);
      submitExam(true);
    }
    remaining--;
  }, 1000);
}

function submitExam(auto=false) {
  if (!CURRENT_SESSION) return;
  // collect answers
  const results = [];
  let score = 0;
  for (let i=0; i<CURRENT_SESSION.questions.length; i++) {
    // compute selected from DOM
    const idx = i;
    const q = CURRENT_SESSION.questions[i];
    const selected = [];
    const order = q.sessionMeta?.shuffledIndices ?? [0,1,2,3];
    for (let pos=0; pos<order.length; pos++) {
      const input = document.querySelector(`#opt_${idx}_${pos}`);
      if (input && input.checked) selected.push(pos);
    }
    // map to original indices
    const origSelected = selected.map(p => order[p]);
    // Determine correctness
    const correctSet = new Set(q.correct);
    const userSet = new Set(origSelected);
    const isCorrect = (correctSet.size === userSet.size) && [...correctSet].every(x => userSet.has(x));
    if (isCorrect) score += 1;
    results.push({qid: q.id, index: i, selected: origSelected, isCorrect, correct: q.correct});
    // update answer
    CURRENT_SESSION.answered[i] = selected;
  }
  // Save attempt to storage
  const attempt = {
    id: CURRENT_SESSION.id,
    mode: CURRENT_SESSION.mode,
    total: CURRENT_SESSION.questions.length,
    score,
    timestamp: Date.now(),
    questions: CURRENT_SESSION.questions.map((q,i)=>({
      id: q.id,
      week: q.week,
      text: q.text,
      selected: CURRENT_SESSION.answered[i] || [],
      correct: q.correct,
      isCorrect: results[i]?.isCorrect
    }))
  };
  const attempts = JSON.parse(localStorage.getItem("nptele_attempts_v1") || "[]");
  attempts.push(attempt);
  localStorage.setItem("nptele_attempts_v1", JSON.stringify(attempts));
  // Display results
  showResults(attempt);
}

function showResults(attempt) {
  // Simple overlay of results
  const container = document.getElementById("examArea");
  const total = attempt.total;
  const score = attempt.score;
  let correctCount = 0;
  const review = attempt.questions.map((q,i)=> {
    const ok = q.isCorrect;
    if (ok) correctCount++;
    return `<div style="border-bottom:1px solid #333;margin:6px 0;padding-bottom:6px;">
      <div><strong>Q${i+1}</strong> ${q.text}</div>
      <div>Selected: ${q.selected.map(n => ["A","B","C","D"][n]).join(", ") || "None"}</div>
      <div>Correct: ${q.correct.map(n=>["A","B","C","D"][n]).join(", ")}</div>
      <div>Result: ${ok ? "<span style='color:#4ade80'>Correct</span>" : "<span style='color:#f87171'>Wrong</span>"}</div>
    </div>`;
  }).join("");
  const html = `
    <div class="card" style="flex:1;">
      <h3>Exam Summary</h3>
      <p>Total Questions: ${total}</p>
      <p>Score: ${score} / ${total} (${Math.round((score/total)*100)}%)</p>
      <div style="max-height:320px;overflow:auto;">${review}</div>
      <button class="btn" id="exportPdfBtn">Export Results PDF</button>
      <button class="btn secondary" id="backBtn">Back to Exam List</button>
    </div>
  `;
  container.innerHTML = html;
  document.getElementById("exportPdfBtn").addEventListener("click", () => exportResultsPDF(attempt));
  document.getElementById("backBtn").addEventListener("click", () => {
    // Reset
    document.getElementById("exam").hidden = true;
    document.getElementById("import").hidden = false;
    container.innerHTML = "";
  });
  // Stop timer
  if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
}

function exportResultsPDF(attempt) {
  // Simple PDF export using jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("NPTEL IoT Exam - Results", 10, 10);
  doc.text(`Score: ${attempt.score} / ${attempt.total} (${Math.round((attempt.score/attempt.total)*100)}%)`, 10, 20);
  let y = 30;
  attempt.questions.forEach((q, idx) => {
    doc.text(`${idx+1}. Q: ${q.text}`, 10, y);
    y += 6;
  });
  doc.save("nptele_result.pdf");
}

// Helper: get element by id
function $(id){ return document.getElementById(id); }

// End of core logic skeleton
