#!/usr/bin/env node
/* One-off refactor: mock-test shell + per-paper JSON.  Deleted after use. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const REF = path.join(ROOT, "question-papers", "subjects", "Biology & Public Health Mock Test.html");
const SHELL = path.join(ROOT, "mock-test.html");
const OUT_DIR = path.join(ROOT, "question-papers", "573");

const log = (...a) => console.log(...a);
const readUtf8 = (p) => fs.readFileSync(p, "utf8");
function writeUtf8(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, { encoding: "utf8" }); // UTF-8, no BOM
}

/* Find the array that a `const sourceQuestions = [...]` declaration holds.
   Scans with a small tokenizer that skips strings, template literals and
   comments, so brackets inside content cannot confuse it. */
function matchBracket(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i < 1) break; continue; }
    if (c === "`") {
      i++;
      while (i < src.length && src[i] !== "`") { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return i; }
  }
  throw new Error("unbalanced brackets");
}

function extractQuestions(html, name) {
  const re = new RegExp("(?:const|var|let)\\s+" + name + "\\s*=\\s*\\[");
  const m = re.exec(html);
  if (!m) throw new Error("declaration not found: " + name);
  const open = m.index + m[0].length - 1;
  const close = matchBracket(html, open);
  const literal = html.slice(open, close + 1);
  const arr = vm.runInNewContext("(" + literal + ")", Object.create(null));
  if (!Array.isArray(arr)) throw new Error(name + " did not evaluate to an array");
  return arr;
}

/* =================== STEP 1 + 2 : mock-test.html =================== */
const H = readUtf8(REF);
let html = H;
const applied = [];

/* 1a — blocking sync loader, before any other <script> */
const SYNC_LOADER = [
  "<script>",
  "(function(){",
  '  var p = location.pathname.replace(/\\\\/g, "/"),',
  "      m = p.match(/^(.*?\\/)(?:topics|chapters|question-papers|mock-tests|subjects)\\//),",
  '      b = m ? m[1] : p.replace(/[^\\/]*$/, "");',
  '  if (!window.KPSC_Sync) document.write(\'<script src="\' + b + \'assets/js/sync.js"><\\/script>\');',
  "})();",
  "</script>",
  "",
].join("\n");
if (!html.includes("</head>")) throw new Error("no </head>");
html = html.replace("</head>", SYNC_LOADER + "</head>");
applied.push("1a sync loader");

/* 1b — CONFIG.SHUFFLE_OPTIONS + makeShuffleOrder */
const CONFIG_OLD = "const CONFIG={SECONDS_PER_QUESTION:30,NEGATIVE_MARKING:0.33,AUTO_SUBMIT_ON_TIMEOUT:true,AUTO_PAUSE_ON_TAB_SWITCH:true,STORAGE_KEY:'kpsc_bio_health_v2',STORAGE_VERSION:2};";
const CONFIG_NEW = "const CONFIG={SECONDS_PER_QUESTION:30,NEGATIVE_MARKING:0.33,AUTO_SUBMIT_ON_TIMEOUT:true,AUTO_PAUSE_ON_TAB_SWITCH:true,SHUFFLE_OPTIONS:true,STORAGE_KEY:'kpsc_bio_health_v2',STORAGE_VERSION:2};";
if (!html.includes(CONFIG_OLD)) throw new Error("CONFIG line not found verbatim");
html = html.replace(CONFIG_OLD, CONFIG_NEW);
applied.push("1b SHUFFLE_OPTIONS");

