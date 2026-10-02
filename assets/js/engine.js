/* =====================================================================
   Kerala PSC Study Suite — Mock Test Engine + back button
   Paths: assets/js/engine.js
   Expects (set before loading this file):
     window.PART_KEY    e.g. 'geography-2.3.4-climate'
     window.PART_TITLE  e.g. '2.3.4 കേരളം — കാലാവസ്ഥ'
     window.QUESTIONS   array of question objects
   ===================================================================== */
(function () {
  "use strict";

  var DEFAULT_NEGATIVE_MARK = 0.33;
  var SUMMARY_KEY = "kpsc_summaries_v1";

  var PART_KEY   = window.PART_KEY   || "default";
  var PART_TITLE = window.PART_TITLE || "Mock Test";
  var questions  = window.QUESTIONS  || [];

  var STORAGE_KEY = "kpsc_mock_" + PART_KEY;
  var LETTERS = ["A", "B", "C", "D"];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  var BY_ID = {};
  questions.forEach(function (q) { BY_ID[q.id] = q; });
  var Q_ORDER = shuffle(questions.map(function (q) { return q.id; }));
  var OPT_ORDER = {};
  questions.forEach(function (q) {
    OPT_ORDER[q.id] = shuffle(q.options.map(function (_, i) { return i; }));
  });

  var state = {
    answers:   {},
    bookmarks: {},
    settings:  { negative: DEFAULT_NEGATIVE_MARK, category: "ALL", topic: "ALL", difficulty: "ALL" },
    activeSet: "all"
  };

  var pool = [];
  var cur  = 0;

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && typeof s === "object") {
        state.answers   = s.answers   || {};
        state.bookmarks = s.bookmarks || {};
        Object.assign(state.settings, s.settings || {});
      }
    } catch (e) { console.warn("engine.js: load failed", e); }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        answers: state.answers, bookmarks: state.bookmarks, settings: state.settings
      }));
      var summaries = JSON.parse(localStorage.getItem(SUMMARY_KEY) || "{}");
      var s = computeStats(questions);
      summaries[PART_KEY] = {
        total: s.total, attempted: s.attempted, correct: s.correct, wrong: s.wrong,
        net: Number(s.net.toFixed(2))
      };
      localStorage.setItem(SUMMARY_KEY, JSON.stringify(summaries));
    } catch (e) { console.warn("engine.js: save failed", e); }
  }

  function computeStats(list) {
    var attempted = 0, correct = 0, wrong = 0;
    list.forEach(function (q) {
      var a = state.answers[q.id];
      if (a) { attempted++; if (a.ok) correct++; else wrong++; }
    });
    var total = list.length;
    var remaining = total - attempted;
    var negativeMarks = wrong * Number(state.settings.negative || 0);
    var net = correct - negativeMarks;
    var accuracy = attempted ? (correct / attempted) * 100 : 0;
    return { total: total, attempted: attempted, correct: correct, wrong: wrong,
             remaining: remaining, negativeMarks: negativeMarks, net: net, accuracy: accuracy };
  }

  function currentPool() {
    var list = Q_ORDER.map(function (id) { return BY_ID[id]; });
    var s = state.settings;
    if (s.category   !== "ALL") list = list.filter(function (q) { return q.category   === s.category; });
    if (s.topic      !== "ALL") list = list.filter(function (q) { return q.topic      === s.topic; });
    if (s.difficulty !== "ALL") list = list.filter(function (q) { return q.difficulty === s.difficulty; });
    if (state.activeSet === "wrong")      list = list.filter(function (q) { return  state.answers[q.id] && !state.answers[q.id].ok; });
    if (state.activeSet === "unanswered") list = list.filter(function (q) { return !state.answers[q.id]; });
    if (state.activeSet === "bookmarked") list = list.filter(function (q) { return  state.bookmarks[q.id]; });
    if (state.activeSet === "difficult")  list = list.filter(function (q) { return q.difficulty === "Hard" || q.difficulty === "Very Hard"; });
    return list;
  }

  function refreshPool(keepId) {
    var prevId = keepId || (pool[cur] ? pool[cur].id : null);
    pool = currentPool();
    if (!pool.length) { cur = 0; }
    else {
      var idx = -1;
      for (var i = 0; i < pool.length; i++) if (pool[i].id === prevId) { idx = i; break; }
      cur = idx >= 0 ? idx : 0;
    }
    renderAll();
  }

  function diffClass(d) {
    return { "Easy": "easy", "Medium": "medium", "Hard": "hard", "Very Hard": "veryhard" }[d] || "medium";
  }
  function diffIcon(d) {
    return { "Easy": "🟢", "Medium": "🟡", "Hard": "🟠", "Very Hard": "🔴" }[d] || "🟡";
  }
  function tagClass(cat) {
    if (cat === "573") return "c573";
    if (cat === "883") return "c883";
    return "both";
  }

  function renderQuestion() {
    var host = $("#qcard");
    if (!host) return;
    if (!pool.length) {
      host.innerHTML = '<div class="empty">No questions match the current filter.</div>';
      return;
    }
    var q = pool[cur];
    var ans = state.answers[q.id];
    var order = OPT_ORDER[q.id];

    var optsHtml = "";
    order.forEach(function (origIdx, pos) {
      var cls = "option";
      var verdict = "";
      if (ans) {
        if (origIdx === q.answer) { cls += " correct"; verdict = '<span class="vtag ok">✓ Correct</span>'; }
        if (origIdx === ans.sel && !ans.ok) { cls += " wrong"; verdict = '<span class="vtag bad">✗ Wrong</span>'; }
      }
      optsHtml += '<button class="' + cls + '" data-orig="' + origIdx + '"' + (ans ? " disabled" : "") + '>' +
                  '<span class="optkey">' + LETTERS[pos] + '</span>' +
                  '<span class="opttext">' + esc(q.options[origIdx]) + '</span>' + verdict + '</button>';
    });

    var feedback = "";
    if (ans) {
      var notesHtml = order.map(function (origIdx, pos) {
        return '<li><b>' + LETTERS[pos] + ". " + esc(q.options[origIdx]) + "</b> — " +
               esc(q.optionNotes ? q.optionNotes[origIdx] : "") + "</li>";
      }).join("");
      var remaining = pool.filter(function (x) { return !state.answers[x.id]; }).length;
      var nextLabel = remaining > 0 ? "NEXT QUESTION →" : "FINISH TEST";
      feedback =
        '<div class="feedback ' + (ans.ok ? "ok" : "bad") + '">' +
          '<div class="fbhead">' + (ans.ok ? "✅ Correct Answer" : "❌ Wrong Answer") + "</div>" +
          (ans.ok ? "" : '<div class="fbcorrect">Correct Answer: <b>' + esc(q.options[q.answer]) + "</b></div>") +
          '<div class="fbexp"><b>Explanation:</b> ' + esc(q.explanation) + "</div>" +
          '<ul class="optnotes">' + notesHtml + "</ul>" +
          '<div class="fbtools">' +
            '<button class="btn ghost" data-action="retry">🔄 Try Again</button>' +
            '<button class="btn primary" data-action="next">' + nextLabel + "</button>" +
          "</div>" +
        "</div>";
    }

    host.innerHTML =
      '<div class="qmeta">' +
        '<span class="pill">Q' + (cur + 1) + " / " + pool.length + "</span>" +
        '<span class="pill">' + esc(q.topic) + "</span>" +
        '<span class="tag ' + tagClass(q.category) + '">' + q.category + "</span>" +
        '<span class="diff ' + diffClass(q.difficulty) + '">' + diffIcon(q.difficulty) + " " + q.difficulty + "</span>" +
        '<button class="bookmark ' + (state.bookmarks[q.id] ? "on" : "") + '" data-action="bookmark">' +
          (state.bookmarks[q.id] ? "⭐ Bookmarked" : "☆ Bookmark") + "</button>" +
      "</div>" +
      '<div class="qtext">' + esc(q.question) + "</div>" +
      '<div class="options">' + optsHtml + "</div>" +
      feedback;
  }

  function renderNav() {
    var grid = $("#navgrid");
    if (!grid) return;
    if (!pool.length) { grid.innerHTML = ""; return; }
    grid.innerHTML = pool.map(function (q, i) {
      var a = state.answers[q.id];
      var cls = a ? (a.ok ? "ok" : "bad") : "";
      var mark = a ? (a.ok ? "✓" : "✗") : "—";
      return '<button class="navbtn ' + cls + (i === cur ? " active" : "") + '" data-i="' + i + '">' +
             (i + 1) + '<span class="nm">' + mark + "</span></button>";
    }).join("");
  }

  function updateScore() {
    var s = computeStats(pool);
    var el = function (id) { return document.getElementById(id); };
    if (el("sbScore")) el("sbScore").textContent = s.net.toFixed(2) + " / " + s.total;
    if (el("sbAtt"))   el("sbAtt").textContent   = s.attempted;
    if (el("sbCor"))   el("sbCor").textContent   = s.correct;
    if (el("sbWr"))    el("sbWr").textContent    = s.wrong;
    if (el("sbRem"))   el("sbRem").textContent   = s.remaining;
    if (el("sbAcc"))   el("sbAcc").textContent   = s.accuracy.toFixed(1) + "%";
    if (el("progressbar")) el("progressbar").style.width = (s.total ? (s.attempted / s.total) * 100 : 0) + "%";
  }

  function renderSetInfo() {
    var names = { all:"All Questions", wrong:"Wrong Questions", unanswered:"Unanswered Questions",
                  bookmarked:"Bookmarked Questions", difficult:"Difficult Questions" };
    var el = $("#setInfo");
    if (!el) return;
    var s = computeStats(pool);
    el.innerHTML = "<b>Current set:</b> " + names[state.activeSet] +
                   " &nbsp;•&nbsp; " + s.total + " question(s)" +
                   " &nbsp;•&nbsp; Negative: " + Number(state.settings.negative).toFixed(2);
  }

  function renderAll() {
    renderQuestion();
    renderNav();
    updateScore();
    renderSetInfo();
  }

  function selectOption(qid, origIdx) {
    if (state.answers[qid]) return;
    var q = BY_ID[qid];
    var ok = (origIdx === q.answer);
    state.answers[qid] = { sel: origIdx, ok: ok };
    saveState();
    renderAll();
  }

  function toggleBookmark(qid) {
    if (state.bookmarks[qid]) delete state.bookmarks[qid];
    else state.bookmarks[qid] = true;
    saveState();
    renderAll();
  }

  function goNext() {
    if (!pool.length) return;
    for (var i = cur + 1; i < pool.length; i++) {
      if (!state.answers[pool[i].id]) { cur = i; renderAll(); scrollToCard(); return; }
    }
    for (var j = 0; j < cur; j++) {
      if (!state.answers[pool[j].id]) { cur = j; renderAll(); scrollToCard(); return; }
    }
    finishTest();
  }

  function scrollToCard() {
    var el = $("#qcard");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function finishTest() { showView("result"); }

  function showView(name) {
    $$(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    $$("#tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === name); });
    if (name === "result")    renderResult();
    if (name === "bookmarks") renderBookmarks();
    if (name === "revision")  renderRevision();
    if (name === "test")      renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderResult() {
    var host = $("#resultHost");
    if (!host) return;
    var s = computeStats(pool);
    if (!s.total) {
      host.innerHTML = '<div class="viewhead"><h2>📊 RESULT</h2><p class="hint">No questions in the current set.</p></div>';
      return;
    }
    var correctPct = (s.correct / s.total) * 100;
    var wrongPct   = (s.wrong / s.total) * 100;
    var unansPct   = (s.remaining / s.total) * 100;
    var reviewHtml = pool.map(function (q, i) {
      var a = state.answers[q.id];
      var status = !a ? "none" : (a.ok ? "ok" : "bad");
      var statusText = !a ? "⚪ Unanswered" : (a.ok ? "✅ Correct" : "❌ Wrong");
      var yourAns = a ? q.options[a.sel] : "—";
      return '<div class="revcard ' + status + '">' +
        '<div class="rq">Q' + (i + 1) + ". " + esc(q.question) + "</div>" +
        '<div class="line"><b>Your answer:</b> ' + esc(yourAns) + "</div>" +
        '<div class="line"><b>Correct answer:</b> ' + esc(q.options[q.answer]) + "</div>" +
        '<div class="line"><b>Explanation:</b> ' + esc(q.explanation) + "</div>" +
        '<div class="line status ' + status + '">Status: ' + statusText + "</div>" +
      "</div>";
    }).join("");

    host.innerHTML =
      '<div class="resultcard"><h2>TEST RESULT</h2>' +
        '<div class="statgrid">' +
          '<div class="stat"><span class="k">Total Questions</span><span class="v">' + s.total + "</span></div>" +
          '<div class="stat"><span class="k">Attempted</span><span class="v">' + s.attempted + "</span></div>" +
          '<div class="stat"><span class="k">Correct</span><span class="v">' + s.correct + "</span></div>" +
          '<div class="stat"><span class="k">Wrong</span><span class="v">' + s.wrong + "</span></div>" +
          '<div class="stat"><span class="k">Unanswered</span><span class="v">' + s.remaining + "</span></div>" +
          '<div class="stat"><span class="k">Positive Marks</span><span class="v">' + s.correct + "</span></div>" +
          '<div class="stat"><span class="k">Negative Marks</span><span class="v">−' + s.negativeMarks.toFixed(2) + "</span></div>" +
          '<div class="stat"><span class="k">Accuracy</span><span class="v">' + s.accuracy.toFixed(2) + "%</span></div>" +
        "</div>" +
        '<div class="final">Final Score: <b>' + s.net.toFixed(2) + " / " + s.total + "</b></div>" +
        '<div class="perf"><h4>Performance</h4>' +
          perfRow("Correct", correctPct, "#177a3d") +
          perfRow("Wrong", wrongPct, "#c5221f") +
          perfRow("Unanswered", unansPct, "#8a94a6") +
        "</div>" +
      "</div>" +
      "<h3>Review Answers</h3>" +
      '<div class="reviewlist">' + reviewHtml + "</div>";
  }

  function perfRow(label, pct, color) {
    return '<div class="perfrow"><span class="lbl">' + label + "</span>" +
           '<span class="bar"><i style="width:' + pct.toFixed(2) + "%;background:" + color + '"></i></span>' +
           '<span class="pct">' + pct.toFixed(1) + "%</span></div>";
  }

  function renderBookmarks() {
    var host = $("#bookmarkList");
    if (!host) return;
    var ids = Object.keys(state.bookmarks).filter(function (id) { return state.bookmarks[id]; });
    if (!ids.length) {
      host.innerHTML = '<p class="empty">No bookmarked questions yet.</p>';
      return;
    }
    host.innerHTML = ids.map(function (id) {
      var q = BY_ID[id];
      if (!q) return "";
      return '<div class="bmcard">' +
        '<div class="bmq">' + esc(q.question) + "</div>" +
        '<div class="bmmeta">' +
          '<span class="pill">' + esc(q.topic) + "</span>" +
          '<span class="tag ' + tagClass(q.category) + '">' + q.category + "</span>" +
        "</div>" +
        '<div class="bmans">Answer: ' + esc(q.options[q.answer]) + "</div>" +
        '<div class="bmtools">' +
          '<button class="btn ghost" data-open="' + id + '">Open in Test</button>' +
          '<button class="btn ghost" data-remove="' + id + '">Remove ⭐</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function renderRevision() {
    var grid = $("#setgrid");
    if (!grid) return;
    var wrong      = questions.filter(function (q) { return  state.answers[q.id] && !state.answers[q.id].ok; }).length;
    var unanswered = questions.filter(function (q) { return !state.answers[q.id]; }).length;
    var bookmarked = Object.keys(state.bookmarks).filter(function (id) { return state.bookmarks[id]; }).length;
    var difficult  = questions.filter(function (q) { return q.difficulty === "Hard" || q.difficulty === "Very Hard"; }).length;
    function setCard(set, num, label) {
      return '<div class="setcard"><div class="num">' + num + '</div><div class="lbl">' + label +
             '</div><button class="btn primary" data-set="' + set + '">Practice</button></div>';
    }
    grid.innerHTML =
      setCard("wrong", wrong, "Wrong Questions") +
      setCard("unanswered", unanswered, "Unanswered Questions") +
      setCard("bookmarked", bookmarked, "Bookmarked Questions") +
      setCard("difficult", difficult, "Difficult Questions");
  }

  function doSearch(term) {
    var host = $("#searchResults");
    if (!host) return;
    term = (term || "").trim().toLowerCase();
    if (term.length < 2) {
      host.innerHTML = '<p class="empty">Type at least 2 characters.</p>';
      return;
    }
    var noteBlocks = $$(".note-block");
    var noteHits = noteBlocks.filter(function (nb) { return nb.textContent.toLowerCase().indexOf(term) !== -1; });
    var qHits = questions.filter(function (q) {
      var hay = (q.question + " " + q.options.join(" ") + " " + q.topic + " " + q.subject + " " + q.explanation).toLowerCase();
      return hay.indexOf(term) !== -1;
    });
    var html = "<h3>📚 Notes (" + noteHits.length + ")</h3>";
    html += noteHits.length ? noteHits.map(function (nb) {
      return '<div class="sres" data-note="' + nb.id + '"><div class="st">' +
             esc(nb.dataset.title || "Note") + '</div><div class="ss">' + snippet(nb.textContent, term) + "</div></div>";
    }).join("") : '<p class="empty">No matching notes.</p>';
    html += '<h3 style="margin-top:1rem">📝 Questions (' + qHits.length + ")</h3>";
    html += qHits.length ? qHits.map(function (q) {
      return '<div class="sres" data-qid="' + q.id + '"><div class="st">' + esc(q.question) + '</div>' +
             '<div class="ss">' + esc(q.topic) + " • " + q.category + " • " + q.difficulty +
             " • Answer: " + esc(q.options[q.answer]) + "</div></div>";
    }).join("") : '<p class="empty">No matching questions.</p>';
    host.innerHTML = html;
  }

  function snippet(text, term) {
    var t = text.replace(/\s+/g, " ").trim();
    var i = t.toLowerCase().indexOf(term);
    if (i < 0) return esc(t.slice(0, 140)) + "…";
    var start = Math.max(0, i - 60);
    var end = Math.min(t.length, i + term.length + 90);
    return (start > 0 ? "…" : "") + esc(t.slice(start, end)) + (end < t.length ? "…" : "");
  }

  function bindUI() {
    $$("#tabs button").forEach(function (b) {
      b.addEventListener("click", function () { showView(b.dataset.view); });
    });
    var startBtn = $("#startMcqBtn");
    if (startBtn) startBtn.addEventListener("click", function () {
      state.activeSet = "all"; resetFilters(); refreshPool(); showView("test");
    });
    $$(".chip[data-cat]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.settings.category = chip.dataset.cat;
        $$(".chip[data-cat]").forEach(function (c) { c.classList.toggle("active", c === chip); });
        saveState(); refreshPool();
      });
    });
    var tf = $("#topicFilter");
    if (tf) tf.addEventListener("change", function (e) { state.settings.topic = e.target.value; saveState(); refreshPool(); });
    var df = $("#diffFilter");
    if (df) df.addEventListener("change", function (e) { state.settings.difficulty = e.target.value; saveState(); refreshPool(); });
    var ni = $("#negInput");
    if (ni) ni.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (isNaN(v) || v < 0) v = 0;
      state.settings.negative = v; e.target.value = v;
      saveState(); updateScore(); renderSetInfo();
    });
    var rb = $("#resetBtn");
    if (rb) rb.addEventListener("click", function () {
      if (confirm("Delete all saved answers for THIS part?")) {
        localStorage.removeItem(STORAGE_KEY);
        state.answers = {}; state.bookmarks = {};
        state.settings = { negative: DEFAULT_NEGATIVE_MARK, category: "ALL", topic: "ALL", difficulty: "ALL" };
        state.activeSet = "all";
        if (ni) ni.value = DEFAULT_NEGATIVE_MARK;
        if (tf) tf.value = "ALL";
        if (df) df.value = "ALL";
        $$(".chip[data-cat]").forEach(function (c) { c.classList.toggle("active", c.dataset.cat === "ALL"); });
        saveState(); refreshPool(); alert("Progress reset.");
      }
    });
    var fb = $("#finishBtn");
    if (fb) fb.addEventListener("click", finishTest);

    var qc = $("#qcard");
    if (qc) qc.addEventListener("click", function (e) {
      var opt = e.target.closest(".option");
      if (opt && !opt.disabled) { selectOption(pool[cur].id, Number(opt.dataset.orig)); return; }
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "bookmark") toggleBookmark(pool[cur].id);
      if (btn.dataset.action === "retry") { delete state.answers[pool[cur].id]; saveState(); renderAll(); }
      if (btn.dataset.action === "next")  { goNext(); }
    });

    var ng = $("#navgrid");
    if (ng) ng.addEventListener("click", function (e) {
      var btn = e.target.closest(".navbtn");
      if (!btn) return;
      cur = Number(btn.dataset.i); renderAll(); scrollToCard();
    });

    document.addEventListener("click", function (e) {
      var setBtn = e.target.closest("[data-set]");
      if (setBtn) { state.activeSet = setBtn.dataset.set; resetFilters(); refreshPool(); showView("test"); return; }
      var openBtn = e.target.closest("[data-open]");
      if (openBtn) {
        var id = Number(openBtn.dataset.open);
        state.activeSet = "bookmarked"; resetFilters();
        pool = currentPool();
        var idx = -1;
        for (var i = 0; i < pool.length; i++) if (pool[i].id === id) { idx = i; break; }
        cur = idx >= 0 ? idx : 0;
        renderAll(); showView("test"); return;
      }
      var removeBtn = e.target.closest("[data-remove]");
      if (removeBtn) { delete state.bookmarks[Number(removeBtn.dataset.remove)]; saveState(); renderBookmarks(); return; }
      var noteHit = e.target.closest("[data-note]");
      if (noteHit) {
        var nb = document.getElementById(noteHit.dataset.note);
        if (nb) {
          showView("notes");
          var parent = nb.parentElement;
          while (parent) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
          nb.open = true;
          setTimeout(function () {
            nb.scrollIntoView({ behavior: "smooth", block: "center" });
            nb.classList.add("flash");
            setTimeout(function () { nb.classList.remove("flash"); }, 1300);
          }, 120);
        }
        return;
      }
      var qHit = e.target.closest("[data-qid]");
      if (qHit) {
        var qid = Number(qHit.dataset.qid);
        state.activeSet = "all"; resetFilters();
        pool = currentPool();
        var qi = -1;
        for (var k = 0; k < pool.length; k++) if (pool[k].id === qid) { qi = k; break; }
        cur = qi >= 0 ? qi : 0;
        renderAll(); showView("test"); return;
      }
    });

    var searchTimer = null;
    var si = $("#searchInput");
    if (si) si.addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var val = e.target.value;
      searchTimer = setTimeout(function () { doSearch(val); }, 180);
    });
    var cs = $("#clearSearch");
    if (cs) cs.addEventListener("click", function () { if (si) si.value = ""; doSearch(""); });

    document.addEventListener("keydown", function (e) {
      var testView = document.getElementById("view-test");
      if (!testView || !testView.classList.contains("active")) return;
      var tag = (e.target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (["1","2","3","4"].indexOf(e.key) !== -1) {
        var btns = $$("#qcard .option");
        var i = Number(e.key) - 1;
        if (btns[i] && !btns[i].disabled) btns[i].click();
      }
      if (e.key === "ArrowRight") goNext();
    });
  }

  function resetFilters() {
    state.settings.category = "ALL";
    state.settings.topic = "ALL";
    state.settings.difficulty = "ALL";
    $$(".chip[data-cat]").forEach(function (c) { c.classList.toggle("active", c.dataset.cat === "ALL"); });
    var tf = $("#topicFilter"); if (tf) tf.value = "ALL";
    var df = $("#diffFilter");  if (df) df.value = "ALL";
    saveState();
  }

  function buildTopicOptions() {
    var seen = {};
    questions.forEach(function (q) { seen[q.topic] = true; });
    var topics = Object.keys(seen).sort();
    var sel = $("#topicFilter");
    if (!sel) return;
    topics.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }

  /* -------- Back button -------- */
  function isIndex() {
    var p = location.pathname.replace(/\\/g, "/").toLowerCase();
    return p.endsWith("/index.html") || p.endsWith("/index.htm") || p.endsWith("/") || p === "";
  }

  function makeBackBtn() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "back-btn";
    btn.setAttribute("aria-label", "Go back");
    btn.innerHTML = '<span aria-hidden="true">←</span> Back';
    btn.addEventListener("click", function () {
      try {
        if (document.referrer && document.referrer.indexOf(location.origin) === 0) {
          history.back();
          return;
        }
      } catch (e) {}
      location.href = "index.html";
    });
    return btn;
  }

  function injectBack() {
    if (document.querySelector(".back-btn")) return true;
    if (isIndex()) return true;
    var host = document.querySelector(".hero") || document.querySelector("header.topbar");
    var btn = makeBackBtn();
    if (host) {
      host.insertBefore(btn, host.firstChild);
      return true;
    }
    return false;
  }

  function tryInjectBack() {
    if (document.querySelector(".back-btn")) return;
    if (isIndex()) return;
    if (injectBack()) return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (document.querySelector(".back-btn")) { clearInterval(iv); return; }
      if (injectBack()) { clearInterval(iv); return; }
      if (tries > 20) {
        clearInterval(iv);
        var btn = makeBackBtn();
        btn.classList.add("floating");
        document.body.appendChild(btn);
      }
    }, 200);
  }

  function init() {
    loadState();
    var ni = $("#negInput");
    if (ni) ni.value = state.settings.negative;
    var df = $("#diffFilter");
    if (df) df.value = state.settings.difficulty || "ALL";
    $$(".chip[data-cat]").forEach(function (c) {
      c.classList.toggle("active", c.dataset.cat === (state.settings.category || "ALL"));
    });
    buildTopicOptions();
    var tf = $("#topicFilter");
    if (tf) tf.value = state.settings.topic || "ALL";
    $$(".note-block").forEach(function (nb, i) { if (!nb.id) nb.id = "note-" + (i + 1); });
    bindUI();
    pool = currentPool();
    cur = 0;
    renderAll();
    doSearch("");
    tryInjectBack();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.KPSC_Engine = {
    partKey: PART_KEY, partTitle: PART_TITLE, questions: questions,
    refresh: renderAll, state: state
  };
})();