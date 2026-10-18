/* =====================================================================
   Kerala PSC Study Suite — Progress Sync + Login (site-wide auto-save)
   Path: assets/js/sync.js
   Version: 6.1 - Exposes getCurrentUser for UI badges
   ===================================================================== */
(function () {
  "use strict";

  if (window.KPSC_Sync) return;

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

  var PREFIX        = "KPS1.";
  var APP_ID        = "kerala-psc-suite";
  var TOKEN_KEY     = "kpsc_gh_token";
  var GIST_KEY      = "kpsc_gh_gist_id";
  var LASTS_KEY     = "kpsc_last_sync";
  var META_KEY      = "kpsc_sync_meta";
  var GIST_FILE     = "kerala-psc-progress.json";
  var FIRESTORE_COL = "users";
  var SAVE_DEBOUNCE = 900;
  var PULL_THROTTLE = 2500;
  var TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 45;
  var READY_MAX_WAIT = 5000;

  var SKIP_KEYS = {
    "kpsc_gh_token": 1, "kpsc_gh_gist_id": 1,
    "kpsc_last_sync": 1, "kpsc_pulled_this_session": 1,
    "kpsc_sync_meta": 1, "kp-theme": 1
  };
  var SKIP_PREFIXES = ["kpsc_qr_cache", "firebase", "__", "keralaTheme"];

  var origSet    = Storage.prototype.setItem;
  var origRemove = Storage.prototype.removeItem;

  var firebaseApp = null, firebaseAuth = null, firestoreDb = null;
  var firebaseReady = false, currentUser = null;
  var pushing = false, pushQueued = false, pulling = false, lastPull = 0;
  var pushTimer = null, fbSDKPromise = null;
  var applying = false;
  var firstAuthEvent = true;
  var usedReady = false;
  var initialDone = false, readyResolve = null;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  function markReady() {
    if (initialDone) return;
    initialDone = true;
    readyResolve();
  }

  function isSkipped(k) {
    if (SKIP_KEYS[k]) return true;
    for (var i = 0; i < SKIP_PREFIXES.length; i++) {
      if (k.indexOf(SKIP_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function isTrackedKey(k, v) {
    if (!k || typeof k !== "string") return false;
    if (isSkipped(k)) return false;
    if (k.indexOf("kpsc_") === 0)  return true;
    if (k.indexOf("kerala") === 0) return true;
    if (k.indexOf("quiz") === 0)   return true;
    if (k.indexOf("mock") === 0)   return true;
    if (typeof v === "string" && v.length > 8) {
      var first = v.charAt(0);
      if (first === "{" || first === "[") {
        try { var p = JSON.parse(v); return !!p && typeof p === "object"; }
        catch (e) { return false; }
      }
    }
    return false;
  }

  function scanTrackedKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      if (isTrackedKey(k, localStorage.getItem(k))) out.push(k);
    }
    return out;
  }

  function readMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY) || "{}");
      if (!m || typeof m !== "object") m = {};
      m.ts  = m.ts  || {};
      m.del = m.del || {};
      return m;
    } catch (e) { return { ts: {}, del: {} }; }
  }
  function writeMeta(m) {
    var now = Date.now();
    Object.keys(m.del).forEach(function (k) {
      if (now - m.del[k] > TOMBSTONE_TTL) delete m.del[k];
    });
    try { origSet.call(localStorage, META_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function markWrite(k) {
    var m = readMeta(); m.ts[k] = Date.now(); delete m.del[k]; writeMeta(m);
  }
  function markDelete(k) {
    var m = readMeta(); m.del[k] = Date.now(); delete m.ts[k]; writeMeta(m);
  }

  function collectPayload() {
    var meta = readMeta(), stores = {}, tsMap = {}, now = Date.now();
    scanTrackedKeys().forEach(function (k) {
      var raw = localStorage.getItem(k);
      if (raw === null) return;
      stores[k] = raw;
      tsMap[k]  = meta.ts[k] || 1;
    });
    var del = {};
    Object.keys(meta.del).forEach(function (k) {
      if (now - meta.del[k] < TOMBSTONE_TTL && !(k in stores)) del[k] = meta.del[k];
    });
    return { v: 3, ts: now, app: APP_ID, stores: stores, tsMap: tsMap, del: del };
  }

  function normalizeRemote(p) {
    var out = { stores: {}, tsMap: p.tsMap || {}, del: p.del || {}, ts: p.ts || 0 };
    function put(k, v) { out.stores[k] = (typeof v === "string") ? v : JSON.stringify(v); }
    if (p.stores && typeof p.stores === "object") {
      Object.keys(p.stores).forEach(function (k) { put(k, p.stores[k]); });
    } else if (p.mock && typeof p.mock === "object") {
      Object.keys(p.mock).forEach(function (k) { put(k, p.mock[k]); });
    }
    return out;
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

  function deepMerge(a, b) {
    if (typeof a !== typeof b) return b;
    if (a === null || b === null) return b;
    if (typeof a !== "object") return b;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      var len = Math.max(a.length, b.length), merged = new Array(len);
      for (var i = 0; i < len; i++) {
        var l = a[i], r = b[i];
        if (r === undefined) merged[i] = l;
        else if (l === undefined) merged[i] = r;
        else if (l && r && typeof l === "object" && typeof r === "object") merged[i] = deepMerge(l, r);
        else merged[i] = r;
      }
      return merged;
    }
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      out[k] = Object.prototype.hasOwnProperty.call(out, k) ? deepMerge(out[k], b[k]) : b[k];
    }
    return out;
  }

  function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + stable(v[k]);
    }).join(",") + "}";
  }

  function tryParse(raw) {
    try { return { ok: true, val: JSON.parse(raw) }; } catch (e) { return { ok: false }; }
  }

  function isSnapshot(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) &&
           (Array.isArray(v.questionStates) || "timerEndTime" in v || "timeRemaining" in v);
  }

  function reconcile(remote) {
    var meta = readMeta(), changed = [];
    var rStores = remote.stores || {}, rTs = remote.tsMap || {}, rDel = remote.del || {};
    var legacyTs = remote.ts || 0;
    var keys = {};
    Object.keys(rStores).forEach(function (k) { keys[k] = 1; });
    Object.keys(rDel).forEach(function (k) { keys[k] = 1; });

    applying = true;
    try {
      Object.keys(keys).forEach(function (k) {
        if (isSkipped(k)) return;

        var lraw   = localStorage.getItem(k);
        var exists = lraw !== null;
        var lts    = exists ? (meta.ts[k] || 1) : 0;
        var ldel   = meta.del[k] || 0;
        var hasR   = Object.prototype.hasOwnProperty.call(rStores, k);
        var rraw   = hasR ? rStores[k] : null;
        var rts    = hasR ? (rTs[k] || legacyTs || 1) : 0;
        var rdel   = rDel[k] || 0;
        var newest = Math.max(lts, ldel, rts, rdel);
        if (!newest) return;

        if (rdel === newest && rdel >= lts && rdel >= rts) {
          if (exists) { origRemove.call(localStorage, k); changed.push(k); }
          meta.del[k] = rdel; delete meta.ts[k];
          return;
        }
        if (ldel === newest && ldel >= lts && ldel >= rts) return;

        if (!hasR) return;

        if (!exists) {
          origSet.call(localStorage, k, rraw);
          meta.ts[k] = rts; delete meta.del[k];
          changed.push(k);
          return;
        }

        var lp = tryParse(lraw), rp = tryParse(rraw), mergedRaw = lraw, differs = false;
        if (!lp.ok || !rp.ok || isSnapshot(lp.val) || isSnapshot(rp.val)) {
          if (rts > lts) { mergedRaw = rraw; differs = (lraw !== rraw); }
        } else {
          var m = (rts > lts) ? deepMerge(lp.val, rp.val) : deepMerge(rp.val, lp.val);
          if (stable(m) !== stable(lp.val)) { mergedRaw = JSON.stringify(m); differs = true; }
        }
        if (differs) { origSet.call(localStorage, k, mergedRaw); changed.push(k); }
        meta.ts[k] = Math.max(lts, rts);
      });
    } finally { applying = false; }

    writeMeta(meta);
    return changed;
  }

  function applyPayload(payload) { return reconcile(normalizeRemote(payload)); }

  function notifyApplied(changed, source) {
    if (!changed || !changed.length) return;
    var ev;
    try {
      ev = new CustomEvent("kpsc-sync-applied", { cancelable: true, detail: { keys: changed, source: source } });
    } catch (e) { ev = null; }
    var proceed = ev ? window.dispatchEvent(ev) : true;
    if (!proceed) return;
    if (source === "initial" && usedReady) return;
    setTimeout(function () { location.reload(); }, 300);
  }

  function hasAuthHint() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("firebase:authUser:") === 0) return true;
      }
    } catch (e) {}
    return false;
  }

  function loadFirebaseSDK() {
    if (fbSDKPromise) return fbSDKPromise;
    if (!ENABLE_FIREBASE) return Promise.reject(new Error("Firebase not configured"));

    fbSDKPromise = new Promise(function (resolve, reject) {
      var base = "https://www.gstatic.com/firebasejs/10.12.0/";
      var files = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
      var loaded = 0;
      files.forEach(function (f) {
        var s = document.createElement("script");
        s.src = base + f;
        s.onload = function () { loaded++; if (loaded === files.length) resolve(); };
        s.onerror = function () { reject(new Error("Could not load Firebase SDK")); };
        document.head.appendChild(s);
      });
    }).then(function () {
      if (!window.firebase) throw new Error("firebase global missing");
      firebaseApp  = window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseAuth = window.firebase.auth();
      firestoreDb  = window.firebase.firestore();
      try { firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      firebaseReady = true;
      return new Promise(function (resolve) {
        firebaseAuth.onAuthStateChanged(function (user) {
          var first = firstAuthEvent; firstAuthEvent = false;
          currentUser = user;
          updateAccountUI();
          if (user) {
            runInitialSync(first ? "initial" : "signin");
          } else {
            gistInitial();
          }
          resolve(user);
        });
      });
    });

    return fbSDKPromise;
  }

  function userDoc() { return firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid); }

  function firebasePull() {
    if (!firebaseReady || !currentUser) return Promise.resolve(null);
    return userDoc().get().then(function (doc) { return doc.exists ? (doc.data() || null) : null; });
  }

  function firebaseMergePush() {
    if (!firebaseReady || !currentUser) return Promise.resolve(null);
    if (pushing) { pushQueued = true; return Promise.resolve(null); }
    pushing = true;
    var ref = userDoc(), changed = [];

    return firestoreDb.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        changed = snap.exists ? reconcile(normalizeRemote(snap.data() || {})) : [];
        var payload = collectPayload();
        payload.uid     = currentUser.uid;
        payload.email   = currentUser.email || "";
        payload.updated = window.firebase.firestore.FieldValue.serverTimestamp();
        tx.set(ref, payload);
      });
    }).then(function () {
      origSet.call(localStorage, LASTS_KEY, String(Date.now()));
      updateStatusUI("ok", "Saved " + new Date().toLocaleTimeString());
      pushDone();
      return changed;
    }).catch(function (err) {
      pushDone();
      updateStatusUI("err", "Save failed: " + (err.message || err));
      throw err;
    });
  }

  function runInitialSync(source) {
    updateStatusUI("wait", "Syncing…");
    return firebaseMergePush()
      .then(function (changed) { markReady(); notifyApplied(changed, source); })
      .catch(function (e) { console.warn("initial sync:", e); markReady(); });
  }

  function signInGoogle() {
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return firebaseAuth.signInWithPopup(provider);
  }
  function signInEmail(email, password) { return firebaseAuth.signInWithEmailAndPassword(email, password); }
  function signUpEmail(email, password) { return firebaseAuth.createUserWithEmailAndPassword(email, password); }
  function signOut() { return firebaseReady ? firebaseAuth.signOut() : Promise.resolve(); }

  function getToken()   { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getGistId()  { return localStorage.getItem(GIST_KEY)  || ""; }
  function isGistConnected() { return !!(getToken() && getGistId()); }

  function ghFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      "Authorization": "token " + getToken(),
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

  function gistFiles(payload) {
    var o = {}; o[GIST_FILE] = { content: JSON.stringify(payload) }; return o;
  }

  function createGist(token) {
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
        files: gistFiles(collectPayload())
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
    return ghFetch("https://api.github.com/gists/" + getGistId()).then(function (gist) {
      var file = gist.files && gist.files[GIST_FILE];
      if (!file || !file.content) return null;
      try { return JSON.parse(file.content); } catch (e) { return null; }
    });
  }

  function gistMergePush() {
    if (!isGistConnected()) return Promise.resolve(null);
    if (pushing) { pushQueued = true; return Promise.resolve(null); }
    pushing = true;
    return pullGist().then(function (remote) {
      var changed = remote ? reconcile(normalizeRemote(remote)) : [];
      return ghFetch("https://api.github.com/gists/" + getGistId(), {
        method: "PATCH",
        body: JSON.stringify({ files: gistFiles(collectPayload()) })
      }).then(function () { return changed; });
    }).then(function (changed) {
      origSet.call(localStorage, LASTS_KEY, String(Date.now()));
      updateStatusUI("ok", "Saved " + new Date().toLocaleTimeString());
      pushDone();
      return changed;
    }).catch(function (err) {
      pushDone();
      updateStatusUI("err", "Push failed: " + err.message);
      throw err;
    });
  }

  function gistInitial() {
    if (!isGistConnected()) { markReady(); return Promise.resolve(); }
    return gistMergePush()
      .then(function (changed) { markReady(); notifyApplied(changed, "initial"); })
      .catch(function (e) { console.warn("gist initial:", e); markReady(); });
  }

  function pushNow() {
    if (currentUser) return firebaseMergePush();
    if (isGistConnected()) return gistMergePush();
    return Promise.resolve(null);
  }

  function schedulePush() {
    if (!currentUser && !isGistConnected()) return;
    clearTimeout(pushTimer);
    updateStatusUI("wait", "Saving…");
    pushTimer = setTimeout(function () {
      pushNow().catch(function (e) { console.warn("auto-push:", e); });
    }, SAVE_DEBOUNCE);
  }

  function pushDone() {
    pushing = false;
    if (pushQueued) { pushQueued = false; schedulePush(); }
  }

  Storage.prototype.setItem = function (key, value) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || applying) return;
    try {
      if (isTrackedKey(key, String(value))) { markWrite(key); schedulePush(); }
    } catch (e) {}
  };
  Storage.prototype.removeItem = function (key) {
    var track = false;
    if (this === window.localStorage && !applying) {
      try {
        var cur = window.localStorage.getItem(key);
        track = cur !== null && isTrackedKey(key, cur);
      } catch (e) {}
    }
    origRemove.apply(this, arguments);
    if (track) { try { markDelete(key); schedulePush(); } catch (e) {} }
  };

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(pushTimer);
      pushNow().catch(function () {});
    } else {
      autoPull();
    }
  });
  window.addEventListener("pagehide", function () {
    clearTimeout(pushTimer);
    pushNow().catch(function () {});
  });
  window.addEventListener("focus", function () { autoPull(); });

  function autoPull() {
    if (pulling || !initialDone) return;
    if (!currentUser && !isGistConnected()) return;
    var now = Date.now();
    if (now - lastPull < PULL_THROTTLE) return;
    lastPull = now;

    pulling = true;
    var p = (firebaseReady && currentUser) ? firebasePull() : pullGist();
    p.then(function (remote) {
      pulling = false;
      if (!remote) return;
      notifyApplied(reconcile(normalizeRemote(remote)), "pull");
    }).catch(function (e) { pulling = false; console.warn("auto-pull:", e); });
  }

  function whenReady(ms) {
    usedReady = true;
    return Promise.race([
      readyPromise,
      new Promise(function (r) { setTimeout(r, ms || READY_MAX_WAIT); })
    ]);
  }

  var CSS =
    ".kpsc-sync-btn{position:fixed;bottom:18px;right:18px;z-index:9998;" +
      "padding:11px 18px;border-radius:999px;border:none;cursor:pointer;" +
      "background:linear-gradient(135deg,#0b5d63,#128a8f);color:#fff;" +
      "font-family:inherit;font-weight:800;font-size:.86rem;letter-spacing:.3px;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.28);transition:.15s;}" +
    ".kpsc-sync-btn:hover{transform:translateY(-2px);}" +
    ".kpsc-sync-btn:active{transform:scale(.96);}" +
    ".kpsc-sync-btn:focus-visible,.kpsc-close:focus-visible,.kpsc-tabs button:focus-visible,.kpsc-actions button:focus-visible{outline:3px solid #f5b301;outline-offset:2px;}" +
    ".kpsc-sync-btn::after{content:'';position:absolute;top:6px;right:8px;" +
      "width:9px;height:9px;border-radius:50%;background:#94a3b8;" +
      "box-shadow:0 0 0 2px #0b5d63;}" +
    ".kpsc-sync-btn.connected::after{background:#3ddc97;}" +
    ".kpsc-sync-btn.error::after{background:#ef4444;}" +
    ".kpsc-sync-btn.saving::after{background:#f59e0b;animation:kpscpulse 1s ease infinite;}" +
    "@keyframes kpscpulse{50%{opacity:.4;}}" +
    "@media print{.kpsc-sync-btn{display:none !important;}}" +
    "@media (prefers-reduced-motion:reduce){.kpsc-sync-btn,.kpsc-sync-btn::after,.kpsc-status .dot{animation:none !important;transition:none !important;}}" +

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
      "font-family:inherit;font-weight:700;font-size:.85rem;cursor:pointer;min-width:110px;}" +
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
      "border:1px solid #a8e0c0;display:flex;gap:12px;align-items:center;margin-bottom:12px;}" +
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
    ".kpsc-status .dot.wait{background:#f59e0b;animation:kpscpulse 1s ease infinite;}" +
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

  function buildModal() {
    if (document.getElementById("kpscSyncModal")) return document.getElementById("kpscSyncModal");
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
      '        Every answer you give is saved to the cloud within a second. Open the same page on another device and tap <b style="display:inline">Resume</b>.',
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
      '    <p>Paste a code from another device. Newer progress wins; nothing newer is lost.</p>',
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

  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }

  function updateStatusUI(kind, message) {
    var dot = $("kpscDot");
    if (dot) dot.className = "dot " + (kind || "");
    if (message) { var s = $("kpscStatusLine"); if (s) s.textContent = message; }
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
    } else {
      if ($("kpscLoggedIn"))  $("kpscLoggedIn").style.display  = "none";
      if ($("kpscLoggedOut")) $("kpscLoggedOut").style.display = "";
    }
    var gc = $("kpscGistConnected"), gs = $("kpscGistSetup");
    if (gc && gs) {
      if (isGistConnected()) {
        gc.style.display = ""; gs.style.display = "none";
        var lbl = $("kpscGistLabel");
        if (lbl) lbl.textContent = getGistId().slice(0, 12) + "…";
      } else {
        gc.style.display = "none"; gs.style.display = "";
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
      .then(function () { flash("kpscAuthNote", "", "Signed in", "Syncing your progress…"); })
      .catch(function (err) { flash("kpscAuthNote", "err", "Sign-in failed", err.message || err); });
  }

  function doEmailSignIn() {
    var email = ($("kpscEmail").value || "").trim();
    var pass  = ($("kpscPassword").value || "").trim();
    if (!email || !pass) { flash("kpscAuthNote", "err", "Missing info", "Enter email and password."); return; }
    loadFirebaseSDK()
      .then(function () { return signInEmail(email, pass); })
      .then(function () { flash("kpscAuthNote", "", "Signed in", "Syncing…"); })
      .catch(function (err) { flash("kpscAuthNote", "err", "Sign-in failed", err.message || err); });
  }

  function doEmailSignUp() {
    var email = ($("kpscEmail").value || "").trim();
    var pass  = ($("kpscPassword").value || "").trim();
    if (!email || !pass || pass.length < 6) { flash("kpscAuthNote", "err", "Password too short", "Use at least 6 characters."); return; }
    loadFirebaseSDK()
      .then(function () { return signUpEmail(email, pass); })
      .then(function () { flash("kpscAuthNote", "", "Account created", "Syncing your progress…"); })
      .catch(function (err) { flash("kpscAuthNote", "err", "Could not create account", err.message || err); });
  }

  function doSignOut() {
    if (!confirm("Sign out? Local progress stays on this device.")) return;
    signOut().then(function () { updateAccountUI(); flash("kpscAuthNote", "warn", "Signed out", ""); });
  }

  function doSyncNow() {
    if (!currentUser) return;
    updateStatusUI("wait", "Syncing…");
    firebaseMergePush()
      .then(function (changed) {
        if (changed && changed.length) {
          flash("kpscAccountNote", "", "Merged new progress", changed.length + " item(s) updated. Reloading…");
          notifyApplied(changed, "manual");
        } else { flash("kpscAccountNote", "", "Up to date", "Everything is synced."); }
      })
      .catch(function (err) { flash("kpscAccountNote", "err", "Sync failed", err.message || err); });
  }

  function doGistConnect() {
    var token = ($("kpscTokenInput").value || "").trim();
    var gistId = ($("kpscGistInput").value || "").trim();
    if (!token || (token.indexOf("ghp_") !== 0 && token.indexOf("github_pat_") !== 0)) {
      flash("kpscSetupNote", "err", "Invalid token", "Must start with ghp_ or github_pat_.");
      return;
    }
    if (gistId) {
      origSet.call(localStorage, TOKEN_KEY, token);
      origSet.call(localStorage, GIST_KEY, gistId);
      gistMergePush()
        .then(function (changed) {
          flash("kpscSetupNote", "", "Connected", (changed && changed.length) ? "Progress pulled. Reloading…" : "");
          updateAccountUI();
          notifyApplied(changed, "manual");
        })
        .catch(function (err) {
          origRemove.call(localStorage, TOKEN_KEY);
          origRemove.call(localStorage, GIST_KEY);
          flash("kpscSetupNote", "err", "Connection failed", err.message);
        });
    } else {
      createGist(token)
        .then(function (gist) {
          origSet.call(localStorage, TOKEN_KEY, token);
          origSet.call(localStorage, GIST_KEY, gist.id);
          flash("kpscSetupNote", "", "Gist created", "Gist ID: <code>" + gist.id + "</code>");
          updateAccountUI();
        })
        .catch(function (err) { flash("kpscSetupNote", "err", "Could not create Gist", err.message); });
    }
  }

  function doGistDisconnect() {
    if (!confirm("Disconnect Gist? Local progress stays.")) return;
    origRemove.call(localStorage, TOKEN_KEY);
    origRemove.call(localStorage, GIST_KEY);
    updateAccountUI();
    flash("kpscSetupNote", "warn", "Disconnected", "");
  }

  function doGistSyncNow() {
    gistMergePush()
      .then(function (changed) {
        if (changed && changed.length) {
          flash("kpscSetupNote", "", "Merged", changed.length + " item(s) updated.");
          notifyApplied(changed, "manual");
        } else { flash("kpscSetupNote", "", "Up to date", ""); }
      })
      .catch(function (err) { flash("kpscSetupNote", "err", "Sync failed", err.message); });
  }

  function refreshExport() {
    var ta = $("kpscExportCode");
    var info = $("kpscExportInfo");
    try {
      var payload = collectPayload();
      var code = encode(payload);
      ta.value = code;
      var keys = Object.keys(payload.stores).length;
      info.className = "kpsc-note";
      info.innerHTML = "<b>&#10003; Ready</b>" + keys + " progress key(s) · " + code.length + " chars.";
    } catch (e) {
      ta.value = "";
      info.className = "kpsc-note err";
      info.innerHTML = "<b>Export failed</b>" + (e.message || e);
    }
  }

  function copyCode() {
    var ta = $("kpscExportCode");
    if (!ta.value) return;
    ta.select(); ta.setSelectionRange(0, ta.value.length);
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
    var stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var a = document.createElement("a");
    a.href = url; a.download = "kerala-psc-progress-" + stamp + ".txt";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function loadCode() {
    var ta = $("kpscImportCode");
    var info = $("kpscImportInfo");
    info.style.display = "block";
    var raw = (ta.value || "").trim();
    if (!raw) { info.className = "kpsc-note warn"; info.innerHTML = "<b>Empty</b>Paste a code first."; return; }
    try {
      var changed = applyPayload(decode(raw));
      info.className = "kpsc-note";
      info.innerHTML = "<b>&#10003; Loaded</b>" + changed.length + " item(s) updated.";
      if (changed.length) { schedulePush(); notifyApplied(changed, "import"); }
    } catch (e) {
      info.className = "kpsc-note err";
      info.innerHTML = "<b>Invalid code</b>" + (e.message || e);
    }
  }

  var lastFocus = null;
  function openModal() {
    var m = $("kpscSyncModal") || buildModal();
    lastFocus = document.activeElement;
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    refreshExport();
    updateAccountUI();
    var c = m.querySelector(".kpsc-close");
    if (c) c.focus();
  }
  function closeModal() {
    var m = $("kpscSyncModal");
    if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function bindEvents() {
    var m = $("kpscSyncModal");
    if (!m || m.dataset.bound) return;
    m.dataset.bound = "1";
    m.querySelector(".kpsc-close").addEventListener("click", closeModal);
    m.addEventListener("click", function (e) { if (e.target === m) closeModal(); });
    m.querySelectorAll(".kpsc-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        m.querySelectorAll(".kpsc-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
        m.querySelectorAll(".kpsc-panel").forEach(function (p) { p.classList.toggle("hidden", p.dataset.panel !== b.dataset.tab); });
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
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
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

  function init() {
    injectCSS();
    injectButton();
    buildModal();
    bindEvents();
    updateAccountUI();
    if (ENABLE_FIREBASE) {
      loadFirebaseSDK()
        .then(function () { updateAccountUI(); })
        .catch(function (err) {
          console.warn("Firebase unavailable:", err.message);
          updateAccountUI();
          gistInitial();
        });
    } else {
      gistInitial();
    }
  }

  if (!hasAuthHint() && !isGistConnected()) markReady();
  setTimeout(markReady, READY_MAX_WAIT + 1500);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.KPSC_Sync = {
    __version: 6.1,
    export:      function () { return encode(collectPayload()); },
    import:      function (code) { return applyPayload(decode(code)); },
    open:        openModal,
    isConnected: function () { return !!currentUser || isGistConnected(); },
    getCurrentUser: function() {
      if (currentUser) return { email: currentUser.email, displayName: currentUser.displayName };
      if (isGistConnected()) return { email: "GitHub Gist Account", displayName: "Gist User" };
      return null;
    },
    syncNow:     function () { return pushNow(); },
    push:        function () { return pushNow(); },
    whenReady:   whenReady,
    trackedKeys: scanTrackedKeys
  };
})();