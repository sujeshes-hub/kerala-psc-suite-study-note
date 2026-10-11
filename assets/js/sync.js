/* =====================================================================
   Kerala PSC Study Suite — Progress Sync + Login (site-wide auto-save)
   Path: assets/js/sync.js
   Version: 3

   Auto-saves whenever ANY part of the site writes to localStorage
   (kpsc_mock_* or kpsc_summaries_v1). Syncs to:
     • Firebase Firestore  — when signed in with Google / email
     • GitHub Gist         — when connected via token
   Fallback: Export / Import code.

   Loaded site-wide by a small loader appended to sections.js and engine.js.
   ===================================================================== */
(function () {
  "use strict";

  if (window.KPSC_Sync && window.KPSC_Sync.__version === 3) return;

  /* =================================================================
     FIREBASE CONFIG — already filled in for kerala-psc-suite
     ================================================================= */
  var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAG6V1Iqcve3I7pEbj5VWsFNidiDVsymaA",
    authDomain:        "kerala-psc-suite.firebaseapp.com",
    projectId:         "kerala-psc-suite",
    storageBucket:     "kerala-psc-suite.firebasestorage.app",
    messagingSenderId: "53850748882",
    appId:             "1:53850748882:web:2c5002a9b4a4491a663a0b"
  };

  var ENABLE_FIREBASE = FIREBASE_CONFIG.apiKey &&
                        FIREBASE_CONFIG.apiKey.indexOf("PASTE_") !== 0;

  /* ---------- storage keys ---------- */
  var PREFIX        = "KPS1.";
  var APP_ID        = "kerala-psc-suite";

  var TOKEN_KEY     = "kpsc_gh_token";
  var GIST_KEY      = "kpsc_gh_gist_id";
  var LASTS_KEY     = "kpsc_last_sync";
  var PULLED_SS     = "kpsc_pulled_this_session";

  var GIST_FILE     = "kerala-psc-progress.json";
  var FIRESTORE_COL = "users";

  /* ---------- timing ---------- */
  var SAVE_DEBOUNCE = 900;   /* ms after last write before we push */

  /* ---------- runtime state ---------- */
  var firebaseApp   = null;
  var firebaseAuth  = null;
  var firestoreDb   = null;
  var firebaseReady = false;
  var currentUser   = null;

  var pushing   = false;
  var pushTimer = null;
  var syncing   = false;
  var fbSDKPromise = null;

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
    if (!obj || obj.app !== APP_ID) throw new Error("Not a Kerala PSC code");
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
        var local   = JSON.parse(localRaw);
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
     FIREBASE
     ================================================================= */
  function loadFirebaseSDK() {
    if (fbSDKPromise) return fbSDKPromise;
    if (!ENABLE_FIREBASE) return Promise.reject(new Error("Firebase not configured"));

    fbSDKPromise = new Promise(function (resolve, reject) {
      var base = "https://www.gstatic.com/firebasejs/10.12.0/";
      var files = [
        "firebase-app-compat.js",
        "firebase-auth-compat.js",
        "firebase-firestore-compat.js"
      ];
      var loaded = 0;

      files.forEach(function (f) {
        var s = document.createElement("script");
        s.src = base + f;
        s.onload = function () {
          loaded++;
          if (loaded === files.length) resolve();
        };
        s.onerror = function () { reject(new Error("Could not load Firebase SDK")); };
        document.head.appendChild(s);
      });
    }).then(function () {
      if (!window.firebase) throw new Error("firebase global missing");
      firebaseApp  = window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseAuth = window.firebase.auth();
      firestoreDb  = window.firebase.firestore();
      firebaseReady = true;
      return new Promise(function (resolve) {
        firebaseAuth.onAuthStateChanged(function (user) {
          currentUser = user;
          updateAccountUI();
          resolve(user);
        });
      });
    });

    return fbSDKPromise;
  }

  function firebasePull() {
    if (!firebaseReady || !currentUser) return Promise.resolve(null);
    return firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid).get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return doc.data() || null;
      });
  }

  function firebasePush() {
    if (!firebaseReady || !currentUser || pushing) return Promise.resolve(false);
    pushing = true;
    var payload = collectPayload();
    payload.uid     = currentUser.uid;
    payload.email   = currentUser.email || "";
    payload.updated = window.firebase.firestore.FieldValue.serverTimestamp();

    return firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid).set(payload)
      .then(function () {
        localStorage.setItem(LASTS_KEY, String(Date.now()));
        updateStatusUI("ok", "Saved " + new Date().toLocaleTimeString());
        pushing = false;
        return true;
      })
      .catch(function (err) {
        pushing = false;
        updateStatusUI("err", "Save failed: " + (err.message || err));
        throw err;
      });
  }

  function fbSyncNow() {
    if (!firebaseReady || !currentUser || syncing) return Promise.resolve(null);
    syncing = true;
    updateStatusUI("wait", "Syncing…");
    return firebasePull()
      .then(function (remote) {
        if (!remote) return { addedMock: 0, addedAnswers: 0 };
        return applyPayload(remote);
      })
      .then(function (added) {
        return firebasePush().then(function () {
          syncing = false;
          updateStatusUI("ok", "Synced " + new Date().toLocaleTimeString());
          return added;
        });
      })
      .catch(function (err) {
        syncing = false;
        updateStatusUI("err", "Sync failed: " + (err.message || err));
        throw err;
      });
  }

  function signInGoogle() {
    if (!firebaseReady) return Promise.reject(new Error("Not ready"));
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return firebaseAuth.signInWithPopup(provider);
  }

  function signInEmail(email, password) {
    if (!firebaseReady) return Promise.reject(new Error("Not ready"));
    return firebaseAuth.signInWithEmailAndPassword(email, password);
  }

  function signUpEmail(email, password) {
    if (!firebaseReady) return Promise.reject(new Error("Not ready"));
    return firebaseAuth.createUserWithEmailAndPassword(email, password);
  }

  function signOut() {
    if (!firebaseReady) return Promise.resolve();
    return firebaseAuth.signOut();
  }

  /* =================================================================
     GIST FALLBACK
     ================================================================= */
  function getToken()   { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getGistId()  { return localStorage.getItem(GIST_KEY)  || ""; }
  function isGistConnected() { return !!(getToken() && getGistId()); }

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
        description: "Kerala PSC Study Suite — progress",
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
    if (!isGistConnected()) return Promise.resolve(null);
    return ghFetch("https://api.github.com/gists/" + getGistId())
      .then(function (gist) {
        var file = gist.files && gist.files[GIST_FILE];
        if (!file || !file.content) return null;
        try { return JSON.parse(file.content); } catch (e) { return null; }
      });
  }

  function pushGist() {
    if (!isGistConnected() || pushing) return Promise.resolve(false);
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

  /* =================================================================
     AUTO-SYNC
     ================================================================= */
  function pushNow() {
    if (currentUser) return firebasePush();
    if (isGistConnected()) return pushGist();
    return Promise.resolve(false);
  }

  function schedulePush() {
    if (!currentUser && !isGistConnected()) return;
    clearTimeout(pushTimer);
    updateStatusUI("wait", "Saving…");
    pushTimer = setTimeout(function () {
      pushNow().catch(function (e) { console.warn("auto-push:", e); });
    }, SAVE_DEBOUNCE);
  }

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

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(pushTimer);
      pushNow().catch(function () {});
    }
  });
  window.addEventListener("pagehide", function () {
    clearTimeout(pushTimer);
    pushNow().catch(function () {});
  });

  function autoPullOnLoad() {
    if (sessionStorage.getItem(PULLED_SS) === "1") return;

    var doPull = null;
    if (firebaseReady && currentUser) {
      doPull = firebasePull();
    } else if (isGistConnected()) {
      doPull = pullGist();
    } else {
      return;
    }

    sessionStorage.setItem(PULLED_SS, "1");
    doPull
      .then(function (remote) {
        if (!remote) return null;
        var added = applyPayload(remote);
        if (added.addedMock > 0 || added.addedAnswers > 0) {
          setTimeout(function () { location.reload(); }, 150);
        }
      })
      .catch(function (e) { console.warn("auto-pull:", e); });
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
    ".kpsc-sync-btn:hover{transform:translateY(-2px);}" +
    ".kpsc-sync-btn:active{transform:scale(.96);}" +
    ".kpsc-sync-btn::after{content:'';position:absolute;top:6px;right:8px;" +
      "width:9px;height:9px;border-radius:50%;background:#94a3b8;" +
      "box-shadow:0 0 0 2px #0b5d63;}" +
    ".kpsc-sync-btn.connected::after{background:#3ddc97;}" +
    ".kpsc-sync-btn.error::after{background:#ef4444;}" +
    ".kpsc-sync-btn.saving::after{background:#f59e0b;animation:pulse 1s ease infinite;}" +
    "@keyframes pulse{50%{opacity:.4;}}" +
    "@media print{.kpsc-sync-btn{display:none !important;}}" +

    ".kpsc-sync-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);" +
      "z-index:9999;display:none;align-items:center;justify-content:center;" +
      "padding:14px;backdrop-filter:blur(3px);}" +
    ".kpsc-sync-modal.open{display:flex;}" +
    ".kpsc-sync-card{background:#fff;color:#16223a;border-radius:16px;" +
      "padding:22px 20px 18px;max-width:580px;width:100%;max-height:92vh;" +
      "overflow:auto;position:relative;" +
      "font-family:'Segoe UI',system-ui,-apple-system,'Noto Sans Malayalam','Nirmala UI',sans-serif;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.4);}" +
    ".kpsc-sync-card h3{margin:0 0 4px;font-size:1.15rem;color:#0b5d63;}" +
    ".kpsc-sync-card .kpsc-sub{margin:0 0 14px;font-size:.8rem;color:#5b6b85;line-height:1.5;}" +

    ".kpsc-close{position:absolute;top:10px;right:12px;width:32px;height:32px;" +
      "border-radius:50%;border:1px solid #dde4ee;background:#f7fafc;" +
      "font-size:1.1rem;cursor:pointer;color:#5b6b85;font-family:inherit;}" +
    ".kpsc-close:hover{background:#eef2f7;}" +

    ".kpsc-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}" +
    ".kpsc-tabs button{flex:1 1 auto;min-width:calc(50% - 6px);padding:9px 10px;" +
      "border-radius:10px;border:1px solid #dde4ee;background:#f7fafc;color:#5b6b85;" +
      "font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer;}" +
    ".kpsc-tabs button.active{background:#0b5d63;color:#fff;border-color:#0b5d63;}" +
    ".kpsc-panel.hidden{display:none;}" +
    ".kpsc-panel p{margin:.2rem 0 .7rem;font-size:.85rem;color:#5b6b85;line-height:1.55;}" +

    ".kpsc-input{width:100%;padding:10px 12px;border:1px solid #dde4ee;" +
      "border-radius:10px;font-family:inherit;font-size:.88rem;color:#16223a;" +
      "background:#f8fafc;box-sizing:border-box;margin-bottom:8px;}" +
    ".kpsc-input:focus{outline:2px solid #128a8f;background:#fff;}" +

    ".kpsc-code{width:100%;min-height:120px;padding:10px;" +
      "border:1px solid #dde4ee;border-radius:10px;" +
      "font-family:ui-monospace,'Consolas',monospace;font-size:.78rem;" +
      "line-height:1.4;color:#16223a;background:#f8fafc;" +
      "resize:vertical;word-break:break-all;box-sizing:border-box;}" +

    ".kpsc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}" +
    ".kpsc-actions button{flex:1 1 auto;padding:10px 14px;border-radius:10px;" +
      "border:1px solid #dde4ee;background:#f7fafc;color:#16223a;" +
      "font-family:inherit;font-weight:700;font-size:.85rem;cursor:pointer;" +
      "min-width:110px;}" +
    ".kpsc-actions button:hover{background:#eef2f7;}" +
    ".kpsc-actions button.primary{background:#0b5d63;color:#fff;border-color:#0b5d63;}" +
    ".kpsc-actions button.primary:hover{background:#0a4f54;}" +
    ".kpsc-actions button.danger{background:#fdecea;color:#c5221f;border-color:#f5c6c2;}" +

    ".kpsc-google{display:flex;align-items:center;justify-content:center;gap:10px;" +
      "width:100%;padding:12px 16px;border-radius:10px;border:1px solid #dde4ee;" +
      "background:#fff;color:#16223a;font-family:inherit;font-weight:700;" +
      "font-size:.9rem;cursor:pointer;transition:.15s;margin-bottom:10px;}" +
    ".kpsc-google:hover{background:#f7fafc;box-shadow:0 2px 10px rgba(0,0,0,.08);}" +
    ".kpsc-google svg{width:18px;height:18px;}" +

    ".kpsc-userbox{padding:14px;border-radius:12px;background:#eefaf4;" +
      "border:1px solid #a8e0c0;display:flex;gap:12px;align-items:center;" +
      "margin-bottom:12px;}" +
    ".kpsc-userbox img{width:44px;height:44px;border-radius:50%;border:2px solid #fff;}" +
    ".kpsc-userbox .info{flex:1;min-width:0;}" +
    ".kpsc-userbox .name{font-weight:800;font-size:.95rem;color:#0f7a4f;}" +
    ".kpsc-userbox .email{font-size:.78rem;color:#5b6b85;word-break:break-all;}" +

    ".kpsc-note{margin-top:12px;padding:10px 12px;border-radius:10px;" +
      "font-size:.82rem;line-height:1.55;background:#eefaf4;color:#0f7a4f;" +
      "border-left:4px solid #17a06a;}" +
    ".kpsc-note.err{background:#fdecea;color:#c5221f;border-left-color:#c5221f;}" +
    ".kpsc-note.warn{background:#fff6e5;color:#8a5300;border-left-color:#e0a100;}" +
    ".kpsc-note.info{background:#e6f6ff;color:#0b5a86;border-left-color:#0b8ac9;}" +
    ".kpsc-note b{display:block;margin-bottom:3px;}" +

    ".kpsc-status{margin:10px 0;padding:12px 14px;border-radius:10px;" +
      "font-size:.82rem;background:#f2f6fa;border:1px solid #dde4ee;" +
      "display:flex;flex-direction:column;gap:4px;}" +
    ".kpsc-status .row{display:flex;gap:8px;align-items:center;}" +
    ".kpsc-status .dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto;}" +
    ".kpsc-status .dot.ok{background:#17a06a;}" +
    ".kpsc-status .dot.wait{background:#f59e0b;animation:pulse 1s ease infinite;}" +
    ".kpsc-status .dot.err{background:#c5221f;}" +

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
      '<div class="kpsc-sync-card" role="dialog" aria-modal="true">',
      '  <button class="kpsc-close" type="button" aria-label="Close">&times;</button>',
      '  <h3>&#128190; Save / Load Progress</h3>',
      '  <p class="kpsc-sub">Sign in to keep your progress across phone and desktop automatically.</p>',
      '  <div class="kpsc-tabs">',
      '    <button type="button" data-tab="account" class="active">&#128100; Account</button>',
      '    <button type="button" data-tab="export">&#128228; Export</button>',
      '    <button type="button" data-tab="import">&#128229; Import</button>',
      '    <button type="button" data-tab="gist">&#128260; Gist</button>',
      '  </div>',

      '  <div class="kpsc-panel" data-panel="account">',
      '    <div id="kpscLoggedIn" style="display:none">',
      '      <div class="kpsc-userbox">',
      '        <img id="kpscAvatar" src="" alt="">',
      '        <div class="info">',
      '          <div class="name" id="kpscDisplayName">&nbsp;</div>',
      '          <div class="email" id="kpscUserEmail">&nbsp;</div>',
      '        </div>',
      '      </div>',
      '      <div class="kpsc-status">',
      '        <div class="row"><span class="dot ok" id="kpscDot"></span>',
      '          <b id="kpscStatusLine">Signed in</b></div>',
      '        <div class="row" style="color:#5b6b85">',
      '          <span>Last save: <span id="kpscLastSync">never</span></span></div>',
      '      </div>',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscSyncNow">&#128260; Sync now</button>',
      '      </div>',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="danger" id="kpscSignOut">Sign out</button>',
      '      </div>',
      '      <div class="kpsc-note" id="kpscAccountNote" style="display:none"></div>',
      '      <div class="kpsc-note info">',
      '        <b>&#8505;&#65039; Auto-save is on.</b>',
      '        Every answer you give is saved to the cloud within a second.',
      '      </div>',
      '    </div>',
      '    <div id="kpscLoggedOut">',
      '      <div class="kpsc-note info" id="kpscNotConfiguredNote" style="display:none">',
      '        <b>&#9888;&#65039; Login is not configured yet.</b>',
      '        Add your Firebase config to <code>sync.js</code>.',
      '      </div>',
      '      <button type="button" class="kpsc-google" id="kpscGoogleBtn">',
      '        <svg viewBox="0 0 48 48" aria-hidden="true">',
      '          <path fill="#4285F4" d="M44.5 20H24v8.5h11.8c-.5 2.9-2 5.4-4.4 7v5.8h7.1c4.1-3.8 6.5-9.4 6.5-16z"/>',
      '          <path fill="#34A853" d="M24 44c5.9 0 10.9-1.9 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.4v5.7C8 38.5 15.5 44 24 44z"/>',
      '          <path fill="#FBBC05" d="M11.8 26.3c-.5-1.4-.7-2.9-.7-4.3s.3-2.9.7-4.3v-5.7H4.4C2.9 14.9 2 18.3 2 22s.9 7.1 2.4 10l7.4-5.7z"/>',
      '          <path fill="#EA4335" d="M24 10.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4 29.9 2 24 2 15.5 2 8 7.5 4.4 15.1l7.4 5.7C13.5 15 18.3 10.5 24 10.5z"/>',
      '        </svg>',
      '        Continue with Google',
      '      </button>',
      '      <div style="text-align:center;font-size:.78rem;color:#5b6b85;margin:6px 0">or</div>',
      '      <input type="email" id="kpscEmail" class="kpsc-input" placeholder="Email" autocomplete="email">',
      '      <input type="password" id="kpscPassword" class="kpsc-input" placeholder="Password (min 6 characters)" autocomplete="current-password">',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscSignInBtn">Sign in</button>',
      '        <button type="button" id="kpscSignUpBtn">Create account</button>',
      '      </div>',
      '      <div class="kpsc-note" id="kpscAuthNote" style="display:none"></div>',
      '      <div class="kpsc-note info" style="margin-top:14px">',
      '        <b>&#8505;&#65039; What gets saved?</b>',
      '        Your answers, bookmarks and scores. Nothing personal.',
      '      </div>',
      '    </div>',
      '  </div>',

      '  <div class="kpsc-panel hidden" data-panel="export">',
      '    <p>Copy this code and paste into the Import tab on another device.</p>',
      '    <textarea class="kpsc-code" id="kpscExportCode" readonly></textarea>',
      '    <div class="kpsc-actions">',
      '      <button type="button" id="kpscCopyBtn" class="primary">&#128203; Copy</button>',
      '      <button type="button" id="kpscDownloadBtn">&#11015; Download</button>',
      '    </div>',
      '    <div class="kpsc-note" id="kpscExportInfo"></div>',
      '  </div>',

      '  <div class="kpsc-panel hidden" data-panel="import">',
      '    <p>Paste a code from another device. Existing answers are kept.</p>',
      '    <textarea class="kpsc-code" id="kpscImportCode" placeholder="KPS1...." spellcheck="false"></textarea>',
      '    <div class="kpsc-actions">',
      '      <button type="button" class="primary" id="kpscLoadBtn">&#11014; Load &amp; merge</button>',
      '      <button type="button" id="kpscClearInput">Clear</button>',
      '    </div>',
      '    <div class="kpsc-note" id="kpscImportInfo" style="display:none"></div>',
      '  </div>',

      '  <div class="kpsc-panel hidden" data-panel="gist">',
      '    <p>Advanced: sync through your own private GitHub Gist.</p>',
      '    <div id="kpscGistConnected" style="display:none">',
      '      <div class="kpsc-status">',
      '        <div class="row"><span class="dot ok"></span><b>Gist connected</b></div>',
      '        <div class="row" style="color:#5b6b85">',
      '          <span>Gist: <code id="kpscGistLabel">—</code></span></div>',
      '      </div>',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscGistSyncNow">&#128260; Sync now</button>',
      '        <button type="button" class="danger" id="kpscGistDisconnect">Disconnect</button>',
      '      </div>',
      '    </div>',
      '    <div id="kpscGistSetup">',
      '      <p>Create a token at <code>github.com/settings/tokens/new</code> with <b>gist</b> scope.</p>',
      '      <input type="password" id="kpscTokenInput" class="kpsc-input" placeholder="ghp_…">',
      '      <input type="text" id="kpscGistInput" class="kpsc-input" placeholder="Gist ID (blank to create new)">',
      '      <div class="kpsc-actions">',
      '        <button type="button" class="primary" id="kpscConnectBtn">Connect</button>',
      '      </div>',
      '      <div class="kpsc-note" id="kpscSetupNote" style="display:none"></div>',
      '    </div>',
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
  function qs(sel) { return document.querySelector(sel); }

  function updateStatusUI(kind, message) {
    var dot = $("kpscDot");
    if (dot) dot.className = "dot " + (kind || "");
    if (message) {
      var s = $("kpscStatusLine");
      if (s) s.textContent = message;
    }
    var ls = $("kpscLastSync");
    if (ls) {
      var t = localStorage.getItem(LASTS_KEY);
      ls.textContent = t ? new Date(Number(t)).toLocaleString() : "never";
    }
    var btn = qs(".kpsc-sync-btn");
    if (btn) {
      btn.classList.remove("connected", "error", "saving");
      if (kind === "wait")      btn.classList.add("saving");
      else if (kind === "err")  btn.classList.add("error");
      else if (kind === "ok")   btn.classList.add("connected");
    }
  }

  function updateAccountUI() {
    if (!ENABLE_FIREBASE) {
      var note = $("kpscNotConfiguredNote");
      if (note) note.style.display = "block";
      if ($("kpscGoogleBtn")) $("kpscGoogleBtn").style.display = "none";
    }

    if (currentUser) {
      if ($("kpscLoggedIn"))  $("kpscLoggedIn").style.display  = "";
      if ($("kpscLoggedOut")) $("kpscLoggedOut").style.display = "none";
      if ($("kpscDisplayName")) $("kpscDisplayName").textContent = currentUser.displayName || currentUser.email || "User";
      if ($("kpscUserEmail"))   $("kpscUserEmail").textContent   = currentUser.email || "";
      var av = $("kpscAvatar");
      if (av) av.src = currentUser.photoURL ||
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='%230b5d63'/></svg>";
      var btn = qs(".kpsc-sync-btn");
      if (btn) btn.classList.add("connected");
      var ls = $("kpscLastSync");
      if (ls) {
        var t = localStorage.getItem(LASTS_KEY);
        ls.textContent = t ? new Date(Number(t)).toLocaleString() : "never";
      }
    } else {
      if ($("kpscLoggedIn"))  $("kpscLoggedIn").style.display  = "none";
      if ($("kpscLoggedOut")) $("kpscLoggedOut").style.display = "";
    }

    var gc = $("kpscGistConnected");
    var gs = $("kpscGistSetup");
    if (gc && gs) {
      if (isGistConnected()) {
        gc.style.display = "";
        gs.style.display = "none";
        var lbl = $("kpscGistLabel");
        if (lbl) lbl.textContent = getGistId().slice(0, 12) + "…";
      } else {
        gc.style.display = "none";
        gs.style.display = "";
      }
    }
  }

  function flash(elId, kind, title, body) {
    var el = $(elId);
    if (!el) return;
    el.style.display = "block";
    el.className = "kpsc-note " + (kind || "");
    el.innerHTML = "<b>" + title + "</b>" + (body || "");
  }

  function doGoogle() {
    flash("kpscAuthNote", "info", "Signing in…", "Check the popup window.");
    loadFirebaseSDK()
      .then(function () { return signInGoogle(); })
      .then(function () {
        flash("kpscAuthNote", "", "Signed in", "Syncing your progress…");
        return firebasePull();
      })
      .then(function (remote) {
        if (remote) {
          var added = applyPayload(remote);
          if (added.addedMock || added.addedAnswers) {
            setTimeout(function () { location.reload(); }, 800);
          }
        } else {
          return firebasePush();
        }
      })
      .catch(function (err) {
        flash("kpscAuthNote", "err", "Sign-in failed", err.message || err);
      });
  }

  function doEmailSignIn() {
    var email = ($("kpscEmail").value || "").trim();
    var pass  = ($("kpscPassword").value || "").trim();
    if (!email || !pass) {
      flash("kpscAuthNote", "err", "Missing info", "Enter email and password.");
      return;
    }
    loadFirebaseSDK()
      .then(function () { return signInEmail(email, pass); })
      .then(function () {
        flash("kpscAuthNote", "", "Signed in", "Syncing…");
        return firebasePull();
      })
      .then(function (remote) {
        if (remote) {
          var added = applyPayload(remote);
          if (added.addedMock || added.addedAnswers) {
            setTimeout(function () { location.reload(); }, 800);
          }
        } else {
          return firebasePush();
        }
      })
      .catch(function (err) {
        flash("kpscAuthNote", "err", "Sign-in failed", err.message || err);
      });
  }

  function doEmailSignUp() {
    var email = ($("kpscEmail").value || "").trim();
    var pass  = ($("kpscPassword").value || "").trim();
    if (!email || !pass || pass.length < 6) {
      flash("kpscAuthNote", "err", "Password too short", "Use at least 6 characters.");
      return;
    }
    loadFirebaseSDK()
      .then(function () { return signUpEmail(email, pass); })
      .then(function () {
        flash("kpscAuthNote", "", "Account created", "Syncing your progress…");
        return firebasePush();
      })
      .catch(function (err) {
        flash("kpscAuthNote", "err", "Could not create account", err.message || err);
      });
  }

  function doSignOut() {
    if (!confirm("Sign out? Local progress stays on this device.")) return;
    signOut().then(function () {
      sessionStorage.removeItem(PULLED_SS);
      updateAccountUI();
      flash("kpscAuthNote", "warn", "Signed out", "");
    });
  }

  function doSyncNow() {
    if (!currentUser) return;
    fbSyncNow()
      .then(function (added) {
        if (added && (added.addedMock || added.addedAnswers)) {
          flash("kpscAccountNote", "", "Merged new progress",
            added.addedMock + " paper(s), " + added.addedAnswers + " answer(s). Reloading…");
          setTimeout(function () { location.reload(); }, 1200);
        } else {
          flash("kpscAccountNote", "", "Up to date", "Everything is synced.");
        }
      })
      .catch(function (err) {
        flash("kpscAccountNote", "err", "Sync failed", err.message || err);
      });
  }

  function doGistConnect() {
    var token = ($("kpscTokenInput").value || "").trim();
    var gistId = ($("kpscGistInput").value || "").trim();

    if (!token || (token.indexOf("ghp_") !== 0 && token.indexOf("github_pat_") !== 0)) {
      flash("kpscSetupNote", "err", "Invalid token", "Must start with ghp_ or github_pat_.");
      return;
    }

    if (gistId) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(GIST_KEY, gistId);
      pullGist()
        .then(function (remote) {
          if (remote) {
            var added = applyPayload(remote);
            flash("kpscSetupNote", "", "Connected",
              added.addedMock || added.addedAnswers ? "Progress pulled. Reloading…" : "");
            if (added.addedMock || added.addedAnswers) {
              setTimeout(function () { location.reload(); }, 800);
            } else {
              updateAccountUI();
            }
          } else {
            flash("kpscSetupNote", "warn", "Connected but empty",
              "No progress found in this Gist.");
            updateAccountUI();
            pushGist().catch(function () {});
          }
        })
        .catch(function (err) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(GIST_KEY);
          flash("kpscSetupNote", "err", "Connection failed", err.message);
        });
    } else {
      createGist(token)
        .then(function (gist) {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(GIST_KEY, gist.id);
          flash("kpscSetupNote", "", "Gist created",
            "Gist ID: <code>" + gist.id + "</code><br>Use this on other devices.");
          updateAccountUI();
        })
        .catch(function (err) {
          flash("kpscSetupNote", "err", "Could not create Gist", err.message);
        });
    }
  }

  function doGistDisconnect() {
    if (!confirm("Disconnect Gist? Local progress stays.")) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    updateAccountUI();
    flash("kpscSetupNote", "warn", "Disconnected", "");
  }

  function doGistSyncNow() {
    pullGist()
      .then(function (remote) {
        if (!remote) return null;
        return applyPayload(remote);
      })
      .then(function (added) {
        return pushGist().then(function () {
          if (added && (added.addedMock || added.addedAnswers)) {
            flash("kpscSetupNote", "", "Merged",
              added.addedMock + " paper(s), " + added.addedAnswers + " answer(s).");
            setTimeout(function () { location.reload(); }, 1000);
          }
        });
      })
      .catch(function (err) {
        flash("kpscSetupNote", "err", "Sync failed", err.message);
      });
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
        answers + " answer(s), " + code.length + " chars.";
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
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(ta.value);
    var info = $("kpscExportInfo");
    var prev = info.innerHTML;
    info.innerHTML = "<b>&#128203; Copied</b>";
    setTimeout(function () { info.innerHTML = prev; }, 1400);
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
        res.addedMock + " paper(s), " + res.addedAnswers + " answer(s).";
      setTimeout(function () { location.reload(); }, 1200);
    } catch (e) {
      info.className = "kpsc-note err";
      info.innerHTML = "<b>Invalid code</b>" + (e.message || e);
    }
  }

  function openModal() {
    var m = $("kpscSyncModal") || buildModal();
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    refreshExport();
    updateAccountUI();
  }
  function closeModal() {
    var m = $("kpscSyncModal");
    if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }
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

    $("kpscGoogleBtn").addEventListener("click", doGoogle);
    $("kpscSignInBtn").addEventListener("click", doEmailSignIn);
    $("kpscSignUpBtn").addEventListener("click", doEmailSignUp);
    $("kpscSignOut").addEventListener("click", doSignOut);
    $("kpscSyncNow").addEventListener("click", doSyncNow);

    $("kpscCopyBtn").addEventListener("click", copyCode);
    $("kpscDownloadBtn").addEventListener("click", downloadCode);
    $("kpscLoadBtn").addEventListener("click", loadCode);
    $("kpscClearInput").addEventListener("click", function () {
      $("kpscImportCode").value = "";
      $("kpscImportInfo").style.display = "none";
    });

    $("kpscConnectBtn").addEventListener("click", doGistConnect);
    $("kpscGistSyncNow").addEventListener("click", doGistSyncNow);
    $("kpscGistDisconnect").addEventListener("click", doGistDisconnect);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function injectButton() {
    if (qs(".kpsc-sync-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kpsc-sync-btn";
    btn.setAttribute("aria-label", "Save or load progress");
    btn.innerHTML = "&#128190; Sync";
    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
  }

  /* =================================================================
     INIT
     ================================================================= */
  function init() {
    injectCSS();
    injectButton();
    buildModal();
    bindEvents();

    if (ENABLE_FIREBASE) {
      loadFirebaseSDK()
        .then(function () { updateAccountUI(); autoPullOnLoad(); })
        .catch(function (err) {
          console.warn("Firebase unavailable:", err.message);
          updateAccountUI();
          autoPullOnLoad();
        });
    } else {
      updateAccountUI();
      autoPullOnLoad();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.KPSC_Sync = {
    __version: 3,
    export:      function () { return encode(collectPayload()); },
    import:      function (code) { return applyPayload(decode(code)); },
    open:        openModal,
    isConnected: function () { return !!currentUser || isGistConnected(); },
    syncNow:     function () {
      return currentUser ? fbSyncNow() : doGistSyncNow();
    },
    push:        function () { return pushNow(); }
  };
})();