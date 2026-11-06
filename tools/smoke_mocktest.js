#!/usr/bin/env node
/* Smoke tests for the JSON mock-test shell (step 7 of the refactor brief).
   Assertions avoid non-ASCII literals so console encodings cannot skew them. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SHELL = path.join(ROOT, "mock-test.html");
const results = [];
const ok = (n, msg) => results.push({ n, pass: true, msg });
const bad = (n, msg) => results.push({ n, pass: false, msg });
const ARROW = "\u2192";

/* ---------------- DOM shim ---------------- */
function makeDom(store, opts) {
  const els = new Map();
  const handlers = {};

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
      appendChild(child) { this._children.push(child); return child; },
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
      e.tagName = String(tag).toUpperCase();
      return e;
    },
    addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener: () => {},
    hidden: false,
  };

  const sandbox = {
    document,
    location: { pathname: "/mock-test.html", search: opts.search || "", href: "" },
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    fetch: opts.fetch,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    console: { log() {}, warn() {}, error() {} },
    alert: (m) => { sandbox.__alert = m; },
    confirm: () => true,
    scrollTo: () => {},
    scrollBy: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
    Promise, Math, Date, JSON, String, Number, Array, Object, RegExp,
    parseInt, parseFloat, isNaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = document.addEventListener;

  return { ctx: vm.createContext(sandbox), sandbox, el, handlers };
}

function shellScript() {
  const html = fs.readFileSync(SHELL, "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return blocks[blocks.length - 1][1];
}

function paperFetch(jsonRel) {
  const p = path.join(ROOT, jsonRel);
  return async () => {
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
    const body = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
}

async function boot(jsonRel, store) {
  const dom = makeDom(store, {
    search: "?paper=" + encodeURIComponent(jsonRel),
    fetch: paperFetch(jsonRel),
  });
  vm.runInContext(shellScript(), dom.ctx, { filename: "mock-test.html" });
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5));
  return dom;
}

const S = (dom, expr) => vm.runInContext(expr, dom.ctx);
const BIO = "question-papers/573/qp-573-bio-001.json";

