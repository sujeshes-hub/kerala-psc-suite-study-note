/* =====================================================================
   Kerala PSC Study Suite — All Subjects Quick Revision (aggregated)
   Path: assets/js/quick-revision.js

   - Reads window.KPSC_SYLLABUS.FILES (from syllabus.js)
   - Fetches each topic file
   - Extracts revision sections (#sec15, #sec16, #sec17 — or fallbacks)
   - Renders grouped by subject → topic → section
   - Shows clear notice banner for file:// / fetch errors / missing syllabus
   ===================================================================== */
(function () {
  "use strict";

  var CACHE_KEY       = "kpsc_qr_cache_v5";
  var CACHE_TTL       = 1000 * 60 * 60 * 24 * 30;   // 30 days
  var MIN_LEN         = 8;
  var MAX_LEN         = 700;
  var RERENDER_EVERY  = 3;

  var SUBJECTS = {
    "1":  { icon:"📜", title:"History",                      titleMl:"ചരിത്രം",                       tag:"BOTH" },
    "2":  { icon:"🌍", title:"Geography",                    titleMl:"ഭൂമിശാസ്ത്രം",                  tag:"BOTH" },
    "3":  { icon:"💰", title:"Economics",                    titleMl:"സാമ്പത്തികം",                   tag:"BOTH" },
    "4":  { icon:"🏛️", title:"Indian Constitution",          titleMl:"ഇന്ത്യൻ ഭരണഘടന",               tag:"BOTH" },
    "5":  { icon:"🏢", title:"Kerala Administration",        titleMl:"കേരള ഭരണം",                    tag:"BOTH" },
    "6":  { icon:"🔬", title:"Biology & Public Health",      titleMl:"ജീവശാസ്ത്രവും പൊതുജനാരോഗ്യവും", tag:"BOTH" },
    "7":  { icon:"⚛️", title:"Physics",                      titleMl:"ഭൗതികശാസ്ത്രം",                 tag:"BOTH" },
    "8":  { icon:"🧪", title:"Chemistry",                    titleMl:"രസതന്ത്രം",                     tag:"BOTH" },
    "9":  { icon:"🎭", title:"Art, Sports & Literature",     titleMl:"കല, കായികം, സാഹിത്യം",          tag:"BOTH" },
    "10": { icon:"💻", title:"Computer & IT",                titleMl:"കമ്പ്യൂട്ടർ",                   tag:"BOTH" },
    "11": { icon:"🔢", title:"Simple Arithmetic",            titleMl:"ലഘു ഗണിതം",                    tag:"BOTH" },
    "12": { icon:"🧠", title:"Mental Ability",               titleMl:"മാനസിക നൈപുണ്യം",              tag:"BOTH" },
    "13": { icon:"📖", title:"General English",              titleMl:"ഇംഗ്ലീഷ്",                      tag:"BOTH" },
    "14": { icon:"✍️", title:"Malayalam",                    titleMl:"മലയാളം",                        tag:"BOTH" },
    "15": { icon:"📰", title:"Current Affairs",              titleMl:"നിലവിലെ കാര്യങ്ങൾ",             tag:"BOTH" },
    "16": { icon:"⚖️", title:"Important Acts",               titleMl:"പ്രധാന നിയമങ്ങൾ",               tag:"573"  },
    "17": { icon:"📐", title:"Legal Metrology",              titleMl:"ലീഗൽ മെട്രോളജി",                tag:"883"  }
  };

  /* ---------- DOM ---------- */
  var host      = document.getElementById("qrHost");
  var statEl    = document.getElementById("qrStat");
  var progress  = document.getElementById("qrProgress");
  var barFill   = document.getElementById("qrBarFill");
  var statusEl  = document.getElementById("qrStatus");
  var noticeEl  = document.getElementById("qrNotice");
  var searchEl  = document.getElementById("qrSearch");
  var chipsEl   = document.getElementById("qrChips");

  if (!host) return;

  var state = {
    data: [],
    activeTag: "ALL",
    term: "",
    collapsed: {}
  };
  var loading = false;

  /* ---------- notice banner ---------- */
  function showNotice(kind, html) {
    if (!noticeEl) return;
    noticeEl.className = "qrnotice " + kind;
    noticeEl.innerHTML = html;
    noticeEl.style.display = "block";
  }
  function hideNotice() {
    if (!noticeEl) return;
    noticeEl.style.display = "none";
    noticeEl.innerHTML = "";
  }

  /* ---------- progress ---------- */
  function showProgress() { if (progress) progress.hidden = false; }
  function hideProgress() { if (progress) progress.hidden = true; }
  function setProgress(done, total, label) {
    if (barFill) barFill.style.width = (total ? (done / total) * 100 : 0) + "%";
    if (statusEl) statusEl.textContent = label || (done + " / " + total);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function hl(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    var t = esc(q), lower = safe.toLowerCase(), lt = t.toLowerCase();
    var out = "", i = 0, pos;
    while ((pos = lower.indexOf(lt, i)) !== -1) {
      out += safe.slice(i, pos) + "<mark>" + safe.slice(pos, pos + t.length) + "</mark>";
      i = pos + t.length;
    }
    return out + safe.slice(i);
  }
  function tagClass(t) {
    if (t === "573") return "c573";
    if (t === "883") return "c883";
    return "both";
  }
  function normalize(t) {
    return String(t).toLowerCase().replace(/\s+/g, " ").trim();
  }
  function cleanText(t) {
    return String(t)
      .replace(/^[\s➕🧠⭐⚠️✅❌🟢🟡🟠🔴📌🎯🔑💡📝📚🧩🔎❓❗]+/u, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function dedupe(points, seen) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var k = normalize(points[i]);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      out.push(points[i]);
    }
    return out;
  }

  /* ---------- HTML parsing ---------- */
  function extractGroup(sec) {
    var h2 = sec.querySelector("h2");
    var heading = "";
    if (h2) {
      heading = h2.textContent
        .replace(/[▾▸]/g, "")
        .replace(/^\s*\d+\s*[\.\)]\s*/, "")
        .trim();
    }
    if (!heading) heading = "Revision";

    var raw = [];
    sec.querySelectorAll("ul > li, ol > li").forEach(function (li) {
      if (li.closest(".question-item")) return;
      var txt = cleanText(li.textContent);
      if (txt.length >= MIN_LEN && txt.length <= MAX_LEN) raw.push(txt);
    });

    if (!raw.length) {
      sec.querySelectorAll(".added-fact, .memory, .revision-points, .important, .trap, .correction").forEach(function (el) {
        var clone = el.cloneNode(true);
        clone.querySelectorAll("li").forEach(function (l) { l.remove(); });
        var txt = cleanText(clone.textContent);
        if (txt.length >= MIN_LEN && txt.length <= MAX_LEN) raw.push(txt);
      });
    }

    return raw.length ? { heading: heading, points: raw } : null;
  }

  function extractGroups(doc) {
    var groups = [];
    var used = [];
    var seen = Object.create(null);

    ["sec15", "sec16", "sec17"].forEach(function (id) {
      var sec = doc.getElementById(id);
      if (!sec || used.indexOf(sec) !== -1) return;
      used.push(sec);
      var g = extractGroup(sec);
      if (!g) return;
      var pts = dedupe(g.points, seen);
      if (pts.length) groups.push({ heading: g.heading, points: pts });
    });

    if (!groups.length) {
      var secs = doc.querySelectorAll(".section");
      for (var i = 0; i < secs.length; i++) {
        var sec = secs[i];
        if (used.indexOf(sec) !== -1) continue;
        var h2 = sec.querySelector("h2");
        if (!h2) continue;
        var t = h2.textContent.toLowerCase();
        if (t.indexOf("revision") !== -1 ||
            t.indexOf("quick")    !== -1 ||
            t.indexOf("30-second") !== -1 ||
            t.indexOf("one-page") !== -1 ||
            /\btop\s*\d+/.test(t)) {
          var g2 = extractGroup(sec);
          if (!g2) continue;
          var pts2 = dedupe(g2.points, seen);
          if (pts2.length) groups.push({ heading: g2.heading, points: pts2 });
        }
      }
    }
    return groups;
  }

  function topicTitleFromDoc(topicId, doc) {
    var h1 = doc.querySelector(".chapter-title");
    if (h1 && h1.textContent.trim()) return topicId + " — " + h1.textContent.trim();
    var SYL = window.KPSC_SYLLABUS;
    var ml = (SYL && SYL.TITLE_ML && SYL.TITLE_ML[topicId]) || "";
    if (ml) return topicId + " — " + ml;
    try {
      if (SYL && SYL.find) {
        var node = SYL.find(topicId);
        if (node && node.title) return topicId + " — " + node.title;
      }
    } catch (e) {}
    return topicId;
  }

  /* ---------- cache ---------- */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }
  function saveCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  /* ---------- data assembly ---------- */
  function ensureSubject(subjId) {
    for (var i = 0; i < state.data.length; i++) {
      if (state.data[i].subjId === subjId) return state.data[i];
    }
    var s = { subjId: subjId, topics: [] };
    state.data.push(s);
    state.data.sort(function (a, b) { return Number(a.subjId) - Number(b.subjId); });
    return s;
  }
  function ensureTopic(subj, topicId, title) {
    for (var i = 0; i < subj.topics.length; i++) {
      if (subj.topics[i].topicId === topicId) return subj.topics[i];
    }
    var t = { topicId: topicId, title: title, groups: [] };
    subj.topics.push(t);
    subj.topics.sort(function (a, b) {
      return a.topicId.localeCompare(b.topicId, undefined, { numeric: true });
    });
    return t;
  }
  function addTopic(topicId, title, groups) {
    if (!groups || !groups.length) return;
    var subjId = String(topicId).split(".")[0];
    var subj = ensureSubject(subjId);
    var topic = ensureTopic(subj, topicId, title);
    topic.groups = groups;
  }

  /* ---------- rendering ---------- */
  function render() {
    var q = state.term.trim().toLowerCase();
    var html = "";
    var totalSubj = 0, totalPts = 0;

    state.data.forEach(function (subj) {
      var meta = SUBJECTS[subj.subjId] || { icon:"📘", title:"Subject " + subj.subjId, titleMl:"", tag:"BOTH" };
      if (state.activeTag !== "ALL" && meta.tag !== "BOTH" && meta.tag !== state.activeTag) return;

      var topicsHtml = "";
      var subjCount = 0;

      subj.topics.forEach(function (tp) {
        var groupsHtml = "";
        var topicCount = 0;

        tp.groups.forEach(function (g) {
          var pts = g.points.filter(function (p) {
            if (!q) return true;
            return p.toLowerCase().indexOf(q) !== -1 ||
                   (g.heading || "").toLowerCase().indexOf(q) !== -1 ||
                   (tp.title   || "").toLowerCase().indexOf(q) !== -1;
          });
          if (!pts.length) return;
          topicCount += pts.length;
          groupsHtml +=
            '<h5 class="qrgh">' + hl(g.heading, q) + "</h5><ul>" +
            pts.map(function (p) { return "<li>" + hl(p, q) + "</li>"; }).join("") +
            "</ul>";
        });

        if (!topicCount) return;
        subjCount += topicCount;

        topicsHtml +=
          '<div class="qrtopic">' +
            '<h4 class="qrth">' + hl(tp.title, q) + "</h4>" +
            groupsHtml +
          "</div>";
      });

      if (!subjCount) return;
      totalSubj++;
      totalPts += subjCount;

      html +=
        '<section class="qrcard' + (state.collapsed[subj.subjId] ? " collapsed" : "") + '" data-sub="' + esc(subj.subjId) + '">' +
          '<div class="qrhead" role="button" tabindex="0" aria-expanded="' + (state.collapsed[subj.subjId] ? "false" : "true") + '">' +
            '<span class="ico">' + meta.icon + "</span>" +
            '<span class="ttl">' + esc(meta.title) + "</span>" +
            '<span class="ttlml">' + esc(meta.titleMl) + "</span>" +
            '<span class="tag ' + tagClass(meta.tag) + '">' + (meta.tag === "BOTH" ? "573 + 883" : meta.tag) + "</span>" +
            '<span class="cnt">' + subjCount + " pts</span>" +
            '<span class="arw">▾</span>' +
          "</div>" +
          '<div class="qrbody">' + topicsHtml + "</div>" +
        "</section>";
    });

    host.innerHTML = html || '<p class="qrempty">No revision points loaded yet.</p>';
    if (statEl) {
      statEl.textContent = totalSubj + " subject(s) • " + totalPts + " revision point(s)"
                         + (q ? "  •  filter: “" + state.term.trim() + "”" : "");
    }
    var bs = document.getElementById("badgeSubjects");
    var bp = document.getElementById("badgePoints");
    if (bs) bs.textContent = totalSubj + " Subjects";
    if (bp) bp.textContent = totalPts + " Points";
  }

  /* ---------- loading ---------- */
  function isFileProtocol() {
    return location.protocol === "file:";
  }

  async function loadAll(forceReload) {
    if (loading) return;
    loading = true;

    state.data = [];
    render();
    hideNotice();

    /* 1) syllabus.js must be present */
    var SYL = window.KPSC_SYLLABUS;
    if (!SYL || !SYL.FILES) {
      showNotice("err",
        "<b>❌ syllabus.js not loaded.</b><br>" +
        "The topic list comes from <code>assets/js/syllabus.js</code>. " +
        "Make sure the script tag <code>&lt;script src=\"assets/js/syllabus.js\"&gt;&lt;/script&gt;</code> " +
        "appears <b>before</b> <code>quick-revision.js</code> in the HTML.");
      hideProgress();
      loading = false;
      return;
    }

    var allEntries = Object.keys(SYL.FILES).map(function (id) {
      return { topicId: id, path: SYL.FILES[id].file };
    }).filter(function (e) { return e.path; });

    if (!allEntries.length) {
      showNotice("err",
        "<b>❌ No topic files registered in <code>KPSC_SYLLABUS.FILES</code>.</b> " +
        "Check your <code>syllabus.js</code>.");
      hideProgress();
      loading = false;
      return;
    }

    /* 2) load whatever is already in cache */
    var cache = forceReload ? {} : readCache();
    var now = Date.now();
    var fetchQueue = [];

    allEntries.forEach(function (e) {
      var c = cache[e.path];
      if (c && c.groups && c.groups.length && (now - (c.ts || 0)) < CACHE_TTL) {
        addTopic(e.topicId, c.title || e.topicId, c.groups);
      } else {
        fetchQueue.push(e);
      }
    });

    render();

    /* 3) if cache covers everything, done */
    if (!fetchQueue.length) {
      showNotice("info",
        "✓ Loaded <b>" + allEntries.length + "</b> topic files from local cache. " +
        "Click <b>↻ Reload data</b> to fetch fresh content from topic pages.");
      hideProgress();
      loading = false;
      return;
    }

    /* 4) file:// — fetch will not work */
    if (isFileProtocol()) {
      showNotice("warn",
        "<b>⚠️ Page opened as a local file (<code>file://</code>).</b><br>" +
        "Browsers block JavaScript from reading other local files, so topic pages cannot be loaded.<br><br>" +
        "<b>Fix — pick one:</b><br>" +
        "1. <b>Local server:</b> open a terminal in the project folder and run " +
        "<code>python -m http.server 8000</code>, " +
        "then visit <code>http://localhost:8000/all-subjects-quick-revision.html</code>.<br>" +
        "2. <b>Host it:</b> upload the folder to GitHub Pages, Netlify, Vercel, etc. " +
        "Then the page works in the normal way.<br><br>" +
        (state.data.length
          ? "<i>Showing " + state.data.length + " cached subject(s) below.</i>"
          : "<i>No cached data available yet.</i>"));
      hideProgress();
      loading = false;
      return;
    }

    /* 5) fetch each topic file over HTTP */
    showProgress();
    var done = 0, total = fetchQueue.length, ok = 0, fail = 0;
    setProgress(0, total, "Loading 0 / " + total + " topic files…");

    for (var i = 0; i < fetchQueue.length; i++) {
      var e = fetchQueue[i];
      try {
        var res = await fetch(e.path, { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var html = await res.text();
        var doc = new DOMParser().parseFromString(html, "text/html");
        var groups = extractGroups(doc);
        if (groups.length) {
          var title = topicTitleFromDoc(e.topicId, doc);
          cache[e.path] = { ts: now, title: title, groups: groups };
          addTopic(e.topicId, title, groups);
          ok++;
        }
      } catch (err) {
        fail++;
        // silent — most 404s are topics that simply don't exist yet
      }
      done++;
      setProgress(done, total, "Loading " + done + " / " + total + " topic files…");
      if ((done % RERENDER_EVERY) === 0) render();
    }

    saveCache(cache);
    render();
    setProgress(total, total, "✓ Done — " + ok + " file(s) parsed" + (fail ? ", " + fail + " skipped" : ""));

    var noticeKind = (!ok && !state.data.length) ? "err" : "info";
    var noticeMsg;
    if (ok && state.data.length) {
      noticeMsg = "✓ Loaded <b>" + ok + "</b> topic file(s) from server" +
                  (fail ? " • " + fail + " file(s) skipped (not found or empty)" : "") + ".";
    } else if (state.data.length) {
      noticeMsg = "Showing cached content. Click <b>↻ Reload data</b> to re-fetch from server.";
    } else {
      noticeMsg = "<b>No revision content found.</b><br>" +
                  "None of the " + total + " topic file(s) listed in <code>syllabus.js</code> could be parsed. " +
                  "Possible reasons:<br>" +
                  "• Topic pages do not contain sections with IDs <code>sec15</code>, <code>sec16</code>, <code>sec17</code> and no heading matches <i>“Revision”</i>, <i>“30-Second”</i>, <i>“One-Page”</i>, or <i>“Top N”</i>.<br>" +
                  "• The paths in <code>KPSC_SYLLABUS.FILES</code> do not match your actual folder structure.<br>" +
                  "Open DevTools → Network tab and reload to see which topic URLs return 404.";
    }
    showNotice(noticeKind, noticeMsg);
    setTimeout(hideProgress, 900);

    loading = false;
  }

  /* ---------- interactions ---------- */
  host.addEventListener("click", function (e) {
    var head = e.target.closest(".qrhead");
    if (!head) return;
    var card = head.closest(".qrcard");
    var id = card.dataset.sub;
    state.collapsed[id] = !state.collapsed[id];
    card.classList.toggle("collapsed", !!state.collapsed[id]);
    head.setAttribute("aria-expanded", state.collapsed[id] ? "false" : "true");
  });
  host.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var head = e.target.closest(".qrhead");
    if (!head) return;
    e.preventDefault(); head.click();
  });

  var tmr = null;
  if (searchEl) searchEl.addEventListener("input", function (e) {
    clearTimeout(tmr);
    var v = e.target.value;
    tmr = setTimeout(function () { state.term = v; render(); }, 140);
  });

  var clearBtn = document.getElementById("clearQr");
  if (clearBtn) clearBtn.addEventListener("click", function () {
    if (searchEl) searchEl.value = "";
    state.term = ""; render();
    if (searchEl) searchEl.focus();
  });

  if (chipsEl) chipsEl.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.activeTag = chip.dataset.tag;
    Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("active", c === chip);
    });
    render();
  });

  var expandAll = document.getElementById("expandAll");
  if (expandAll) expandAll.addEventListener("click", function () { state.collapsed = {}; render(); });
  var collapseAll = document.getElementById("collapseAll");
  if (collapseAll) collapseAll.addEventListener("click", function () {
    state.collapsed = {};
    state.data.forEach(function (s) { state.collapsed[s.subjId] = true; });
    render();
  });
  var printBtn = document.getElementById("printBtn");
  if (printBtn) printBtn.addEventListener("click", function () {
    state.collapsed = {}; render();
    setTimeout(function () { window.print(); }, 120);
  });
  var reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    loadAll(true);
  });

  /* ---------- init ---------- */
  function init() { loadAll(false); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.KPSC_QuickRevision = { reload: function () { loadAll(true); }, state: state };
})();