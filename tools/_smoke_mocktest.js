#!/usr/bin/env node
/* Smoke tests for the JSON mock-test shell (step 7 of the refactor brief). */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SHELL = path.join(ROOT, "mock-test.html");
const results = [];
const ok = (n, msg) => results.push({ n, pass: true, msg });
const bad = (n, msg) => results.push({ n, pass: false, msg });

/* ---------------- DOM shim ---------------- */
function makeDom(store, opts = {}) {
  const els = new Map();
  const handlers = {};
  global.__handlers = handlers;

  function el(id) {
    if (els.has(id)) return els.get(id);
    const e = {
      id,
      _children: [],
      innerHTML: "",
      textContent: "",
      value: "",
      style: {},
      dataset: {},
      classList: {
        _s: new Set(),
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      appendChild(child) { this._children.push(child); if (this._onAppend) this._onAppend(child); return child; },
      addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() {},
      scrollIntoView() {},
      setAttribute() {},
      getAttribute() { return null; },
      remove() {},
      closest() { return null; },
      cloneNode() { return el(id + "-clone"); },
    };
    els.set(id, e);
    return e;
  }

  const document = {
    title: "",
    body: el("body"),
    documentElement: el("html"),
    getElementById: (id) => el(id),
    querySelector: (sel) => (sel === ".header-title" ? el("header-title") : null),
    querySelectorAll: () => [],
    createElement: (tag) => {
      const e = el("el-" + Math.random().toString(36).slice(2));
      e.tagName = tag.toUpperCase();
      return e;
    },
    addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener: () => {},
    hidden: false,
  };

  const sandbox = {
    document,
    location: { pathname: opts.pathname || "/mock-test.html", search: opts.search || "", href: "" },
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    fetch: opts.fetch,
    URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    console: { log() {}, warn() {}, error() {} },
    alert: (m) => { sandbox.__alert = m; },
    confirm: () => true,
    Promise, Math, Date, JSON, String, Number, Array, Object, RegExp, parseInt, parseFloat,
    __errors: [],
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = document.addEventListener;

  const ctx = vm.createContext(sandbox);
  return { ctx, sandbox, el, handlers };
}

function shellScript() {
  const html = fs.readFileSync(SHELL, "utf8");
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  // the last inline <script> is the test controller
  return m[m.length - 1][1];
}

function paperFetch(jsonRel) {
  const p = path.join(ROOT, jsonRel);
  return async (url) => {
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
    const body = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
}

async function boot(jsonRel, store, extraQ) {
  const opts = Object.assign({
    pathname: "/mock-test.html",
    search: "?paper=" + encodeURIComponent(jsonRel),
    fetch: paperFetch(jsonRel),
  }, extraQ || {});
  const dom = makeDom(store, opts);
  vm.runInContext(shellScript(), dom.ctx, { filename: "mock-test.html" });
  // let the async loader finish
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5));
  return dom;
}

const S = (dom, expr) => vm.runInContext(expr, dom.ctx);

/* ---------------- tests ---------------- */
(async () => {
  const store = new Map();
  const BIO = "question-papers/573/qp-573-bio-001.json";

  /* T1 — loads, 25 questions, header title */
  let dom = await boot(BIO, store);
  const nq = S(dom, "questions.length");
  const title = S(dom, "document.querySelector('.header-title').textContent");
  const head = title === "Biology & Public Health Mock Test";
  nq === 25 && head
    ? ok(1, `25 questions loaded, header = "${title}"`)
    : bad(1, `questions=${nq}, header="${title}"`);

  /* T2 — fresh loads produce different option orders */
  const orders = new Set();
  for (let i = 0; i < 6; i++) {
    const d = await boot(BIO, new Map());
    orders.add(JSON.stringify(S(d, "questionStates[0].shuffleOrder")));
  }
  orders.size > 1
    ? ok(2, `${orders.size} distinct orders for Q1 across 6 fresh loads`)
    : bad(2, "option order never changed across 6 loads");

  /* T3 — the green highlight lands on the correct CONTENT, not on position A */
  {
    const d = await boot(BIO, new Map());
    const checks = [];
    for (const qi of [0, 7, 19]) {
      S(d, `currentIndex=${qi}; questionStates[${qi}].status='saved'; questionStates[${qi}].selectedOption=questions[${qi}].correct; renderOptions();`);
      const kids = d.el("optionsList")._children.map((c) => ({
        text: c.textContent,
        cls: [...c.classList._s],
      }));
      const correctText = S(d, `String(questions[${qi}].options[questions[${qi}].correct]).replace(/^[A-D]\\)\\s*/,'')`);
      const green = kids.filter((k) => k.cls.includes("correct-highlight"));
      const pos = kids.findIndex((k) => k.cls.includes("correct-highlight"));
      checks.push({
        qi, greenCount: green.length, pos,
        contentOk: green.length === 1 && green[0].text.endsWith(correctText),
      });
      d.el("optionsList")._children.length = 0;
    }
    const allOk = checks.every((c) => c.contentOk);
    allOk
      ? ok(3, "green highlight tracks correct content at positions " + checks.map((c) => c.pos).join("/") + " (not forced to A)")
      : bad(3, JSON.stringify(checks));
  }

  /* T4 — learning panel: relabelled analysis + shuffled banner */
  {
    const d = await boot(BIO, new Map());
    S(d, "currentIndex=0; questionStates[0].status='revealed'; renderOptions(); renderLearningPanel();");
    const body = d.el("learningBody").innerHTML;
    const banner = body.includes("Options are shuffled");
    const map = (body.match(/Current → original: <b>([^<]+)<\/b>/) || [])[1] || "";
    const order = S(d, "questionStates[0].shuffleOrder");
    // analysis items must start with the display letters
    const letters = [...body.matchAll(/lp-option-item[^>]*>([A-D])\)/g)].map((m) => m[1]);
    const expected = order.map((_, disp) => String.fromCharCode(65 + disp));
    const relabelled = letters.join("") === expected.join("");
    banner && /^A→[A-D]/.test(map) && relabelled
      ? ok(4, `banner present, map "${map}", analysis letters ${letters.join("")} match display`)
      : bad(4, `banner=${banner} map="${map}" letters=${letters.join("")} expected=${expected.join("")}`);
  }

  /* T5 — number keys select the CONTENT at that display position */
  {
    const d = await boot(BIO, new Map());
    const order = S(d, "JSON.stringify(questionStates[0].shuffleOrder)");
    const handler = d.handlers.keydown[0];
    handler({ key: "2", preventDefault() {}, target: { tagName: "BODY" } });
    const sel = S(d, "questionStates[0].selectedOption");
    const want = JSON.parse(order)[1];
    sel === want
      ? ok(5, `key "2" selected original option index ${sel} (display position 2)`)
      : bad(5, `key 2 -> ${sel}, expected ${want}`);
  }

  /* T6 — submit produces correct totals */
  {
    const d = await boot(BIO, new Map());
    S(d, `
      questions.forEach((q,i)=>{
        const st=questionStates[i];
        if(i<10){ st.status='saved'; st.selectedOption = (i%2===0) ? q.correct : (q.correct+1)%q.options.length; }
        else if(i<15){ st.status='saved'; st.selectedOption=q.correct; }
        else { st.status='idle'; st.selectedOption=null; }
      });
      renderResults();
    `);
    const cards = d.el("summaryCards").innerHTML;
    const attempts = (cards.match(/sc-value">(\d+)<\/div><div class="sc-label">ശ്രമിച്ചവ/) || [])[1];
    const corrects = (cards.match(/sc-value">(\d+)<\/div><div class="sc-label">ശരിയായവ/) || [])[1];
    const wrongs = (cards.match(/sc-value">(\d+)<\/div><div class="sc-label">തെറ്റായവ/) || [])[1];
    // i<10: 5 correct (even), 5 wrong; 10..14: 5 correct => attempted 15, correct 10, wrong 5
    const pass = attempts === "15" && corrects === "10" && wrongs === "5";
    const table = d.el("subjectTableBody").innerHTML;
    pass && table.includes("<tr>")
      ? ok(6, "attempted 15 / correct 10 / wrong 5, subject table rendered")
      : bad(6, `attempted=${attempts} correct=${corrects} wrong=${wrongs}`);
  }

  /* T7 — resume restores the same shuffled order and answers */
  {
    const st2 = new Map();
    const d1 = await boot(BIO, st2);
    const before = S(d1, "JSON.stringify(questionStates.map(s=>s.shuffleOrder))");
    S(d1, `
      for (let i=0;i<5;i++){ questionStates[i].status='saved'; questionStates[i].selectedOption=questions[i].correct; }
      currentIndex=5; saveAttempt();
    `);
    const bannerShown = S(d1, "!!getSavedAttempt()");
    const d2 = await boot(BIO, st2);
    const sawBanner = d2.el("resumeBanner").classList.contains("visible");
    S(d2, "resumeAttempt();");
    const after = S(d2, "JSON.stringify(questionStates.map(s=>s.shuffleOrder))");
    const answers = S(d2, "JSON.stringify(questionStates.slice(0,5).map(s=>s.selectedOption))");
    const expectAnswers = S(d2, "JSON.stringify(questions.slice(0,5).map(q=>q.correct))");
    const pass = bannerShown && sawBanner && before === after && answers === expectAnswers;
    pass
      ? ok(7, "resume banner shown; shuffle order and 5 answers restored exactly")
      : bad(7, `saved=${bannerShown} banner=${sawBanner} orderSame=${before === after} answers=${answers} vs ${expectAnswers}`);
  }

  /* T8 — index page lists all three papers with the right links */
  {
    const html = fs.readFileSync(path.join(ROOT, "question-papers", "index.html"), "utf8");
    const ctx = { window: {}, document: null, console: { log() {} } };
    ctx.window = ctx;
    const grid = { innerHTML: "" };
    ctx.document = { getElementById: () => grid };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "assets/js/syllabus.js"), "utf8"), ctx);
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
    const cards = [...grid.innerHTML.matchAll(/<a class="card" href="([^"]+)">/g)].map((m) => m[1]);
    const want = [
      "mock-test.html?paper=question-papers%2F573%2Fqp-573-001-full-mock-1.json",
      "mock-test.html?paper=question-papers%2F573%2Fqp-573-002-full-mock-2.json",
      "mock-test.html?paper=question-papers%2F573%2Fqp-573-bio-001.json",
    ];
    const pass = cards.length === 3 && want.every((w) => cards.includes(w));
    pass ? ok(8, "3 cards, each linking mock-test.html?paper=…") : bad(8, cards.join(" | "));
  }

  /* T9 — other two papers load through the same shell */
  for (const [label, rel, expect] of [
    ["qp-573-001", "question-papers/573/qp-573-001-full-mock-1.json", 99],
    ["qp-573-002", "question-papers/573/qp-573-002-full-mock-2.json", 100],
  ]) {
    const d = await boot(rel, new Map());
    const n = S(d, "questions.length");
    const t = S(d, "document.querySelector('.header-title').textContent");
    n === expect
      ? results.push({ n: 10, pass: true, msg: `${label}: ${n} questions, header "${t}"` })
      : results.push({ n: 10, pass: false, msg: `${label}: got ${n}, expected ${expect}` });
  }

  /* T10 — empty paper shows the friendly message, does not crash */
  {
    const tmp = path.join(ROOT, "question-papers", "573", "__empty-test.json");
    fs.writeFileSync(tmp, JSON.stringify({ id: "x", title: "Empty", questions: [] }), "utf8");
    try {
      const d = await boot("question-papers/573/__empty-test.json", new Map());
      const body = d.el("body").innerHTML || "";
      body.includes("No questions yet")
        ? ok(10, "empty JSON shows the friendly 'No questions yet' page")
        : bad(10, "empty JSON did not show the friendly message");
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  /* report */
  console.log("=".repeat(74));
  console.log("SMOKE TESTS — JSON mock-test shell");
  console.log("=".repeat(74));
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  [${String(r.n).padStart(2)}] ${r.msg}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log("-".repeat(74));
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
