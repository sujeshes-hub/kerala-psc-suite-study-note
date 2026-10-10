/* =====================================================================
   Kerala PSC Study Suite — Progress Sync
   Path: assets/js/sync.js
   ---------------------------------------------------------------------
   Three tabs:
     • Export  — get a text code you can paste anywhere
     • Import  — paste a code from another device
     • Auto    — sync through your own private GitHub Gist (recommended)
   ===================================================================== */
(function () {
  "use strict";

  var PREFIX   = "KPS1.";
  var APP_ID   = "kerala-psc-suite";

  var TOKEN_KEY = "kpsc_gh_token";
  var GIST_KEY  = "kpsc_gh_gist_id";
  var LASTS_KEY = "kpsc_gh_last_sync";
  var PULLED_SS = "kpsc_pulled_this_session";
  var GIST_FILE = "kerala-psc-progress.json";

  var pushing = false;
  var pushTimer = null;
  var syncing = false;

  /* =================================================================
     PAYLOAD
     ================================================================= */
  function collectPayload() {
    var mock = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf("kpsc_mock_") === 0) {
        try { mock[k] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
      }
    }
    var summaries = {};
    try { summaries = JSON.parse(localStorage.getItem("kpsc_summaries_v1") || "{}"); } catch (e) {}
    return { v: 1, ts: Date.now(), app: APP_ID, mock: mock, summaries: summaries };
  }

  function encode(payload) {
    var utf8 = unescape(encodeURIComponent(JSON.stringify(payload)));
    return PREFIX + btoa(utf8);
  }

  function decode(code) {
    code = String(code || "").trim();
    if (!code) throw new Error("Empty code");
    if (code.indexOf(PREFIX) === 0) code = code.slice(PREFIX.length);
    var json;
    try { json = decodeURIComponent(escape(atob(code))); }
    catch (e) { throw new Error("Not a valid code"); }
    var obj;
    try { obj = JSON.parse(json); } catch (e) { throw new Error("Code contents are corrupt"); }
    if (!obj || obj.app !== APP_ID) throw new Error("This code is not from Kerala PSC Study Suite");
    return obj;
  }

  function applyPayload(payload) {
    var addedMock = 0, addedAnswers = 0;

    Object.keys(payload.mock || {}).forEach(function (k) {
      var remote = payload.mock[k] || {};
      var localRaw = localStorage.getItem(k);

      if (!localRaw) {
        localStorage.setItem(k, JSON.stringify(remote));
        addedMock++;
        addedAnswers += Object.keys(remote.answers || {}).length;
        return;
      }
      try {
        var local = JSON.parse(localRaw);
        var localN  = Object.keys(local.answers  || {}).length;
        var remoteN = Object.keys(remote.answers || {}).length;
        var base  = remoteN > localN ? remote : local;
        var other = remoteN > localN ? local  : remote;
        var mergedAnswers   = Object.assign({}, other.answers   || {}, base.answers   || {});
        var mergedBookmarks = Object.assign({}, other.bookmarks || {}, base.bookmarks || {});
        var mergedSettings  = Object.assign({}, other.settings  || {}, base.settings  || {});
        addedAnswers += Math.max(0, Object.keys(mergedAnswers).length - localN);
        localStorage.setItem(k, JSON.stringify({
          answers: mergedAnswers, bookmarks: mergedBookmarks, settings: mergedSettings
        }));
      } catch (e) {
        localStorage.setItem(k, JSON.stringify(remote));
      }
    });

    try {
      var localSum  = JSON.parse(localStorage.getItem("kpsc_summaries_v1") || "{}");
      var remoteSum = payload.summaries || {};
      Object.keys(remoteSum).forEach(function (k) {
        if (!localSum[k] || (remoteSum[k].attempted || 0) > (localSum[k].attempted || 0)) {
          localSum[k] = remoteSum[k];
        }
      });
      localStorage.setItem("kpsc_summaries_v1", JSON.stringify(localSum));
    } catch (e) {}

    return { addedMock: addedMock, addedAnswers: addedAnswers };
  }

  /* =================================================================
     GIST AUTO-SYNC
     ================================================================= */
  function getToken()   { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getGistId()  { return localStorage.getItem(GIST_KEY)  || ""; }
  function isConnected(){ return !!(getToken() && getGistId()); }

  function ghFetch(url, opts) {
    var token = getToken();
    opts = opts || {};
    opts.headers = Object.assign({
      "Authorization": "token " + token,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    }, opts.headers || {});
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var msg = "HTTP " + res.status;
          if (body && body.message) msg += " — " + body.message;
          throw new Error(msg);
        }
        return body;
      });
    });
  }

  function createGist(token) {
    var payload = collectPayload();
    return fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        "Authorization": "token " + token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        description: "Kerala PSC Study Suite — progress (auto-sync)",
        public: false,
        files: (function () {
          var o = {};
          o[GIST_FILE] = { content: JSON.stringify(payload) };
          return o;
        })()
      })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error((body && body.message) || ("HTTP " + res.status));
        return body;
      });
    });
  }

  function pullGist() {
    if (!isConnected()) return Promise.resolve(null);
    return ghFetch("https://api.github.com/gists/" + getGistId())
      .then(function (gist) {
        var file = gist.files && gist.files[GIST_FILE];
        if (!file || !file.content) return null;
        try { return JSON.parse(file.content); } catch (e) { return null; }
      });
  }

  function pushGist() {
    if (!isConnected() || pushing) return Promise.resolve(false);
    pushing = true;
    var payload = collectPayload();
    return ghFetch("https://api.github.com/gists/" + getGistId(), {
      method: "PATCH",
      body: JSON.stringify({
        files: (function () {
          var o = {};
          o[GIST_FILE] = { content: JSON.stringify(payload) };
          return o;
        })()
      })
    }).then(function () {
      localStorage.setItem(LASTS_KEY, String(Date.now()));
      updateStatusUI("ok", "Pushed " + new Date().toLocaleTimeString());
      pushing = false;
      return true;
    }).catch(function (err) {
      pushing = false;
      updateStatusUI("err", "Push failed: " + err.message);
      throw err;
    });
  }

  function schedulePush() {
    if (!isConnected()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushGist().catch(function (e) { console.warn("sync push:", e); });
    }, 2500);
  }

  function syncNow(silent) {
    if (!isConnected() || syncing) return Promise.resolve(null);
    syncing = true;
    if (!silent) updateStatusUI("wait", "Syncing…");

    return pullGist()
      .then(function (remote) {
        if (!remote) return { addedMock: 0, addedAnswers: 0 };
        return applyPayload(remote);
      })
      .then(function (added) {
        return pushGist().then(function () {
          syncing = false;
          if (!silent) updateStatusUI("ok", "Synced " + new Date().toLocaleTimeString());
          return added;
        });
      })
      .catch(function (err) {
        syncing = false;
        updateStatusUI("err", "Sync failed: " + err.message);
        throw err;
      });
  }

  /* Capture engine.js writes without modifying engine.js */
  (function interceptSetItem() {
    var orig = localStorage.setItem;
    localStorage.setItem = function (key, value) {
      orig.apply(localStorage, arguments);
      try {
        if (typeof key === "string" &&
            (key.indexOf("kpsc_mock_") === 0 || key === "kpsc_summaries_v1")) {
          schedulePush();
        }
      } catch (e) {}
    };
  })();

  /* One silent pull per browser session */
  function autoPullOnLoad() {
    if (!isConnected()) return;
    if (sessionStorage.getItem(PULLED_SS) === "1") return;
    sessionStorage.setItem(PULLED_SS, "1");

    pullGist()
      .then(function (remote) {
        if (!remote) return null;
        var added = applyPayload(remote);
        if (added.addedMock > 0 || added.addedAnswers > 0) {
          console.log("sync: pulled", added);
          setTimeout(function () { location.reload(); }, 120);
        }
      })
      .catch(function (e) { console.warn("sync auto-pull:", e); });
  }

  /* =================================================================
     UI — styles
     ================================================================= */
  var CSS =
    ".kpsc-sync-btn{position:fixed;bottom:18px;right:18px;z-index:9998;" +
      "padding:11px 18px;border-radius:999px;border:none;cursor:pointer;" +
      "background:linear-gradient(135deg,#0b5d63,#128a8f);color:#fff;" +
      "font-family:inherit;font-weight:800;font-size:.86rem;letter-spacing:.3px;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.28);transition:.15s;}" +
    ".kpsc-sync-btn:hover{transform:translateY(-2px);box-shadow:0 8px 26px rgba(0,0,0,.32);}" +
    ".kpsc-sync-btn:active{transform:scale(.96);}" +
    ".kpsc-sync-btn::after{content:'';position:absolute;top:6px;right:8px;" +
      "width:9px;height:9px;border-radius:50%;background:#f59e0b;" +
      "box-shadow:0 0 0 2px #0b5d63;display:none;}" +
    ".kpsc-sync-btn.connected::after{display:block;background:#3ddc97;}" +
    "@media print{.kpsc-sync-btn{display:none !important;}}" +

    ".kpsc-sync-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);" +
      "z-index:9999;display:none;align-items:center;justify-content:center;" +
      "padding:14px;backdrop-filter:blur(3px);}" +
    ".kpsc-sync-modal.open{display:flex;}" +

    ".kpsc-sync-card{background:#fff;color:#16223a;border-radius:16px;" +
      "padding:22px 20px 18px;max-width:560px;width:100%;max-height:92vh;" +
      "overflow:auto;position:relative;" +
      "font-family:'Segoe UI',system-ui,-apple-system,'Noto Sans Malayalam','Nirmala UI',sans-serif;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.4);}" +
    ".kpsc-sync-card h3{margin:0 0 4px;font-size:1.15rem;color:#0b5d63;}" +
    ".kpsc-sync-card .kpsc-sub{margin:0 0 14px;font-size:.8rem;color:#5b6b85;line-height:1.5;}" +

    ".kpsc-close{position:absolute;top:10px;right:12px;width:32px;height:32px;" +
      "border-radius:50%;border:1px solid #dde4ee;background:#f7fafc;" +
      "font-size:1.1rem;cursor:pointer;color:#5b6b85;font-family:inherit;}" +
    ".kpsc-close:hover{background:#eef2f7;}" +

    ".kpsc-tabs{display:flex;gap:6px;margin-bottom:14px;}" +
    ".kpsc-tabs button{flex:1;padding:9px 10px;border-radius:10px;" +
      "border:1px solid #dde4ee;background:#f7fafc;color:#5b6b85;" +
      "font-family:inherit;font-weight:700;font-size:.84rem;cursor:pointer;}" +
    ".kpsc-tabs button.active{background:#0b5d63;color:#fff;border-color:#0b5d63;}" +

    ".kpsc-panel.hidden{display:none;}" +
    ".kpsc-panel p{margin:.2rem 0 .6rem;font-size:.85rem;color:#5b6b85;line-height:1.55;}" +
    ".kpsc-panel h4{margin:14px 0 6px;font-size:.92rem;color:#0b5d63;}" +
    ".kpsc-panel label{display:block;font-size:.78rem;font-weight:700;" +
      "color:#5b6b85;margin:10px 0 4px;letter-spacing:.3px;text-transform:uppercase;}" +

    ".kpsc-code{width:100%;min-height:130px;padding:10px;" +
      "border:1px solid #dde4ee;border-radius:10px;" +
      "font-family:ui-monospace,'Consolas','Monaco',monospace;" +
      "font-size:.78rem;line-height:1.4;color:#16223a;background:#f8fafc;" +
      "resize:vertical;word-break:break-all;box-sizing:border-box;}" +

    ".kpsc-input{width:100%;padding:10px 12px;border:1px solid #dde4ee;" +
      "border-radius:10px;font-family:inherit;font-size:.88rem;" +
      "color:#16223a;background:#f8fafc;box-sizing:border-box;}" +
    ".kpsc-input:focus{outline:2px solid #128a8f;outline-offset:1px;background:#fff;}" +

    ".kpsc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}" +
    ".kpsc-actions button{flex:1 1 auto;padding:10px 14px;border-radius:10px;" +
      "border:1px solid #dde4ee;background:#f7fafc;color:#16223a;" +
      "font-family:inherit;font-weight:700;font-size:.85rem;cursor:pointer;" +
      "min-width:110px;}" +
    ".kpsc-actions button:hover{background:#eef2f7;}" +
    ".kpsc-actions button.primary{background:#0b5d63;color:#fff;border-color:#0b5d63;}" +
    ".kpsc-actions button.primary:hover{background:#0a4f54;}" +
    ".kpsc-actions button.danger{background:#fdecea;color:#c5221f;border-color:#f5c6c2;}" +

    ".kpsc-note{margin-top:12px;padding:10px 12px;border-radius:10px;" +
      "font-size:.82rem;line-height:1.55;background:#eefaf4;color:#0f7a4f;" +
      "border-left:4px solid #17a06a;}" +
    ".kpsc-note.err{background:#fdecea;color:#c5221f;border-left-color:#c5221f;}" +
    ".kpsc-note.warn{background:#fff6e5;color:#8a5300;border-left-color:#e0a100;}" +
    ".kpsc-note.info{background:#e6f6ff;color:#0b5a86;border-left-color:#0b8ac9;}" +
    ".kpsc-note b{display:block;margin-bottom:2px;}" +

    ".kpsc-status{margin:10px 0;padding:12px 14px;border-radius:10px;" +
      "font-size:.85rem;background:#f2f6fa;border:1px solid #dde4ee;" +
      "display:flex;flex-direction:column;gap:4px;}" +
    ".kpsc-status .row{display:flex;gap:8px;align-items:center;}" +
    ".kpsc-status .dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto;}" +
    ".kpsc-status .dot.ok{background:#17a06a;}" +
    ".kpsc-status .dot.wait{background:#f59e0b;animation:pulse 1s ease infinite;}" +
    ".kpsc-status .dot.err{background:#c5221f;}" +
    "@keyframes pulse{50%{opacity:.4;}}" +

    ".kpsc-steps{margin:6px 0 10px;padding-left:1.1rem;font-size:.82rem;color:#31445f;line-height:1.7;}" +
    ".kpsc-steps li{margin:.2rem 0;}" +
    ".kpsc-steps code{background:#eef2f7;padding:1px 5px;border-radius:4px;font-size:.78rem;}" +

    "@media (max-width:520px){" +
      ".kpsc-sync-btn{bottom:12px;right:12px;padding:10px 14px;font-size:.8rem;}" +
      ".kpsc-sync-card{padding:18px 14px 14px;}" +
    "}";

  function injectCSS() {
    if (document.getElementById("kpsc-sync-styles")) return;
    var s = document.createElement("style");
    s.id = "kpsc-sync-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* =================================================================
     UI — modal
     ================================================================= */
  function buildModal() {
    var m = document.createElement("div");
    m.className = "kpsc-sync-modal";
    m.id = "kpscSyncModal";
    m.setAttribute("aria-hidden", "true");
    m.innerHTML = [
      '<div class="kpsc-sync-card" role="dialog" aria-modal="true" aria-label="Save and load progress">',
      '  <button class="kpsc-close" type="button" aria-label="Close">&times;</button>',
      '  <h3>&#128190; Save / Load Progress</h3>',
      '  <p class="kpsc-sub">Keep your quiz progress in sync across phone and desktop.</p>',
      '  <div class="kpsc-tabs">',
      '    <button type="button" data-tab="auto" class="active">&#128260; Auto (Gist)</button>',
      '    <button type="button" data-tab="export">&#128228; Export code</button>',
      '    <button type="button" data-tab="import">&#128229; Import code</button>',
      '  </div>',

      /* ---- Auto tab ---- */
      '  <div class="kpsc-panel" data-panel="auto">',

      /* Connected view */
      '    <div id="kpscAutoConnected" style="display:none">',
      '      <div class="kpsc-status" id="kpscStatusBox">',
      '        <div class="row"><span class="dot ok" id="kpscDot"></span>',
      '          <b id="kpscStatusLine">Connected</b></div>',
      '        <div class="row" style="font-size:.78rem;color:#5b6b85">',
      '          <span>Gist: <code id="kpscGistLabel">—</code></span></div>',
      '        <div class="row" style="font-size:.78rem;color:#5b6b85">',
      '          <span>Last sync: <span id="kpscLastSync">never</span></span></div>',
      '      </div>',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscSyncNow">&#128260; Sync now</button>',
      '        <button type="button" id="kpscCopySetup">&#128203; Copy setup for other device</button>',
      '      </div>',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="danger" id="kpscDisconnect">Disconnect</button>',
      '      </div>',
      '      <div class="kpsc-note" id="kpscAutoNote" style="display:none"></div>',
      '    </div>',

      /* Not connected — setup form */
      '    <div id="kpscAutoSetup">',
      '      <p>Sync through your own private GitHub Gist. Free, secure, works everywhere.</p>',
      '      <h4>One-time setup</h4>',
      '      <ol class="kpsc-steps">',
      '        <li>Open <code>github.com/settings/tokens/new</code></li>',
      '        <li>Name it <b>Kerala PSC sync</b>, set expiration (90 days is fine)</li>',
      '        <li>Check the <b>gist</b> scope only (scroll down in the scope list)</li>',
      '        <li>Click <b>Generate token</b> and copy the value (starts with <code>ghp_</code>)</li>',
      '        <li>Paste it below and click <b>Connect</b></li>',
      '      </ol>',
      '      <label for="kpscTokenInput">Personal Access Token</label>',
      '      <input type="password" id="kpscTokenInput" class="kpsc-input" autocomplete="off" placeholder="ghp_…">',
      '      <label for="kpscGistInput">Gist ID (leave blank on first device)</label>',
      '      <input type="text" id="kpscGistInput" class="kpsc-input" autocomplete="off" placeholder="e.g. a1b2c3d4e5f6g7h8i9j0">',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscConnectBtn">Connect</button>',
      '      </div>',
      '      <div class="kpsc-note info">',
      '        <b>&#8505;&#65039; First device?</b>',
      '        Leave the Gist ID empty — one will be created automatically. ' +
      '        Then copy the Gist ID shown after connecting and use it on your other devices ' +
      '(with the same token).',
      '      </div>',
      '      <div class="kpsc-note" id="kpscSetupNote" style="display:none"></div>',
      '    </div>',
      '  </div>',

      /* ---- Export tab ---- */
      '  <div class="kpsc-panel hidden" data-panel="export">',
      '    <p>Copy this code and paste it into the Import tab on your other device.</p>',
      '    <textarea class="kpsc-code" id="kpscExportCode" readonly></textarea>',
      '    <div class="kpsc-actions">',
      '      <button type="button" id="kpscCopyBtn" class="primary">&#128203; Copy code</button>',
      '      <button type="button" id="kpscDownloadBtn">&#11015; Download .txt</button>',
      '    </div>',
      '    <div class="kpsc-note" id="kpscExportInfo"></div>',
      '  </div>',

      /* ---- Import tab ---- */
      '  <div class="kpsc-panel hidden" data-panel="import">',
      '    <p>Paste a code from another device. Existing answers are kept — nothing is lost.</p>',
      '    <textarea class="kpsc-code" id="kpscImportCode" placeholder="KPS1...." spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>',
      '    <div class="kpsc-actions">',
      '      <button type="button" id="kpscLoadBtn" class="primary">&#11014; Load &amp; merge</button>',
      '      <button type="button" id="kpscClearInput">Clear</button>',
      '    </div>',
      '    <div class="kpsc-note" id="kpscImportInfo" style="display:none"></div>',
      '  </div>',

      '</div>'
    ].join("\n");
    document.body.appendChild(m);
    return m;
  }

  /* =================================================================
     UI — actions
     ================================================================= */
  function $(id) { return document.getElementById(id); }

  function updateStatusUI(kind, message) {
    var dot = $("kpscDot");
    if (!dot) return;
    dot.className = "dot " + (kind || "");
    if (message) $("kpscStatusLine").textContent = message;
    var ls = $("kpscLastSync");
    if (ls) {
      var t = localStorage.getItem(LASTS_KEY);
      ls.textContent = t ? new Date(Number(t)).toLocaleString() : "never";
    }
  }

  function updateConnectedUI() {
    var conn = $("kpscAutoConnected");
    var setup = $("kpscAutoSetup");
    if (!conn || !setup) return;
    if (isConnected()) {
      conn.style.display = "";
      setup.style.display = "none";
      $("kpscGistLabel").textContent = getGistId().slice(0, 12) + "…";
      var btn = document.querySelector(".kpsc-sync-btn");
      if (btn) btn.classList.add("connected");
      updateStatusUI("ok", "Connected");
    } else {
      conn.style.display = "none";
      setup.style.display = "";
      var b = document.querySelector(".kpsc-sync-btn");
      if (b) b.classList.remove("connected");
    }
  }

  function flashNote(elId, kind, title, body) {
    var el = $(elId);
    if (!el) return;
    el.style.display = "block";
    el.className = "kpsc-note " + (kind || "");
    el.innerHTML = "<b>" + title + "</b>" + (body || "");
  }

  function doConnect() {
    var token = ($("kpscTokenInput").value || "").trim();
    var gistId = ($("kpscGistInput").value || "").trim();

    if (!token || token.indexOf("ghp_") !== 0 && token.indexOf("github_pat_") !== 0) {
      flashNote("kpscSetupNote", "err", "Invalid token",
        "A GitHub Personal Access Token starts with ghp_ or github_pat_.");
      return;
    }

    flashNote("kpscSetupNote", "info", "Connecting…", "Verifying with GitHub.");

    if (gistId) {
      /* Existing gist — store, then verify by reading it */
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(GIST_KEY, gistId);
      pullGist()
        .then(function (remote) {
          if (remote) {
            var added = applyPayload(remote);
            flashNote("kpscSetupNote", "", "Connected",
              "Pulled existing progress. Reloading…");
            setTimeout(function () { location.reload(); }, 1200);
          } else {
            flashNote("kpscSetupNote", "warn", "Connected, but Gist looks empty",
              "No progress file found in that Gist. It will be created on your next answer.");
            updateConnectedUI();
            pushGist().catch(function () {});
          }
        })
        .catch(function (err) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(GIST_KEY);
          flashNote("kpscSetupNote", "err", "Connection failed", err.message);
        });
    } else {
      /* No gist — create one */
      createGist(token)
        .then(function (gist) {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(GIST_KEY, gist.id);
          flashNote("kpscSetupNote", "", "Connected",
            "New Gist created. On your other devices, paste your token and this Gist ID: <code>" +
            gist.id + "</code>");
          updateConnectedUI();
        })
        .catch(function (err) {
          flashNote("kpscSetupNote", "err", "Could not create Gist", err.message);
        });
    }
  }

  function doDisconnect() {
    if (!confirm("Disconnect from GitHub Gist? Your local progress is kept.")) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    localStorage.removeItem(LASTS_KEY);
    sessionStorage.removeItem(PULLED_SS);
    updateConnectedUI();
    flashNote("kpscSetupNote", "warn", "Disconnected",
      "Your progress on this device is untouched. You can reconnect anytime.");
  }

  function doSyncNow() {
    syncNow(false)
      .then(function (added) {
        if (added && (added.addedMock || added.addedAnswers)) {
          flashNote("kpscAutoNote", "", "Merged new progress",
            added.addedMock + " paper(s), " + added.addedAnswers + " answer(s). Reloading…");
          setTimeout(function () { location.reload(); }, 1200);
        } else {
          flashNote("kpscAutoNote", "", "Up to date",
            "Everything is synced.");
        }
      })
      .catch(function (err) {
        flashNote("kpscAutoNote", "err", "Sync failed", err.message);
      });
  }

  function doCopySetup() {
    var text = "Kerala PSC Study Suite — sync setup\n\n" +
               "Token: " + getToken() + "\n" +
               "Gist ID: " + getGistId() + "\n\n" +
               "On your other device: open the site → tap 💾 Sync → Auto tab → paste token + Gist ID → Connect.";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        flashNote("kpscAutoNote", "", "Copied",
          "Paste this into WhatsApp, email or Notes to set up your other device.");
      }).catch(function () {
        prompt("Copy this manually:", text);
      });
    } else {
      prompt("Copy this manually:", text);
    }
  }

  /* =================================================================
     UI — bind
     ================================================================= */
  function openModal() {
    var m = $("kpscSyncModal") || buildModal();
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    refreshExport();
    updateConnectedUI();
    var ls = $("kpscLastSync");
    if (ls) {
      var t = localStorage.getItem(LASTS_KEY);
      ls.textContent = t ? new Date(Number(t)).toLocaleString() : "never";
    }
  }
  function closeModal() {
    var m = $("kpscSyncModal");
    if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }
  }

  function refreshExport() {
    var ta = $("kpscExportCode");
    var info = $("kpscExportInfo");
    try {
      var payload = collectPayload();
      var code = encode(payload);
      ta.value = code;
      var answers = 0;
      Object.keys(payload.mock).forEach(function (k) {
        answers += Object.keys(payload.mock[k].answers || {}).length;
      });
      info.className = "kpsc-note";
      info.innerHTML = "<b>&#10003; Ready</b>Contains " +
        Object.keys(payload.mock).length + " paper(s), " +
        answers + " answer(s), " + code.length + " characters.";
    } catch (e) {
      ta.value = "";
      info.className = "kpsc-note err";
      info.innerHTML = "<b>Export failed</b>" + (e.message || e);
    }
  }

  function copyCode() {
    var ta = $("kpscExportCode");
    if (!ta.value) return;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    if (ok || navigator.clipboard) {
      if (!ok && navigator.clipboard) {
        navigator.clipboard.writeText(ta.value);
      }
      var info = $("kpscExportInfo");
      var prev = info.innerHTML;
      info.innerHTML = "<b>&#128203; Copied</b>";
      setTimeout(function () { info.innerHTML = prev; }, 1500);
    }
  }

  function downloadCode() {
    var ta = $("kpscExportCode");
    if (!ta.value) return;
    var blob = new Blob([ta.value], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    var a = document.createElement("a");
    a.href = url;
    a.download = "kerala-psc-progress-" + stamp + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadCode() {
    var ta = $("kpscImportCode");
    var info = $("kpscImportInfo");
    info.style.display = "block";
    var raw = (ta.value || "").trim();
    if (!raw) {
      info.className = "kpsc-note warn";
      info.innerHTML = "<b>Empty</b>Paste a code first.";
      return;
    }
    try {
      var payload = decode(raw);
      var res = applyPayload(payload);
      info.className = "kpsc-note";
      info.innerHTML = "<b>&#10003; Loaded</b>Merged " +
        res.addedMock + " paper(s), " + res.addedAnswers + " answer(s). Reloading…";
      setTimeout(function () { location.reload(); }, 1400);
    } catch (e) {
      info.className = "kpsc-note err";
      info.innerHTML = "<b>Invalid code</b>" + (e.message || e);
    }
  }

  function bindEvents() {
    var m = $("kpscSyncModal");
    if (!m || m.dataset.bound) return;
    m.dataset.bound = "1";

    m.querySelector(".kpsc-close").addEventListener("click", closeModal);
    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });

    m.querySelectorAll(".kpsc-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        m.querySelectorAll(".kpsc-tabs button").forEach(function (x) {
          x.classList.toggle("active", x === b);
        });
        m.querySelectorAll(".kpsc-panel").forEach(function (p) {
          p.classList.toggle("hidden", p.dataset.panel !== b.dataset.tab);
        });
      });
    });

    $("kpscConnectBtn").addEventListener("click", doConnect);
    $("kpscDisconnect").addEventListener("click", doDisconnect);
    $("kpscSyncNow").addEventListener("click", doSyncNow);
    $("kpscCopySetup").addEventListener("click", doCopySetup);

    $("kpscCopyBtn").addEventListener("click", copyCode);
    $("kpscDownloadBtn").addEventListener("click", downloadCode);

    $("kpscLoadBtn").addEventListener("click", loadCode);
    $("kpscClearInput").addEventListener("click", function () {
      $("kpscImportCode").value = "";
      var i = $("kpscImportInfo");
      i.style.display = "none";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function injectButton() {
    if (document.querySelector(".kpsc-sync-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kpsc-sync-btn";
    btn.setAttribute("aria-label", "Save or load progress");
    btn.innerHTML = "&#128190; Sync";
    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
    if (isConnected()) btn.classList.add("connected");
  }

  /* =================================================================
     INIT
     ================================================================= */
  function init() {
    injectCSS();
    injectButton();
    buildModal();
    bindEvents();
    updateConnectedUI();
    autoPullOnLoad();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.KPSC_Sync = {
    export:      function () { return encode(collectPayload()); },
    import:      function (code) { return applyPayload(decode(code)); },
    open:        openModal,
    isConnected: isConnected,
    syncNow:     function () { return syncNow(true); },
    push:        pushGist
  };
})();