/* deviation (reported): per-paper timing / marking / storage must be assignable */
const CONST_OLD = "const STORAGE_KEY=CONFIG.STORAGE_KEY,STORAGE_VERSION=CONFIG.STORAGE_VERSION,SECONDS_PER_QUESTION=CONFIG.SECONDS_PER_QUESTION,NEGATIVE_MARKING=CONFIG.NEGATIVE_MARKING;";
const SHUFFLE_FN = [
  "",
  "function makeShuffleOrder(n) {",
  "  const a = Array.from({ length: n }, (_, i) => i);",
  "  for (let i = a.length - 1; i > 0; i--) {",
  "    const j = Math.floor(Math.random() * (i + 1));",
  "    [a[i], a[j]] = [a[j], a[i]];",
  "  }",
  "  return a;",
  "}",
  "",
].join("\n");
const CONST_NEW = [
  "const STORAGE_VERSION=CONFIG.STORAGE_VERSION;",
  "let STORAGE_KEY=CONFIG.STORAGE_KEY,SECONDS_PER_QUESTION=CONFIG.SECONDS_PER_QUESTION,NEGATIVE_MARKING=CONFIG.NEGATIVE_MARKING;",
  SHUFFLE_FN.trimEnd(),
].join("\n");
if (!html.includes(CONST_OLD)) throw new Error("const line not found verbatim");
html = html.replace(CONST_OLD, CONST_NEW);
applied.push("1b makeShuffleOrder + mutable per-paper consts");

/* 1c — drop the 25 questions */
const ARR_START = "const sourceQuestions=[";
const arrStart = html.indexOf(ARR_START);
const arrEnd = html.indexOf("\n];\n\n/* =====================================================================\n   STATE", arrStart);
if (arrStart < 0 || arrEnd < 0) throw new Error("sourceQuestions block bounds not found");
html = html.slice(0, arrStart) + "let sourceQuestions = [];" + html.slice(arrEnd + "\n];".length);
applied.push("1c empty sourceQuestions");

/* 1d — loader replaces initTest() */
const LOADER = String.raw`async function loadPaperAndStart() {
  const params = new URLSearchParams(location.search);
  let paperPath = params.get('paper');

  if (!paperPath) {
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;font-family:system-ui">' +
      '<h2>⚠️ No paper specified</h2>' +
      '<p>Open as <code>mock-test.html?paper=573/qp-573-bio-001.json</code></p>' +
      '<p><a href="question-papers/index.html">← Back to all mock tests</a></p></div>';
    return;
  }

  if (!paperPath.startsWith('http') && !paperPath.includes('/')) {
    paperPath = '573/' + paperPath;
  }
  if (!paperPath.startsWith('http') && !paperPath.startsWith('question-papers/')) {
    paperPath = 'question-papers/' + paperPath;
  }

  try {
    if (window.KPSC_Sync && window.KPSC_Sync.whenReady) {
      await window.KPSC_Sync.whenReady(8000);
    }
    const res = await fetch(paperPath, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + paperPath);
    const data = await res.json();
    if (!data.questions || !Array.isArray(data.questions)) {
      throw new Error('JSON is missing the "questions" array');
    }
    sourceQuestions = data.questions;
    if (data.secondsPerQuestion) CONFIG.SECONDS_PER_QUESTION = data.secondsPerQuestion;
    if (data.negativeMarking)    CONFIG.NEGATIVE_MARKING     = data.negativeMarking;
    if (data.shuffleOptions !== undefined) CONFIG.SHUFFLE_OPTIONS = data.shuffleOptions;
    if (data.title) {
      document.querySelector('.header-title').textContent = data.title;
      document.title = data.title + ' – Kerala PSC';
    }
    SECONDS_PER_QUESTION = CONFIG.SECONDS_PER_QUESTION;
    NEGATIVE_MARKING     = CONFIG.NEGATIVE_MARKING;
    if (data.id) STORAGE_KEY = CONFIG.STORAGE_KEY = 'kpsc_paper_' + data.id;
    if (!sourceQuestions.length) {
      document.body.innerHTML =
        '<div style="padding:40px;text-align:center;font-family:system-ui">' +
        '<h2>🗒️ No questions yet</h2>' +
        '<p>This paper has no questions in its JSON file.</p>' +
        '<p><a href="question-papers/index.html">← Back to all mock tests</a></p></div>';
      return;
    }
    initTest();
  } catch (err) {
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;font-family:system-ui">' +
      '<h2>❌ Could not load paper</h2>' +
      '<p style="color:#b32d2d">' + err.message + '</p>' +
      '<p style="font-size:.85rem;color:#666">Requested: <code>' + paperPath + '</code></p>' +
      '<p><a href="question-papers/index.html">← Back to all mock tests</a></p></div>';
  }
}
loadPaperAndStart();`;
const initIdx = html.lastIndexOf("initTest();");
if (initIdx < 0) throw new Error("initTest() call not found");
html = html.slice(0, initIdx) + LOADER + html.slice(initIdx + "initTest();".length);
applied.push("1d paper loader");

