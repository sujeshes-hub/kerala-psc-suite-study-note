/* =====================================================================
   Kerala PSC Study Suite — assets/js/sections.js
   ---------------------------------------------------------------------
   1. Subject page (subjects/NN-name.html)
        - subject has ONE chapter  -> topics are listed right here
                                      (no separate chapter page)
        - topics with update dates -> sorted newest update first
        - subject has 2+ chapters  -> unchanged (chapter cards)
   2. Chapter page (chapters/<folder>/<file>.html)
        - if it is the only chapter of its subject, jump to the subject
          page (old links / back buttons keep working)
   3. "Revision Notes" button loader (unchanged)

   Folders and file names are NOT changed — the chapter files stay where
   they are, they just are not an extra step any more.
   ===================================================================== */
(function () {
  "use strict";

  var path = location.pathname.replace(/\\/g, "/");
  var file = path.split("/").pop();

  var isSubjectPage = /\/subjects\/\d{2}-[a-z0-9-]+\.html$/i.test(path);
  var isChapterPage = /\/chapters\/[^\/]+\/[^\/]+\.html$/i.test(path);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function allSubjects() {
    return (window.Syllabus && window.Syllabus.getAllSubjects)
      ? window.Syllabus.getAllSubjects()
      : [];
  }

  function getRawDate(item) {
    if (!item) return "";
    return item.updatedAt || item.updateDate || item.updated ||
      item.lastUpdated || item.date || item.addedDate || "";
  }

  function parseDateValue(item) {
    var raw = getRawDate(item);
    if (!raw) return 0;
    if (typeof raw === "number") return raw;

    var str = String(raw).trim();

    /* YYYY-MM-DD or YYYY-MM-DD HH:mm(:ss) */
    var ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (ymd) {
      return new Date(
        Number(ymd[1]),
        Number(ymd[2]) - 1,
        Number(ymd[3]),
        Number(ymd[4] || 0),
        Number(ymd[5] || 0),
        Number(ymd[6] || 0)
      ).getTime();
    }

    /* DD-MM-YYYY or DD/MM/YYYY */
    var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
      return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
    }

    var ts = Date.parse(str);
    return isNaN(ts) ? 0 : ts;
  }

  /* ------------------------------------------------------------------
     2. CHAPTER PAGE — redirect when the subject has only one chapter
     ------------------------------------------------------------------ */
  if (isChapterPage) {
    var chapterId = file.replace(/\.html$/i, "").split("-")[0];
    var subs = allSubjects();
    for (var i = 0; i < subs.length; i++) {
      var S = subs[i];
      var owns = false;
      for (var j = 0; j < S.chapters.length; j++) {
        if (S.chapters[j].id === chapterId) { owns = true; break; }
      }
      if (owns) {
        if (S.chapters.length === 1) {
          location.replace("../../subjects/" + S.code + "-" + S.id + ".html");
        }
        break;
      }
    }
    return;
  }

  if (!isSubjectPage) return;

  /* ------------------------------------------------------------------
     1. SUBJECT PAGE — single chapter -> show topics directly
     ------------------------------------------------------------------ */
  function showTopicsDirectly() {
    var grid = document.getElementById("chapterGrid");
    if (!grid) return true;                       /* nothing to change   */
    if (grid.querySelector(".empty")) return false; /* still "Loading..." */

    var slug = file.replace(/\.html$/i, "").replace(/^\d+-/, "");
    var subj = window.Syllabus && window.Syllabus.getSubject
      ? window.Syllabus.getSubject(slug)
      : null;
    if (!subj || !subj.chapters || subj.chapters.length !== 1) return true;

    var topics = (subj.chapters[0].topics || []).slice();
    if (!topics.length) return true;

    /* Sort newest update date first when any topic has an update date */
    var hasAnyDate = false;
    for (var d = 0; d < topics.length; d++) {
      if (parseDateValue(topics[d]) > 0) { hasAnyDate = true; break; }
    }
    if (hasAnyDate) {
      topics.sort(function (a, b) {
        return parseDateValue(b) - parseDateValue(a);
      });
    }

    var head = document.querySelector(".section-head h2");
    if (head) head.textContent = "Topics in this Subject";

    grid.innerHTML = topics.map(function (t) {
      var badge = t.tag === "573" ? "573 only" : t.tag === "883" ? "883 only" : "BOTH";
      var cls   = t.tag === "573" ? "c573"     : t.tag === "883" ? "c883"     : "";

      if (!t.file) {
        return '<div class="card" style="opacity:.72;cursor:default">' +
          '<span class="badge ' + cls + '">' + esc(t.id) + '</span>' +
          '<h3>' + esc(t.title) + '</h3>' +
          '<p class="desc">' + esc(t.titleMl) + '</p>' +
          '<div class="meta"><span>Coming soon</span><span>' + badge + '</span></div>' +
          '<div class="bar"><i style="width:0%"></i></div>' +
        '</div>';
      }

      var rawDate = getRawDate(t);
      var mcqText = (t.qs || 0) + ' MCQs' + (rawDate ? ' · ' + esc(rawDate) : '');

      return '<a href="../' + esc(t.file) + '" class="card" data-part="' + esc(t.key) +
          '" data-total="' + (t.qs || 0) + '">' +
        '<span class="badge ' + cls + '">' + esc(t.id) + '</span>' +
        '<h3>' + esc(t.title) + '</h3>' +
        '<p class="desc">' + esc(t.titleMl) + '</p>' +
        '<div class="meta"><span>' + mcqText + '</span><span>' + badge + '</span></div>' +
        '<div class="bar"><i style="width:0%"></i></div>' +
        '<div class="progressline"><span class="status">Not started</span><span class="score"></span></div>' +
      '</a>';
    }).join("");

    return true;
  }

  var tries = 0;
  (function run() {
    if (showTopicsDirectly() === false && tries++ < 20) setTimeout(run, 100);
  })();

  /* ------------------------------------------------------------------
     3. REVISION NOTES BUTTON LOADER (unchanged)
     ------------------------------------------------------------------ */
  if (document.querySelector('script[data-kpsc-revision-loader]')) return;

  var prefix = "";
  var scripts = document.querySelectorAll("script[src]");
  for (var k = 0; k < scripts.length; k++) {
    var m = (scripts[k].getAttribute("src") || "").match(/^(.*?)assets\/js\//);
    if (m) { prefix = m[1]; break; }
  }
  if (!prefix) {
    var depth = 0;
    if (/\/subjects\//.test(path)) depth = 1;
    prefix = new Array(depth + 1).join("../");
  }

  var s = document.createElement("script");
  s.src = prefix + "assets/js/revision-loader.js";
  s.setAttribute("data-kpsc-revision-loader", "1");
  document.head.appendChild(s);
})();