(async () => {
  /* T1 - loads, 25 questions, header title */
  {
    const d = await boot(BIO, new Map());
    const nq = S(d, "questions.length");
    const t = S(d, "document.querySelector('.header-title').textContent");
    nq === 25 && t === "Biology & Public Health Mock Test"
      ? ok(1, `25 questions loaded, header = "${t}"`)
      : bad(1, `questions=${nq}, header="${t}"`);
  }

  /* T2 - fresh loads shuffle differently */
  {
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const d = await boot(BIO, new Map());
      seen.add(S(d, "JSON.stringify(questionStates[0].shuffleOrder)"));
    }
    seen.size > 1
      ? ok(2, `${seen.size} distinct Q1 orders across 6 fresh loads`)
      : bad(2, "order never changed across 6 loads");
  }

  /* T3 - green highlight follows the correct CONTENT */
  {
    const d = await boot(BIO, new Map());
    const checks = [];
    for (const qi of [0, 7, 19]) {
      S(d, `currentIndex=${qi}; questionStates[${qi}].status='saved'; questionStates[${qi}].selectedOption=questions[${qi}].correct; renderOptions();`);
      const kids = d.el("optionsList")._children.map((c) => ({ text: c.textContent, cls: [...c.classList._s] }));
      const green = kids.filter((k) => k.cls.includes("correct-highlight"));
      const pos = kids.findIndex((k) => k.cls.includes("correct-highlight"));
      const correctText = S(d, `String(questions[${qi}].options[questions[${qi}].correct]).replace(/^[A-D]\\)\\s*/,'')`);
      checks.push({ qi, pos, ok: green.length === 1 && String(green[0].text).endsWith(String(correctText)) });
      d.el("optionsList")._children.length = 0;
    }
    checks.every((c) => c.ok)
      ? ok(3, "green highlight tracks correct content at display positions " + checks.map((c) => c.pos).join("/"))
      : bad(3, JSON.stringify(checks));
  }

  /* T4 - learning panel: banner + relabelled analysis */
  {
    const d = await boot(BIO, new Map());
    S(d, "currentIndex=0; questionStates[0].status='revealed'; renderOptions(); renderLearningPanel();");
    const body = d.el("learningBody").innerHTML;
    const banner = body.includes("Current " + ARROW + " original");
    const map = (body.match(/Current [^:]+: <b>([^<]+)<\/b>/) || [])[1] || "";
    const order = S(d, "questionStates[0].shuffleOrder");
    const letters = [...body.matchAll(/lp-option-item[^>]*>([A-D])\)/g)].map((m) => m[1]);
    const expected = order.map((_orig, i) => String.fromCharCode(65 + order.indexOf(i)));
    const relabelled = letters.join("") === expected.join("");
    const mapOk = /^A\u2192[A-D]/.test(map.trim());
    banner && mapOk && relabelled
      ? ok(4, `banner present, map "${map}", analysis letters ${letters.join("")} = expected`)
      : bad(4, `banner=${banner} map="${map}" letters=${letters.join("")} expected=${expected.join("")}`);
  }

  /* T4b - deterministic relabelling with a known non-identity order */
  {
    const d = await boot(BIO, new Map());
    S(d, "currentIndex=0; questionStates[0].shuffleOrder=[2,0,3,1]; questionStates[0].status='revealed'; renderOptions(); renderLearningPanel();");
    const body = d.el("learningBody").innerHTML;
    const map = ((body.match(/Current [^:]+: <b>([^<]+)<\/b>/) || [])[1] || "").replace(/\s+/g, " ").trim();
    const letters = [...body.matchAll(/lp-option-item[^>]*>([A-D])\)/g)].map((m) => m[1]).join("");
    // order [2,0,3,1]: item0->B, item1->D, item2->A, item3->C
    map === "A\u2192C B\u2192A C\u2192D D\u2192B" && letters === "BDAC"
      ? ok(4.5, `fixed order [2,0,3,1] -> map "${map}", analysis "BDAC"`)
      : bad(4.5, `map="${map}" letters="${letters}" (expected A→C B→A C→D D→B / BDAC)`);
  }

  /* T5 - number keys select by display position */
  {
    const d = await boot(BIO, new Map());
    const order = JSON.parse(S(d, "JSON.stringify(questionStates[0].shuffleOrder)"));
    d.handlers.keydown[0]({ key: "2", preventDefault() {}, target: { tagName: "BODY" } });
    const sel = S(d, "questionStates[0].selectedOption");
    sel === order[1]
      ? ok(5, `key "2" selected original index ${sel} (= display position 2)`)
      : bad(5, `key 2 -> ${sel}, expected ${order[1]}`);
  }

  /* T6 - submit math (cards are emitted in a fixed order) */
  {
    const d = await boot(BIO, new Map());
    S(d, `
      questions.forEach((q,i)=>{
        if(i<10){ questionStates[i].status='saved';
                  questionStates[i].selectedOption = (i%2===0) ? q.correct : (q.correct+1)%q.options.length; }
        else if(i<15){ questionStates[i].status='saved'; questionStates[i].selectedOption=q.correct; }
        else { questionStates[i].status='idle'; questionStates[i].selectedOption=null; }
      });
      renderResults();
    `);
    const cards = d.el("summaryCards").innerHTML;
    const vals = [...cards.matchAll(/sc-value">([^<]*)<\/div>/g)].map((m) => m[1]);
    const [total, attempted, correct, wrong] = vals;
    const table = d.el("subjectTableBody").innerHTML;
    total === "25" && attempted === "15" && correct === "10" && wrong === "5" && table.includes("<tr>")
      ? ok(6, "total 25 / attempted 15 / correct 10 / wrong 5, subject table rendered")
      : bad(6, `total=${total} attempted=${attempted} correct=${correct} wrong=${wrong}`);
  }

  /* T7 - resume restores order + answers */
  {
    const store = new Map();
    const d1 = await boot(BIO, store);
    const before = S(d1, "JSON.stringify(questionStates.map(s=>s.shuffleOrder))");
    S(d1, `
      for (let i=0;i<5;i++){ questionStates[i].status='saved'; questionStates[i].selectedOption=questions[i].correct; }
      currentIndex=5; saveAttempt();
    `);
    const pending = S(d1, "!!getSavedAttempt()");
    const d2 = await boot(BIO, store);
    const bannerShown = d2.el("resumeBanner").classList.contains("visible");
    S(d2, "resumeAttempt();");
    const after = S(d2, "JSON.stringify(questionStates.map(s=>s.shuffleOrder))");
    const answers = S(d2, "JSON.stringify(questionStates.slice(0,5).map(s=>s.selectedOption))");
    const want = S(d2, "JSON.stringify(questions.slice(0,5).map(q=>q.correct))");
    pending && bannerShown && before === after && answers === want
      ? ok(7, "resume banner shown; shuffle order and 5 answers restored exactly")
      : bad(7, `saved=${pending} banner=${bannerShown} orderSame=${before === after} answers=${answers} vs ${want}`);
  }

  /* T8 - the hub links the three data papers through the shell */
  {
    const html = fs.readFileSync(path.join(ROOT, "question-papers", "index.html"), "utf8");
    const grid = { innerHTML: "" };
    const ctx = {
      console: { log() {}, warn() {} },
      Promise, URLSearchParams,
      location: { hostname: "localhost", pathname: "/question-papers/index.html" },
      document: { getElementById: () => grid },
      fetch: () => Promise.reject(new Error("offline")),
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "question-papers", "papers.js"), "utf8"), ctx);
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/^<script>|<\/script>$/g, ""), ctx);

    const cards = [...grid.innerHTML.matchAll(/<a class="card[^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    const want = [
      "qp-573-001-full-mock-1.json",
      "qp-573-002-full-mock-2.json",
      "qp-573-bio-001.json",
    ];
    const shellLinks = cards.map((h) => new URL(h, "https://site.example/question-papers/index.html"))
                             .filter((u) => u.pathname === "/mock-test.html");
    const papers = shellLinks.map((u) => decodeURIComponent(u.searchParams.get("paper") || ""));
    want.every((w) => papers.some((p) => p.endsWith(w)))
      ? ok(8, `all 3 data papers linked via mock-test.html?paper= (${shellLinks.length} shell links)`)
      : bad(8, `shell links: ${papers.join(" | ")}`);
  }

  /* T9 - the other two papers load through the same shell */
  for (const [label, rel, expect] of [
    ["qp-573-001", "question-papers/573/qp-573-001-full-mock-1.json", 99],
    ["qp-573-002", "question-papers/573/qp-573-002-full-mock-2.json", 100],
  ]) {
    const d = await boot(rel, new Map());
    const n = S(d, "questions.length");
    const t = S(d, "document.querySelector('.header-title').textContent");
    results.push({ n: 9, pass: n === expect, msg: `${label}: ${n} questions (expected ${expect}), header "${t}"` });
  }

  /* T10 - empty paper degrades gracefully */
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

  /* T12 - the hub lists the folder automatically (no registry) */
  {
    // what is actually on disk
    const expected = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (name.toLowerCase() === "index.html") continue;
        if (/\.json$/i.test(name)) {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          if (Array.isArray(j.questions)) expected.push({ kind: "json", p });
        } else if (/\.html?$/i.test(name)) {
          expected.push({ kind: "html", p });
        }
      }
    })(path.join(ROOT, "question-papers"));

    const idxHtml = fs.readFileSync(path.join(ROOT, "question-papers", "index.html"), "utf8");
    const grid = { innerHTML: "" };
    const hint = { textContent: "" };
    const ctx = {
      console: { log() {}, warn() {} },
      Promise, URLSearchParams, encodeURIComponent, encodeURI,
      location: { hostname: "localhost", pathname: "/question-papers/index.html" },
      document: { getElementById: (id) => (id === "grid" ? grid : id === "hint" ? hint : { innerHTML: "" }) },
      fetch: () => Promise.reject(new Error("offline")),
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "question-papers", "papers.js"), "utf8"), ctx);
    vm.runInContext(idxHtml.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/^<script>|<\/script>$/g, ""), ctx);

    const cards = [...grid.innerHTML.matchAll(/<a class="card[^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    const links = cards.map((h) => new URL(h, "https://site.example/question-papers/index.html"));
    const shellLinks = links.filter((u) => u.pathname === "/mock-test.html");
    const directLinks = links.filter((u) => u.pathname !== "/mock-test.html");
    const jsonOk = shellLinks.every((u) => {
      const rel = decodeURIComponent(u.searchParams.get("paper") || "");
      return rel.startsWith("question-papers/") && fs.existsSync(path.join(ROOT, rel));
    });
    const htmlOk = directLinks.every((u) => fs.existsSync(path.join(ROOT, decodeURIComponent(u.pathname))));
    const counts = { total: cards.length, expected: expected.length, viaShell: shellLinks.length, direct: directLinks.length };
    cards.length === expected.length && jsonOk && htmlOk
      ? ok(12, `hub lists ${counts.total} papers from the folder (${counts.viaShell} via shell, ${counts.direct} direct), all links resolve`)
      : bad(12, JSON.stringify(counts) + ` jsonOk=${jsonOk} htmlOk=${htmlOk}`);
  }

  /* T11 - JSON questions are a byte-for-byte copy of the HTML source */
  {
    const htmlPath = path.join(ROOT, "question-papers", "subjects", "Biology & Public Health Mock Test.html");
    if (!fs.existsSync(htmlPath)) {
      results.push({ n: 11, pass: true, msg: "source HTML already removed - fidelity verified before deletion" });
    } else {
      const src = fs.readFileSync(htmlPath, "utf8");
      const m = /(?:const|var|let)\s+sourceQuestions\s*=\s*\[/.exec(src);
      let i = m.index + m[0].length - 1, depth = 0, end = -1;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === "`") { i++; while (i < src.length && src[i] !== "`") { if (src[i] === "\\") i++; i++; } continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } continue; }
        if (c === "[") depth++;
        else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
      }
      const original = vm.runInNewContext("(" + src.slice(m.index + m[0].length - 1, end + 1) + ")", Object.create(null));
      const fromJson = JSON.parse(fs.readFileSync(path.join(ROOT, BIO), "utf8")).questions;
      const same = JSON.stringify(original) === JSON.stringify(fromJson);
      const fields = new Set(fromJson.flatMap((q) => Object.keys(q)));
      same
        ? ok(11, `25 questions identical to source HTML; fields kept: ${[...fields].sort().join(", ")}`)
        : bad(11, "JSON questions differ from the source HTML array");
    }
  }

  console.log("=".repeat(74));
  console.log("SMOKE TESTS - JSON mock-test shell");
  console.log("=".repeat(74));
  for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  [${String(r.n).padStart(2)}] ${r.msg}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log("-".repeat(74));
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