/* 2a — startNewTest shuffle */
const NT_OLD = "questionStates=questions.map(()=>({selectedOption:null,status:'idle',markedForReview:false,visited:false}));";
const NT_NEW = "questionStates=questions.map(q=>({selectedOption:null,status:'idle',markedForReview:false,visited:false,shuffleOrder:CONFIG.SHUFFLE_OPTIONS?makeShuffleOrder(q.options.length):q.options.map((_,i)=>i)}));";
if (!html.includes(NT_OLD)) throw new Error("startNewTest state line not found");
html = html.replace(NT_OLD, NT_NEW);
applied.push("2a startNewTest shuffle");

/* 2b — resumeAttempt */
const RS_OLD = "questionStates=s.questionStates.map(st=>({selectedOption:st.selectedOption,status:st.status,markedForReview:st.markedForReview,visited:st.visited}));while(questionStates.length<questions.length)questionStates.push({selectedOption:null,status:'idle',markedForReview:false,visited:false});";
const RS_NEW = "questionStates=s.questionStates.map((st,i)=>({selectedOption:st.selectedOption,status:st.status,markedForReview:st.markedForReview,visited:st.visited,shuffleOrder:st.shuffleOrder||(CONFIG.SHUFFLE_OPTIONS?makeShuffleOrder(questions[i].options.length):questions[i].options.map((_,j)=>j))}));while(questionStates.length<questions.length){const q=questions[questionStates.length];questionStates.push({selectedOption:null,status:'idle',markedForReview:false,visited:false,shuffleOrder:CONFIG.SHUFFLE_OPTIONS?makeShuffleOrder(q.options.length):q.options.map((_,i)=>i)});}";
if (!html.includes(RS_OLD)) throw new Error("resumeAttempt block not found");
html = html.replace(RS_OLD, RS_NEW);
applied.push("2b resumeAttempt shuffle");

/* 2c — renderOptions */
const roStart = html.indexOf("function renderOptions(){");
const roEnd = html.indexOf("\n", roStart);
if (roStart < 0 || roEnd < 0) throw new Error("renderOptions not found");
const RENDER_NEW = String.raw`function renderOptions(){
  const q=questions[currentIndex],st=questionStates[currentIndex],list=document.getElementById('optionsList');
  list.innerHTML='';
  const locked=st.status==='saved'||st.status==='revealed';
  const order=st.shuffleOrder||q.options.map((_,i)=>i);
  order.forEach((origIdx,displayPos)=>{
    const b=document.createElement('button');
    b.className='option-btn';
    const displayLabel=String.fromCharCode(65+displayPos);
    const content=String(q.options[origIdx]).replace(/^[A-D]\)\s*/,'');
    b.textContent=displayLabel+') '+content;
    if(locked){
      b.classList.add('locked');
      if(origIdx===q.correct)b.classList.add('correct-highlight');
      else if(origIdx===st.selectedOption)b.classList.add('wrong-highlight');
    }else{
      if(origIdx===st.selectedOption)b.classList.add('selected');
      b.onclick=()=>{st.selectedOption=origIdx;renderOptions();renderActionButtons();throttledSave()};
    }
    list.appendChild(b);
  });
}`;
html = html.slice(0, roStart) + RENDER_NEW + html.slice(roEnd);
applied.push("2c renderOptions");

/* 2d — keyboard 1-4 */
const KEY_OLD = "if(e.key>='1'&&e.key<='4'&&!locked){const i=parseInt(e.key,10)-1;if(i<questions[currentIndex].options.length){st.selectedOption=i;renderOptions();renderActionButtons();throttledSave();e.preventDefault()}}";
const KEY_NEW = "if(e.key>='1'&&e.key<='4'&&!locked){const displayPos=parseInt(e.key,10)-1;const order=st.shuffleOrder||questions[currentIndex].options.map((_,i)=>i);if(displayPos<order.length){st.selectedOption=order[displayPos];renderOptions();renderActionButtons();throttledSave();e.preventDefault()}}";
if (!html.includes(KEY_OLD)) throw new Error("keydown block not found");
html = html.replace(KEY_OLD, KEY_NEW);
applied.push("2d keyboard");

