/* =====================================================================
   Kerala PSC Study Suite — assets/js/sections.js
   ---------------------------------------------------------------------
   1. Subject page (subjects/NN-name.html)
        - subject has ONE chapter  -> topics are listed right here
                                      (no separate chapter page)
        - topics with update dates -> sorted newest update first
        - Current Affairs (15)     -> auto-detects and lists month-wise
                                      HTML files from topics/current-affairs/
                                      (offline via list.js + live GitHub API)
   2. Chapter page (chapters/<folder>/<file>.html)
        - if it is the only chapter of its subject, jump to the subject
          page (old links / back buttons keep working)
   3. "Revision Notes" button loader (unchanged)
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

  function safeUrlPath(prefix, relFile) {
    return prefix + String(relFile || "").split("/").map(encodeURIComponent).join("/");
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

  function parseDateValue(rawOrItem) {
    var raw = (rawOrItem && typeof rawOrItem === "object") ? getRawDate(rawOrItem) : rawOrItem;
    if (!raw) return 0;
    if (typeof raw === "number") return isFinite(raw) ? raw : 0;

    var str = String(raw).trim();
    if (!str) return 0;

    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+\-]\d{2}:?\d{2})$/i.test(str)) {
      var iso = Date.parse(str);
      if (!isNaN(iso)) return iso;
    }

    var ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (ymd) {
      return new Date(
        Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]),
        Number(ymd[4] || 0), Number(ymd[5] || 0), Number(ymd[6] || 0)
      ).getTime();
    }

    var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (dmy) {
      return new Date(
        Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]),
        Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0)
      ).getTime();
    }

    var ts = Date.parse(str);
    return isNaN(ts) ? 0 : ts;
  }

  function formatDisplayDate(raw) {
    if (!raw) return "";
    var str = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    var ms = parseDateValue(str);
    if (!ms) return str;
    var d = new Date(ms);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
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
     1B. CURRENT AFFAIRS — Auto-detect & list month-wise HTML files
     ------------------------------------------------------------------ */
  var caMonthlyStarted = false;

  function initCurrentAffairsMonthly(grid) {
    if (caMonthlyStarted || document.getElementById("caMonthlySection")) return;
    caMonthlyStarted = true;

    var CA_FOLDER = "topics/current-affairs";
    var CA_BASE   = "../topics/current-affairs/";
    var CA_FIXED  = /^15\.\d+\.\d+-/i;
    var RECENT_MS = 1000 * 60 * 60 * 24 * 7;

    var MONTH_NAMES = [
      "", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    var MONTH_PATS = [
      [1,  "(?:january|jan|ജനുവരി)"],
      [2,  "(?:february|feb|ഫെബ്രുവരി)"],
      [3,  "(?:march|mar|മാർച്ച്|മാര്ച്ച്)"],
      [4,  "(?:april|apr|ഏപ്രിൽ|ഏപ്രില്)"],
      [5,  "(?:may|മെയ്|മേയ്)"],
      [6,  "(?:june|jun|ജൂൺ|ജൂണ്)"],
      [7,  "(?:july|jul|ജൂലൈ)"],
      [8,  "(?:august|aug|ഓഗസ്റ്റ്|ആഗസ്റ്റ്)"],
      [9,  "(?:september|sept|sep|സെപ്റ്റംബർ|സെപ്തംബർ)"],
      [10, "(?:october|oct|ഒക്ടോബർ|ഒക്‌ടോബർ)"],
      [11, "(?:november|nov|നവംബർ)"],
      [12, "(?:december|dec|ഡിസംബർ)"]
    ];

    function detectMonthYear(sources) {
      for (var sIdx = 0; sIdx < sources.length; sIdx++) {
        var s = String(sources[sIdx] || "").trim();
        if (!s) continue;

        for (var mIdx = 0; mIdx < MONTH_PATS.length; mIdx++) {
          var mNum = MONTH_PATS[mIdx][0];
          var pat = MONTH_PATS[mIdx][1];
          var r1 = new RegExp("(?:^|[^a-zA-Z0-9])" + pat + "(?:[^a-zA-Z0-9]|$)[\\s_\\-/,]*(20\\d{2})\\b", "i");
          var r2 = new RegExp("\\b(20\\d{2})[\\s_\\-/,]*" + pat + "(?:[^a-zA-Z0-9]|$)", "i");
          var m = s.match(r1) || s.match(r2);
          if (m) {
            var yr = Number(m[1]);
            return {
              month: yr + "-" + String(mNum).padStart(2, "0"),
              monthLabel: MONTH_NAMES[mNum] + " " + yr,
              year: String(yr)
            };
          }
        }

        var ym = s.match(/(?:^|[^\d])(20\d{2})[_\-\/ ](0?[1-9]|1[0-2])(?![\d])/);
        if (ym) {
          var yr2 = Number(ym[1]), mn2 = Number(ym[2]);
          return {
            month: yr2 + "-" + String(mn2).padStart(2, "0"),
            monthLabel: MONTH_NAMES[mn2] + " " + yr2,
            year: String(yr2)
          };
        }

        var my = s.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[_\-\/ ](20\d{2})(?![\d])/);
        if (my) {
          var mn3 = Number(my[1]), yr3 = Number(my[2]);
          return {
            month: yr3 + "-" + String(mn3).padStart(2, "0"),
            monthLabel: MONTH_NAMES[mn3] + " " + yr3,
            year: String(yr3)
          };
        }
      }
      return { month: "", monthLabel: "", year: "" };
    }

    function titleFromFilename(name) {
      var base = String(name || "").split("/").pop();
      return base
        .replace(/\.html?$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function isRecent(raw) {
      var ms = parseDateValue(raw);
      if (!ms) return false;
      var diff = Date.now() - ms;
      return diff >= -86400000 && diff <= RECENT_MS;
    }

    function detectRepo() {
      var host = location.hostname;
      var parts = location.pathname.split("/").filter(Boolean);
      if (!host.endsWith(".github.io") || parts.length < 1) return null;
      return { owner: host.replace(".github.io", ""), repo: parts[0] };
    }

    function sortMonthly(a, b) {
      var ma = a.month || "";
      var mb = b.month || "";
      if (ma !== mb) return ma < mb ? 1 : -1;
      var ta = parseDateValue(a);
      var tb = parseDateValue(b);
      if (ta !== tb) return tb - ta;
      return String(a.file || "").localeCompare(String(b.file || ""));
    }

    /* Inject styles once */
    if (!document.getElementById("kpscCaMonthlyCss")) {
      var st = document.createElement("style");
      st.id = "kpscCaMonthlyCss";
      st.textContent =
        "#caMonthlySection{margin:1.2rem 0 1.8rem}" +
        "#caMonthlySection .ca-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.85rem}" +
        "#caMonthlySection .ca-search{flex:1 1 210px;padding:.46rem .75rem;border:1px solid var(--line,#dde4ee);border-radius:10px;background:var(--card,#fff);color:var(--ink,#16223a);font:inherit;font-size:.84rem}" +
        "#caMonthlySection .ca-chips{display:flex;gap:.35rem;flex-wrap:wrap}" +
        "#caMonthlySection .ca-chip{border:1px solid var(--line,#dde4ee);background:var(--card,#fff);color:var(--muted,#5b6b85);padding:.3rem .7rem;border-radius:999px;font:700 .76rem inherit;cursor:pointer}" +
        "#caMonthlySection .ca-chip.active{background:var(--brand,#0b5d63);border-color:var(--brand,#0b5d63);color:#fff}" +
        "#caMonthlySection .ca-file{display:inline-block;max-width:100%;margin:.1rem 0 .45rem;padding:.16rem .48rem;border-radius:6px;background:rgba(100,116,139,.1);border:1px solid var(--line,#dde4ee);color:var(--muted,#5b6b85);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.71rem;overflow-wrap:anywhere;word-break:break-word}" +
        "#caMonthlySection .ca-new{background:#e6f6ec;color:#177a3d;font-size:.68rem;font-weight:800;padding:.12rem .5rem;border-radius:999px;margin-left:.35rem}" +
        "#caMonthlySection .ca-empty{padding:16px;text-align:center;color:var(--muted,#5b6b85);font-size:.86rem;background:var(--card,#fff);border:1px dashed var(--line,#dde4ee);border-radius:12px;grid-column:1 / -1}";
      document.head.appendChild(st);
    }

    /* Build section container above syllabus topics */
    var sec = document.createElement("section");
    sec.id = "caMonthlySection";
    sec.innerHTML =
      '<div class="section-head">' +
        '<h2>📅 Month-wise Current Affairs</h2>' +
        '<button type="button" class="btn" id="caMonthlyRefresh">↻ Refresh</button>' +
      '</div>' +
      '<div class="ca-bar" id="caMonthlyBar" style="display:none">' +
        '<input type="search" class="ca-search" id="caMonthlySearch" placeholder="Search month or filename (e.g. October 2026)…" autocomplete="off">' +
        '<div class="ca-chips" id="caYearChips"></div>' +
      '</div>' +
      '<div class="grid" id="caMonthlyGrid"><p class="empty">Checking month-wise files…</p></div>';

    var hostSection = grid.closest ? grid.closest("section") : null;
    if (hostSection && hostSection.parentNode) {
      hostSection.parentNode.insertBefore(sec, hostSection);
    } else if (grid.parentNode) {
      grid.parentNode.insertBefore(sec, grid);
    }

    var caGrid   = document.getElementById("caMonthlyGrid");
    var caBar    = document.getElementById("caMonthlyBar");
    var caSearch = document.getElementById("caMonthlySearch");
    var caYears  = document.getElementById("caYearChips");
    var caRefBtn = document.getElementById("caMonthlyRefresh");

    var caState = { items: [], query: "", year: "ALL" };

    function renderYearChips() {
      var yearMap = {};
      caState.items.forEach(function (it) { if (it.year) yearMap[it.year] = 1; });
      var years = Object.keys(yearMap).sort().reverse();
      if (years.length < 2) { caYears.innerHTML = ""; return; }
      if (caState.year !== "ALL" && !yearMap[caState.year]) caState.year = "ALL";
      var html = '<button type="button" class="ca-chip' + (caState.year === "ALL" ? " active" : "") + '" data-year="ALL">All</button>';
      years.forEach(function (y) {
        html += '<button type="button" class="ca-chip' + (caState.year === y ? " active" : "") + '" data-year="' + esc(y) + '">' + esc(y) + '</button>';
      });
      caYears.innerHTML = html;
    }

    function renderMonthly() {
      var all = caState.items;
      if (!all.length) {
        caBar.style.display = "none";
        caGrid.innerHTML =
          '<div class="ca-empty">' +
            'No month-wise HTML files added yet.<br>' +
            'Add files like <code>october-2026.html</code> inside <code>topics/current-affairs/</code> ' +
            'and run <code>python tools/build_content.py</code> (or push to GitHub Pages).' +
          '</div>';
        return;
      }

      caBar.style.display = "flex";
      renderYearChips();

      var q = caState.query.trim().toLowerCase();
      var list = all.filter(function (it) {
        if (caState.year !== "ALL" && it.year !== caState.year) return false;
        if (!q) return true;
        var hay = [it.title, it.monthLabel, it.month, it.file].join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
      }).sort(sortMonthly);

      if (!list.length) {
        caGrid.innerHTML = '<div class="ca-empty">No matching month-wise files found.</div>';
        return;
      }

      caGrid.innerHTML = list.map(function (it) {
        var badge = it.monthLabel || "Monthly";
        var rawDate = getRawDate(it);
        var dateTxt = formatDisplayDate(rawDate);
        var newTag = isRecent(rawDate) ? '<span class="ca-new">NEW</span>' : '';
        return '<a href="' + safeUrlPath(CA_BASE, it.file) + '" class="card" data-part="' + esc(it.key || it.id) + '" data-total="' + (it.qs || 0) + '">' +
          '<span class="badge">' + esc(badge) + '</span>' +
          '<h3>📰 ' + esc(it.title || titleFromFilename(it.file)) + newTag + '</h3>' +
          '<div class="ca-file" title="' + esc(it.file) + '">📁 ' + esc(it.file) + '</div>' +
          '<div class="meta">' +
            (it.qs ? '<span>' + it.qs + ' MCQs</span>' : '<span>Study Notes</span>') +
            (dateTxt ? '<span title="' + esc(rawDate) + '">📅 ' + esc(dateTxt) + '</span>' : '') +
            '<span>BOTH</span>' +
          '</div>' +
        '</a>';
      }).join("");
    }

    function normalizeEntry(raw) {
      var fileRel = raw.file || "";
      var info = detectMonthYear([raw.month, raw.monthLabel, fileRel, raw.title]);
      return {
        id: raw.id || fileRel.replace(/\.html?$/i, ""),
        key: raw.key || ("current-affairs-" + fileRel.replace(/\.html?$/i, "")),
        title: raw.title || titleFromFilename(fileRel),
        month: raw.month || info.month,
        monthLabel: raw.monthLabel || info.monthLabel,
        year: raw.year || info.year,
        file: fileRel,
        qs: Number(raw.qs) || 0,
        updated: getRawDate(raw)
      };
    }

    function loadManifestScript(force) {
      return new Promise(function (resolve) {
        var old = document.querySelector("script[data-kpsc-ca-list]");
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var s = document.createElement("script");
        var bust = (force && location.protocol !== "file:") ? ("?t=" + Date.now()) : "";
        s.src = CA_BASE + "list.js" + bust;
        s.setAttribute("data-kpsc-ca-list", "1");
        s.onload = function () { resolve(Array.isArray(window.CURRENT_AFFAIRS_MONTHLY) ? window.CURRENT_AFFAIRS_MONTHLY : []); };
        s.onerror = function () { resolve([]); };
        document.head.appendChild(s);
      });
    }

    function fetchGithubDir(repo, folderPath) {
      var url = "https://api.github.com/repos/" + repo.owner + "/" + repo.repo +
                "/contents/" + folderPath + "?ref=main";
      return fetch(url, { headers: { "Accept": "application/vnd.github+json" } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (data) { return Array.isArray(data) ? data : []; })
        .catch(function () { return []; });
    }

    function fetchGithubCommitDate(repo, relFile) {
      var url = "https://api.github.com/repos/" + repo.owner + "/" + repo.repo +
                "/commits?path=" + encodeURIComponent(CA_FOLDER + "/" + relFile) + "&per_page=1";
      return fetch(url, { headers: { "Accept": "application/vnd.github+json" } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (c) {
          if (Array.isArray(c) && c[0] && c[0].commit) {
            return (c[0].commit.committer && c[0].commit.committer.date) ||
                   (c[0].commit.author && c[0].commit.author.date) || "";
          }
          return "";
        })
        .catch(function () { return ""; });
    }

    function readRemoteFileMeta(repo, relFile, force) {
      return fetch(safeUrlPath(CA_BASE, relFile), { cache: force ? "no-cache" : "default" })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (html) {
          var doc = html ? new DOMParser().parseFromString(html, "text/html") : null;
          function m(name) {
            var el = doc ? doc.querySelector('meta[name="' + name + '"]') : null;
            return el ? el.getAttribute("content") : "";
          }
          var tEl = doc ? doc.querySelector("title") : null;
          var title = (m("ca:title") || m("mock:title") || (tEl ? tEl.textContent : "") || "")
            .replace(/\s+/g, " ")
            .replace(/\s*[—–-]\s*Kerala PSC\s*$/i, "")
            .trim();
          var updated = m("ca:updated") || m("mock:updated") || m("ca:date") || "";
          var monthHint = m("ca:month") || "";
          var done = function (finalDate) {
            return normalizeEntry({
              file: relFile,
              title: title || titleFromFilename(relFile),
              month: monthHint,
              updated: finalDate
            });
          };
          if (updated) return done(updated);
          return fetchGithubCommitDate(repo, relFile).then(done);
        })
        .catch(function () { return normalizeEntry({ file: relFile }); });
    }

    function supplementFromGitHub(localItems, force) {
      var repo = detectRepo();
      if (!repo) return;

      fetchGithubDir(repo, CA_FOLDER).then(function (rootEntries) {
        var relFiles = [];
        var hasMonthlyDir = false;

        rootEntries.forEach(function (f) {
          if (f.type === "dir" && f.name.toLowerCase() === "monthly") {
            hasMonthlyDir = true;
          } else if (
            f.type === "file" &&
            /\.html?$/i.test(f.name) &&
            f.name.toLowerCase() !== "index.html" &&
            !CA_FIXED.test(f.name)
          ) {
            relFiles.push(f.name);
          }
        });

        var subPromise = hasMonthlyDir
          ? fetchGithubDir(repo, CA_FOLDER + "/monthly").then(function (subEntries) {
              subEntries.forEach(function (f) {
                if (f.type === "file" && /\.html?$/i.test(f.name) && f.name.toLowerCase() !== "index.html") {
                  relFiles.push("monthly/" + f.name);
                }
              });
            })
          : Promise.resolve();

        return subPromise.then(function () {
          var known = {};
          localItems.forEach(function (p) { known[p.file] = 1; });
          var extra = relFiles.filter(function (rf) { return !known[rf]; });
          if (!extra.length) return;

          return Promise.all(extra.map(function (rf) {
            return readRemoteFileMeta(repo, rf, force);
          })).then(function (extraItems) {
            caState.items = localItems.concat(extraItems).sort(sortMonthly);
            renderMonthly();
          });
        });
      });
    }

    function loadMonthly(force) {
      caGrid.innerHTML = '<p class="empty">Loading month-wise files…</p>';
      loadManifestScript(force).then(function (rawList) {
        var normalized = rawList.map(normalizeEntry).sort(sortMonthly);
        caState.items = normalized;
        renderMonthly();
        supplementFromGitHub(normalized, force);
      });
    }

    if (caSearch) {
      caSearch.addEventListener("input", function (e) {
        caState.query = e.target.value;
        renderMonthly();
      });
    }
    if (caYears) {
      caYears.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-year]");
        if (!btn) return;
        caState.year = btn.getAttribute("data-year");
        renderMonthly();
      });
    }
    if (caRefBtn) {
      caRefBtn.addEventListener("click", function () { loadMonthly(true); });
    }

    loadMonthly(false);
  }

  /* ------------------------------------------------------------------
     1. SUBJECT PAGE — single chapter -> show topics directly
     ------------------------------------------------------------------ */
  function showTopicsDirectly() {
    var grid = document.getElementById("chapterGrid");
    if (!grid) return true;
    if (grid.querySelector(".empty")) return false;

    var slug = file.replace(/\.html$/i, "").replace(/^\d+-/, "");
    var subj = window.Syllabus && window.Syllabus.getSubject
      ? window.Syllabus.getSubject(slug)
      : null;
    if (!subj || !subj.chapters || subj.chapters.length !== 1) return true;

    var topics = (subj.chapters[0].topics || []).slice();
    if (!topics.length) return true;

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
      var mcqText = (t.qs || 0) + ' MCQs' + (rawDate ? ' · ' + esc(formatDisplayDate(rawDate)) : '');

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

    if (slug === "current-affairs") {
      initCurrentAffairsMonthly(grid);
    }

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