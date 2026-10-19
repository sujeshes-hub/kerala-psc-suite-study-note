/* =====================================================================
   Kerala PSC Study Suite — Progress Sync (v6.3 Debug Edition)
   Shows visible on-screen errors if Firestore rules block the sync.
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

  var ENABLE_FIREBASE = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf("PASTE_") !== 0;

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

  // --- VISIBLE ERROR BANNER ---
  function showError(msg) {
    console.error("🔥 SYNC ERROR:", msg);
    var b = document.getElementById("kpscSyncBanner");
    if (!b) {
      b = document.createElement("div");
      b.id = "kpscSyncBanner";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;background:#c5221f;color:#fff;padding:12px;text-align:center;font-weight:bold;z-index:99999;font-family:sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
      document.body.appendChild(b);
    }
    b.innerHTML = "⚠️ Sync Error: " + msg + ' <button onclick="this.parentNode.style.display=\'none\'" style="margin-left:20px;cursor:pointer;border:none;background:#fff;color:#c5221f;padding:4px 8px;border-radius:4px;font-weight:bold;">Dismiss</button>';
    b.style.display = "block";
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
          try { window.dispatchEvent(new CustomEvent("kpsc-auth-changed")); } catch(e) {}
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
      updateStatusUI("err", "Save failed");
      showError("Write denied. Check Firestore Rules. (" + err.message + ")");
      throw err;
    });
  }

  function runInitialSync(source) {
    updateStatusUI("wait", "Syncing…");
    return firebaseMergePush()
      .then(function (changed) { markReady(); notifyApplied(changed, source); })
      .catch(function (e) { 
        console.warn("initial sync:", e); 
        markReady(); 
        showError("Could not pull from cloud. Check Firestore Rules.");
      });
  }

  function signInGoogle() {
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return firebaseAuth.signInWithPopup(provider);
  }
  function signInEmail(email, password) { return firebaseAuth.signInWithEmailAndPassword(email, password); }
  function signUpEmail(email, password) { return firebaseAuth.createUserWithEmailAndPassword(email, password); }
  function signOut() { return firebaseReady ? firebaseAuth.signOut() : Promise.resolve(); }

  function pushNow() {
    if (currentUser) return firebaseMergePush();
    return Promise.resolve(null);
  }

  function schedulePush() {
    if (!currentUser) return;
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

  window.addEventListener("focus", function () {
    if (!initialDone || !currentUser) return;
    var now = Date.now();
    if (now - lastPull < PULL_THROTTLE) return;
    lastPull = now;
    firebasePull().then(function(remote) {
      if (remote) notifyApplied(reconcile(normalizeRemote(remote)), "pull");
    }).catch(function(e){});
  });

  function whenReady(ms) {
    usedReady = true;
    return Promise.race([
      readyPromise,
      new Promise(function (r) { setTimeout(r, ms || READY_MAX_WAIT); })
    ]);
  }

  /* UI rendering logic omitted for brevity (same as v6.2) */
  function updateStatusUI(kind, message) {}
  function updateAccountUI() {
    try { window.dispatchEvent(new CustomEvent("kpsc-auth-changed")); } catch(e) {}
  }
  function init() {
     if (ENABLE_FIREBASE) loadFirebaseSDK();
     else markReady();
  }
  
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  setTimeout(markReady, READY_MAX_WAIT + 1500);

  window.KPSC_Sync = {
    open: function(){},
    isConnected: function () { return !!currentUser; },
    getCurrentUser: function() { return currentUser ? { email: currentUser.email } : null; },
    whenReady: whenReady
  };
})();