/* 2e — relabelAnalysis above renderLearningPanel */
const RELABEL = [
  "function relabelAnalysis(analysis, shuffleOrder) {",
  "  if (!analysis || !shuffleOrder) return analysis || [];",
  "  return analysis.map((txt, origIdx) => {",
  "    if (origIdx >= shuffleOrder.length) return txt;",
  "    const newPos = shuffleOrder.indexOf(origIdx);",
  "    if (newPos < 0) return txt;",
  "    return String(txt).replace(/^[A-D]\\)/, String.fromCharCode(65 + newPos) + ')');",
  "  });",
  "}",
  "",
].join("\n");
const LP_MARK = "function renderLearningPanel(){";
if (!html.includes(LP_MARK)) throw new Error("renderLearningPanel marker not found");
html = html.replace(LP_MARK, RELABEL + LP_MARK);
applied.push("2e relabelAnalysis");

/* 2f — relabel the option analysis list */
const OA_OLD = "q.optionAnalysis.forEach(oa=>{const cl=oa.includes('✅')?'correct':'wrong';h+='<div class=\"lp-option-item '+cl+'\">'+escapeHtml(oa)+'</div>'});";
if (!html.includes(OA_OLD)) throw new Error("optionAnalysis loop not found");
html = html.replace(OA_OLD, OA_OLD.replace("q.optionAnalysis.forEach", "relabelAnalysis(q.optionAnalysis,st.shuffleOrder).forEach"));
applied.push("2f relabelled analysis");

/* 2g — shuffled banner */
const LH_OLD = "  const b=document.getElementById('learningBody');\n  let h='';\n";
const BANNER = [
  "  if (st.shuffleOrder && CONFIG.SHUFFLE_OPTIONS) {",
  "    const map = st.shuffleOrder.map((orig, disp) =>",
  "      String.fromCharCode(65 + disp) + '→' + String.fromCharCode(65 + orig)",
  "    ).join('  ');",
  "    h += '<div style=\"background:#eef4ff;border-left:4px solid #2c3e8f;' +",
  "         'padding:8px 12px;margin-bottom:12px;font-size:.78rem;' +",
  "         'border-radius:0 6px 6px 0;\">ℹ️ Options are shuffled. ' +",
  "         'Current → original: <b>' + map + '</b><br>' +",
  "         '<span style=\"color:#5b6b85;\">“Rejection Method” and “PSC കെണി” ' +",
  "         'sections below use the <b>original</b> letters.</span></div>';",
  "  }",
].join("\n");
if (!html.includes(LH_OLD)) throw new Error("let h='' not found");
html = html.replace(LH_OLD, LH_OLD + BANNER + "\n");
applied.push("2g shuffle banner");

writeUtf8(SHELL, html);
log("STEP 1-2  created mock-test.html (" + html.split("\n").length + " lines)");
applied.forEach((a) => log("   · " + a));

/* =================== STEP 3 : JSON =================== */
const bioQuestions = extractQuestions(H, "sourceQuestions");
log("\nSTEP 3    biology questions extracted: " + bioQuestions.length);

writeUtf8(path.join(OUT_DIR, "qp-573-bio-001.json"), JSON.stringify({
  id: "qp-573-bio-001",
  title: "Biology & Public Health Mock Test",
  titleMl: "ജീവശാസ്ത്രവും പൊതുജനാരോഗ്യവും",
  secondsPerQuestion: 30,
  negativeMarking: 0.33,
  shuffleOptions: true,
  questions: bioQuestions,
}, null, 2) + "\n");
log("          qp-573-bio-001.json");

for (const [htmlFile, jsonFile, meta] of [
  ["qp-573-001-full-mock-1.html", "qp-573-001-full-mock-1.json",
    { id: "qp-001", title: "Full Length Mock Test 1", titleMl: "പൂർണ്ണ ദൈർഘ്യ മോക്ക് ടെസ്റ്റ് 1", qs: 100, duration: 75 }],
  ["qp-573-002-full-mock-2.html", "qp-573-002-full-mock-2.json",
    { id: "qp-002", title: "Full Length Mock Test 2", titleMl: "പൂർണ്ണ ദൈർഘ്യ മോക്ക് ടെസ്റ്റ് 2", qs: 100, duration: 75 }],
]) {
  const p = path.join(OUT_DIR, htmlFile);
  if (!fs.existsSync(p)) {
    writeUtf8(path.join(OUT_DIR, jsonFile), JSON.stringify(Object.assign({}, meta, {
      secondsPerQuestion: 45, negativeMarking: 0.33, shuffleOptions: true,
      _note: "populate questions later", questions: [],
    }), null, 2) + "\n");
    log("          " + jsonFile + " (empty)");
    continue;
  }
  const src = readUtf8(p);
  const qs = extractQuestions(src, "sourceQuestions");
  const secs = Number((src.match(/SECONDS_PER_QUESTION\s*[:=]\s*(\d+)/) || [, "45"])[1]);
  const neg = Math.abs(Number((src.match(/NEGATIVE_MARKING\s*[:=]\s*(-?[\d.]+)/) || [, "0.33"])[1]));
  writeUtf8(path.join(OUT_DIR, jsonFile), JSON.stringify(Object.assign({}, meta, {
    secondsPerQuestion: secs, negativeMarking: neg, shuffleOptions: true, questions: qs,
  }), null, 2) + "\n");
  log("          " + jsonFile + " (" + qs.length + " questions)");
}

/* =================== STEP 5 : index.html =================== */
const INDEX = `<!DOCTYPE html>
<html lang="ml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock Tests – Kerala PSC</title>
<style>
  body{font-family:'Noto Sans Malayalam','Segoe UI',system-ui,sans-serif;
       background:#f4f6f9;margin:0;padding:24px;color:#1a1a2e}
  .wrap{max-width:900px;margin:0 auto}
  h1{color:#2c3e8f;margin-bottom:8px}
  .sub{color:#5b6b85;margin-bottom:24px;font-size:.92rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
        gap:14px}
  .card{background:#fff;border-radius:12px;padding:18px;
        box-shadow:0 2px 12px rgba(0,0,0,.08);text-decoration:none;
        color:inherit;border-top:4px solid #2c3e8f;
        transition:transform .15s;display:block}
  .card:hover{transform:translateY(-3px)}
  .card h3{margin:0 0 6px;font-size:1rem;color:#2c3e8f}
  .card .ml{font-size:.85rem;color:#5b6b85;margin-bottom:8px}
  .card .meta{font-size:.78rem;color:#8a8f9e;text-transform:uppercase;
              font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <h1>📝 Mock Tests</h1>
  <p class="sub">ഒരു പേപ്പർ തിരഞ്ഞെടുത്ത് പരീക്ഷ ആരംഭിക്കുക</p>
  <div class="grid" id="grid">Loading…</div>
</div>
<script src="../assets/js/syllabus.js"></script>
<script>
  (function(){
    const grid = document.getElementById('grid');
    const S = window.KPSC_SYLLABUS;
    const papers = (S && S.QUESTION_PAPERS) || [];
    if (!papers.length) {
      grid.innerHTML = '<p>No mock tests registered in syllabus.js.</p>';
      return;
    }
    grid.innerHTML = papers.map(p => {
      const base = p.html || 'mock-test.html';
      const url = base + '?paper=' + encodeURIComponent(p.data || p.file || '');
      return '<a class="card" href="' + url + '">' +
             '<h3>' + p.title + '</h3>' +
             '<div class="ml">' + (p.titleMl || '') + '</div>' +
             '<div class="meta">' + (p.qs || 0) + ' Q · ' +
             (p.duration || 0) + ' min</div>' +
             '</a>';
    }).join('');
  })();
</script>
</body>
</html>
`;
writeUtf8(path.join(ROOT, "question-papers", "index.html"), INDEX);
log("\nSTEP 5    created question-papers/index.html");
