/* =====================================================================
   Kerala PSC Study Suite — Progress Sync v7
   Path: assets/js/sync.js   (same Firebase project, same Firestore doc
   format as v6 — existing cloud data keeps working)

   What is new compared with v6.3
   - Firebase SDK files now execute in the right order (app -> auth ->
     firestore). Before, they could race and sync silently failed.
   - Signed-out visitors no longer wait for a timeout (gistInitial() did
     not exist and threw an error).
   - Pages that call whenReady() now really wait for the cloud merge
     (up to 10 s when signed in) so they never start a blank attempt
     before the other device's progress has arrived.
   - When sync reloads a page it blocks the page's own last-second save
     and "leave site?" prompt, so the merged cloud data is not
     overwritten by stale in-memory state.
   - Changes are pushed immediately when the tab is hidden (switching
     from phone to PC) and pulled when the tab is shown again.
   - Offline: no red error; retries with back-off and on "online".
   - Reads only when nothing changed (no needless Firestore writes).
   - A transaction retry can no longer lose the "data changed" signal.
   - Theme / banner-dismiss keys are per-device and no longer synced.
   - Signing in with a different account than the one this device last
     used asks before mixing progress.
   - Full sign-in window (Google, e-mail, reset, sign out) + small
     status pill. Set window.KPSC_SYNC_NO_PILL = true to hide the pill.
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
  var ENABLE_FIREBASE = !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf("PASTE_") !== 0);

  var PREFIX        = "KPS1.";
  var APP_ID        = "kerala-psc-suite";
  var LASTS_KEY     = "kpsc_last_sync";
  var META_KEY      = "kpsc_sync_meta";
  var UID_KEY       = "kpsc_sync_uid";
  var HINT_KEY      = "kpsc_sync_hint";      /* "1" signed in, "0" signed out */
  var FIRESTORE_COL = "users";
  var SAVE_DEBOUNCE = 1200;
  var PULL_THROTTLE = 4000;
  var TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 45;
  var READY_SIGNED_IN_WAIT = 10000;
  var READY_HARD_CAP       = 12000;

  /* per-device keys — never synced */
  var SKIP_KEYS = {
    "kpsc_gh_token": 1, "kpsc_gh_gist_id": 1, "kpsc_last_sync": 1,
    "kpsc_pulled_this_session": 1, "kpsc_sync_meta": 1,
    "kp-theme": 1, "kpsc_theme": 1
  };
  var SKIP_PREFIXES = ["kpsc_sync_", "kpsc_qr_cache", "firebase", "__", "keralaTheme"];

  var origSet    = Storage.prototype.setItem;
  var origRemove = Storage.prototype.removeItem;

  var firebaseApp = null, firebaseAuth = null, firestoreDb = null;
  var firebaseReady = false, currentUser = null, fbSDKPromise = null;
  var pushing = false, pushQueued = false, pushTimer = null;
  var retryTimer = null, retryMs = 5000;
  var lastPull = 0, applying = false, firstAuthEvent = true;
  var dirty = false, writeSeq = 0, reloading = false;
  var usedReady = false, readyTimedOut = false, initialDone = false, readyResolve = null;
  var readyPromise = new Promise(function (r) { readyResolve = r; });
  var status = { kind: "out", msg: "Signed out" };
  var pillEl = null, modalEl = null;

  function markReady() {
    if (initialDone) return;
    initialDone = true;
    readyResolve();
  }

  function hintState() { try { return localStorage.getItem(HINT_KEY); } catch (e) { return null; } }
  function setHint(v)  { try { origSet.call(localStorage, HINT_KEY, v); } catch (e) {} }

  /* ------------------------------------------------------------------
     Visible error banner (only for problems the user must act on)
     ------------------------------------------------------------------ */
  function showError(msg) {
    console.error("KPSC sync:", msg);
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", function () { showError(msg); });
      return;
    }
    var b = document.getElementById("kpscSyncBanner");
    if (!b) {
      b = document.createElement("div");
      b.id = "kpscSyncBanner";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;background:#c5221f;color:#fff;padding:10px 12px;text-align:center;font:600 13px system-ui,sans-serif;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3)";
      document.body.appendChild(b);
    }
    b.textContent = "\u26A0\uFE0F Sync: " + msg + " ";
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "Dismiss";
    x.style.cssText = "margin-left:12px;cursor:pointer;border:0;background:#fff;color:#c5221f;padding:3px 8px;border-radius:4px;font-weight:700";
    x.onclick = function () { b.style.display = "none"; };
    b.appendChild(x);
    b.style.display = "block";
  }

  /* ------------------------------------------------------------------
     Which keys are synced
     ------------------------------------------------------------------ */
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
    if (k.indexOf(PREFIX) === 0)   return true;
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
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (isTrackedKey(k, localStorage.getItem(k))) out.push(k);
      }
    } catch (e) {}
    return out;
  }

  /* ------------------------------------------------------------------
     Per-key timestamps + tombstones
     ------------------------------------------------------------------ */
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
    dirty = true; writeSeq++;
  }
  function markDelete(k) {
    var m = readMeta(); m.del[k] = Date.now(); delete m.ts[k]; writeMeta(m);
    dirty = true; writeSeq++;
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

  /* ------------------------------------------------------------------
     Merge helpers
     ------------------------------------------------------------------ */
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

  /* an in-progress mock-test attempt: newest copy wins, no field merging */
  function isSnapshot(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) &&
           (Array.isArray(v.questionStates) || "timerEndTime" in v || "timeRemaining" in v);
  }

  function union(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
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

  function samePayload(remote, payload) {
    return stable(remote.stores) === stable(payload.stores) &&
           stable(remote.tsMap)  === stable(payload.tsMap)  &&
           stable(remote.del)    === stable(payload.del);
  }

  /* ------------------------------------------------------------------
     Status (pill + sign-in window)
     ------------------------------------------------------------------ */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clock() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  function setStatus(kind, msg) {
    status = { kind: kind, msg: msg };
    renderPill();
    if (modalEl) {
      var st = modalEl.querySelector("#kpscSt");
      if (st) st.textContent = msg;
    }
  }

  function onDomReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function ensurePill() {
    if (window.KPSC_SYNC_NO_PILL || pillEl || !document.body) return;
    pillEl = document.createElement("button");
    pillEl.type = "button";
    pillEl.id = "kpscSyncPill";
    pillEl.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9990;display:none;font:600 12px/1 system-ui,sans-serif;color:#fff;border:0;border-radius:999px;padding:7px 12px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;opacity:.92";
    pillEl.onclick = openModal;
    document.body.appendChild(pillEl);
    renderPill();
  }

  function renderPill() {
    if (!pillEl) return;
    if (!currentUser) { pillEl.style.display = "none"; return; }
    var icon = status.kind === "ok" ? "\u2601\u2713" : (status.kind === "err" ? "\u26A0" : "\u2601");
    pillEl.textContent = icon + " " + status.msg;
    pillEl.style.background = status.kind === "err" ? "#c5221f"
                            : status.kind === "off" ? "#8a5300"
                            : "#0b5d63";
    pillEl.style.display = "block";
  }

  function emitAuth() {
    try { window.dispatchEvent(new CustomEvent("kpsc-auth-changed")); } catch (e) {}
  }

  /* ------------------------------------------------------------------
     Applying cloud changes to the page
     ------------------------------------------------------------------ */
  function reloadForSync() {
    try {
      var t = Date.now();
      var arr = JSON.parse(sessionStorage.getItem("kpsc_sync_reloads") || "[]")
        .filter(function (x) { return t - x < 30000; });
      if (arr.length >= 2) return;                     /* loop guard */
      arr.push(t);
      sessionStorage.setItem("kpsc_sync_reloads", JSON.stringify(arr));
    } catch (e) {}
    reloading = true;
    setTimeout(function () { location.reload(); }, 250);
  }

  function notifyApplied(changed, source) {
    if (!changed || !changed.length) return;
    var ev;
    try {
      ev = new CustomEvent("kpsc-sync-applied", { cancelable: true, detail: { keys: changed, source: source } });
    } catch (e) { ev = null; }
    var proceed = ev ? window.dispatchEvent(ev) : true;
    if (!proceed) return;
    /* page waited for the merge before it started -> it already has the data */
    if (source === "initial" && usedReady && !readyTimedOut) return;
    reloadForSync();
  }

  /* while a sync-reload is pending: no page may overwrite the merged data */
  window.addEventListener("beforeunload", function (e) {
    if (reloading) e.stopImmediatePropagation();
  }, true);

  /* ------------------------------------------------------------------
     Firebase
     ------------------------------------------------------------------ */
  function loadFirebaseSDK() {
    if (fbSDKPromise) return fbSDKPromise;
    if (!ENABLE_FIREBASE) return Promise.reject(new Error("Firebase not configured"));

    fbSDKPromise = new Promise(function (resolve, reject) {
      var base = "https://www.gstatic.com/firebasejs/10.12.0/";
      var files = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
      var loaded = 0, failed = false;
      files.forEach(function (f) {
        var s = document.createElement("script");
        s.src = base + f;
        s.async = false;                       /* keep execution order */
        s.onload = function () { loaded++; if (loaded === files.length && !failed) resolve(); };
        s.onerror = function () { if (!failed) { failed = true; reject(new Error("Could not load Firebase SDK")); } };
        (document.head || document.documentElement).appendChild(s);
      });
    }).then(function () {
      if (!window.firebase) throw new Error("firebase global missing");
      firebaseApp  = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseAuth = window.firebase.auth();
      firestoreDb  = window.firebase.firestore();
      try { firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      firebaseReady = true;
      return new Promise(function (resolve) {
        firebaseAuth.onAuthStateChanged(function (user) {
          var first = firstAuthEvent; firstAuthEvent = false;
          currentUser = user;
          setHint(user ? "1" : "0");
          if (user) {
            setStatus("wait", "Syncing\u2026");
            runInitialSync(first ? "initial" : "signin");
          } else {
            setStatus("out", "Signed out");
            markReady();
          }
          renderPill();
          emitAuth();
          if (modalEl && (user || !first)) closeModal();
          resolve(user);
        });
      });
    }).catch(function (err) {
      fbSDKPromise = null;                     /* allow a later retry */
      markReady();
      console.warn("KPSC sync: SDK load failed", err);
      throw err;
    });

    return fbSDKPromise;
  }

  function userDoc() { return firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid); }

  /* one merge round: read cloud -> merge into local -> write back if different */
  function syncCore() {
    if (!firebaseReady || !currentUser) return Promise.resolve([]);
    if (pushing) { pushQueued = true; return Promise.resolve([]); }
    pushing = true;
    var ref = userDoc(), changed = [], seq = writeSeq;

    return firestoreDb.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var remote = snap.exists ? normalizeRemote(snap.data() || {}) : null;
        if (remote) changed = union(changed, reconcile(remote));   /* survives tx retries */
        var payload = collectPayload();
        if (remote && samePayload(remote, payload)) return;         /* nothing to write */
        payload.uid     = currentUser.uid;
        payload.email   = currentUser.email || "";
        payload.updated = window.firebase.firestore.FieldValue.serverTimestamp();
        tx.set(ref, payload);
      });
    }).then(function () {
      if (writeSeq === seq) dirty = false;
      try { origSet.call(localStorage, LASTS_KEY, String(Date.now())); } catch (e) {}
      setStatus("ok", "Synced " + clock());
      pushDone();
      return changed;
    }, function (err) {
      pushDone();
      throw err;
    });
  }

  function pushDone() {
    pushing = false;
    if (pushQueued) { pushQueued = false; schedulePush(); }
  }

  function handleSyncError(err) {
    var code = (err && err.code) || "";
    console.warn("KPSC sync error:", err);
    if (code === "permission-denied" || code === "unauthenticated") {
      setStatus("err", "Sync blocked");
      showError("the cloud refused the save (" + code + "). Check the Firestore rules for the users collection.");
      return;
    }
    var offline = (typeof navigator !== "undefined" && navigator.onLine === false);
    setStatus(offline ? "off" : "err", offline ? "Offline \u2014 will sync later" : "Sync failed \u2014 retrying");
    scheduleRetry();
  }

  function scheduleRetry() {
    if (!currentUser) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { runSync("pull"); }, retryMs);
    retryMs = Math.min(retryMs * 2, 60000);
  }

  function runSync(source) {
    return syncCore().then(function (changed) {
      retryMs = 5000;
      notifyApplied(changed, source);
      return changed;
    }, function (err) {
      handleSyncError(err);
      return [];
    });
  }

  function guardAccountSwitch() {
    var wiped = false;
    try {
      var last = localStorage.getItem(UID_KEY);
      if (last && last !== currentUser.uid && scanTrackedKeys().length) {
        var merge = window.confirm(
          "This device holds study progress saved under a different account.\n\n" +
          "OK = add it to " + (currentUser.email || "this account") + "\n" +
          "Cancel = remove it from this device and load only this account's progress");
        if (!merge) {
          applying = true;
          try {
            scanTrackedKeys().forEach(function (k) { origRemove.call(localStorage, k); });
            origRemove.call(localStorage, META_KEY);
          } finally { applying = false; }
          wiped = true;
        }
      }
      origSet.call(localStorage, UID_KEY, currentUser.uid);
    } catch (e) {}
    return wiped;
  }

  function runInitialSync(source) {
    var wiped = guardAccountSwitch();
    return syncCore().then(function (changed) {
      retryMs = 5000;
      markReady();
      if (wiped) { reloadForSync(); return; }
      notifyApplied(changed, source);
    }, function (err) {
      markReady();
      handleSyncError(err);
    });
  }

  /* ------------------------------------------------------------------
     Pushing local changes
     ------------------------------------------------------------------ */
  function schedulePush() {
    if (!currentUser) return;
    clearTimeout(pushTimer);
    setStatus("wait", "Saving\u2026");
    pushTimer = setTimeout(function () { runSync("push"); }, SAVE_DEBOUNCE);
  }

  Storage.prototype.setItem = function (key, value) {
    if (reloading && this === window.localStorage) return;
    origSet.apply(this, arguments);
    if (this !== window.localStorage || applying) return;
    try {
      if (isTrackedKey(key, String(value))) { markWrite(key); schedulePush(); }
    } catch (e) {}
  };
  Storage.prototype.removeItem = function (key) {
    if (reloading && this === window.localStorage) return;
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

  /* ------------------------------------------------------------------
     When to talk to the cloud besides saves
     ------------------------------------------------------------------ */
  function pullSoon() {
    if (!currentUser || !initialDone || reloading) return;
    var t = Date.now();
    if (t - lastPull < PULL_THROTTLE) return;
    lastPull = t;
    runSync("pull");
  }

  document.addEventListener("visibilitychange", function () {
    if (!currentUser) return;
    if (document.hidden) {
      /* leaving this tab/app: push right away (after the page's own
         visibility handler has saved its state) */
      setTimeout(function () {
        if (dirty) { clearTimeout(pushTimer); runSync("push"); }
      }, 60);
    } else {
      pullSoon();
    }
  });
  window.addEventListener("focus", pullSoon);
  window.addEventListener("online", function () {
    if (currentUser && initialDone) { retryMs = 5000; runSync("pull"); }
  });

  function whenReady(ms) {
    usedReady = true;
    if (initialDone) return Promise.resolve();
    var wait = Math.max(ms || 0, 1000);
    if (hintState() !== "0") wait = Math.max(wait, READY_SIGNED_IN_WAIT);
    return Promise.race([
      readyPromise,
      new Promise(function (r) {
        setTimeout(function () { if (!initialDone) readyTimedOut = true; r(); }, wait);
      })
    ]);
  }

  function syncNow() { return runSync("manual"); }

  /* ------------------------------------------------------------------
     Auth actions
     ------------------------------------------------------------------ */
  function signInGoogle() {
    var provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return firebaseAuth.signInWithPopup(provider);
  }
  function signOut() { return firebaseReady ? firebaseAuth.signOut() : Promise.resolve(); }

  var AUTH_MSG = {
    "auth/popup-closed-by-user":    "The sign-in window was closed before finishing.",
    "auth/cancelled-popup-request": "Another sign-in window was already open.",
    "auth/popup-blocked":           "Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.",
    "auth/unauthorized-domain":     "This website address is not allowed in Firebase yet (Authentication \u2192 Settings \u2192 Authorized domains).",
    "auth/invalid-credential":      "Wrong email or password.",
    "auth/wrong-password":          "Wrong email or password.",
    "auth/user-not-found":          "No account with this email \u2014 tap Create account.",
    "auth/email-already-in-use":    "This email already has an account \u2014 tap Sign in.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/invalid-email":           "That email address does not look right.",
    "auth/network-request-failed":  "No internet connection.",
    "auth/too-many-requests":       "Too many attempts. Wait a minute and try again."
  };
  function authMsg(e) { return AUTH_MSG[e && e.code] || (e && e.message) || "Something went wrong."; }

  /* ------------------------------------------------------------------
     Sign-in / account window
     ------------------------------------------------------------------ */
  var BTN  = "font:700 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1px solid #dde4ee;background:#fff;color:#16223a;cursor:pointer";
  var BTNP = "font:700 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1px solid #0b5d63;background:#0b5d63;color:#fff;cursor:pointer";
  var INP  = "width:100%;box-sizing:border-box;font:15px system-ui,sans-serif;padding:10px 12px;border:1px solid #dde4ee;border-radius:10px;margin-bottom:8px";

  function closeModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  function setBusy(card, busy) {
    var els = card.querySelectorAll("button,input");
    for (var i = 0; i < els.length; i++) els[i].disabled = busy;
  }

  function openModal() {
    if (!ENABLE_FIREBASE) { window.alert("Cloud sync is not configured."); return; }
    if (!document.body) return;
    closeModal();
    modalEl = document.createElement("div");
    modalEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99990;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Segoe UI',system-ui,sans-serif";
    modalEl.addEventListener("click", function (e) { if (e.target === modalEl) closeModal(); });
    var card = document.createElement("div");
    card.style.cssText = "background:#fff;color:#16223a;border-radius:16px;max-width:380px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-height:90vh;overflow:auto";
    card.textContent = "Loading\u2026";
    modalEl.appendChild(card);
    document.body.appendChild(modalEl);

    loadFirebaseSDK().then(function () {
      if (modalEl && card.parentNode === modalEl) renderModal(card);
    }, function () {
      card.innerHTML = '<p style="margin:0 0 12px">Could not load sign-in. Check your internet connection and try again.</p>' +
        '<button type="button" id="kpscClose" style="' + BTN + '">Close</button>';
      card.querySelector("#kpscClose").onclick = closeModal;
    });
  }

  function renderModal(card) {
    if (currentUser) renderSignedIn(card); else renderSignedOut(card);
  }

  function renderSignedIn(card) {
    card.innerHTML =
      '<h3 style="margin:0 0 8px;font-size:1.1rem">\u2601 Cloud sync is on</h3>' +
      '<p style="margin:0 0 4px;font-size:.92rem">Signed in as <b id="kpscEmail"></b></p>' +
      '<p style="margin:0 0 10px;font-size:.78rem;color:#5b6b85">Account ID \u2026<span id="kpscUid"></span> \u2014 sign in with this same account on every device.</p>' +
      '<p id="kpscSt" style="margin:0 0 14px;font-size:.84rem;color:#5b6b85"></p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" id="kpscNow" style="' + BTNP + '">Sync now</button>' +
        '<button type="button" id="kpscOut" style="' + BTN + '">Sign out</button>' +
        '<button type="button" id="kpscClose" style="' + BTN + '">Close</button>' +
      '</div>';
    card.querySelector("#kpscEmail").textContent = currentUser.email || "(no email)";
    card.querySelector("#kpscUid").textContent = String(currentUser.uid || "").slice(-6);
    card.querySelector("#kpscSt").textContent = status.msg;
    card.querySelector("#kpscClose").onclick = closeModal;
    card.querySelector("#kpscNow").onclick = function () { setStatus("wait", "Syncing\u2026"); syncNow(); };
    card.querySelector("#kpscOut").onclick = function () { signOut().then(closeModal); };
  }

  function renderSignedOut(card) {
    card.innerHTML =
      '<h3 style="margin:0 0 6px;font-size:1.1rem">\u2601 Sign in to sync</h3>' +
      '<p style="margin:0 0 12px;font-size:.84rem;color:#5b6b85">Use the same account on your phone and PC to continue where you stopped.</p>' +
      '<button type="button" id="kpscG" style="' + BTNP + ';width:100%;margin-bottom:10px">Continue with Google</button>' +
      '<div style="text-align:center;margin:4px 0 10px;color:#5b6b85;font-size:.8rem">or with email</div>' +
      '<input id="kpscMail" type="email" placeholder="Email" autocomplete="email" style="' + INP + '">' +
      '<input id="kpscPw" type="password" placeholder="Password (6+ characters)" autocomplete="current-password" style="' + INP + '">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button type="button" id="kpscIn" style="' + BTN + ';flex:1">Sign in</button>' +
        '<button type="button" id="kpscUp" style="' + BTN + ';flex:1">Create account</button>' +
      '</div>' +
      '<a href="#" id="kpscReset" style="font-size:.82rem;color:#128a8f">Forgot password?</a>' +
      '<p id="kpscMsg" style="margin:10px 0 0;font-size:.84rem;min-height:1.2em"></p>' +
      '<div style="margin-top:10px;text-align:right"><button type="button" id="kpscClose" style="' + BTN + '">Close</button></div>';

    var msgEl = card.querySelector("#kpscMsg");
    var mail = card.querySelector("#kpscMail"), pw = card.querySelector("#kpscPw");
    function say(t, good) { msgEl.style.color = good ? "#177a3d" : "#c5221f"; msgEl.textContent = t || ""; }
    function run(p) {
      say("");
      setBusy(card, true);
      return p.catch(function (e) { say(authMsg(e)); }).then(function () { setBusy(card, false); });
    }

    card.querySelector("#kpscClose").onclick = closeModal;
    card.querySelector("#kpscG").onclick  = function () { run(signInGoogle()); };
    card.querySelector("#kpscIn").onclick = function () {
      run(firebaseAuth.signInWithEmailAndPassword(mail.value.trim(), pw.value));
    };
    card.querySelector("#kpscUp").onclick = function () {
      run(firebaseAuth.createUserWithEmailAndPassword(mail.value.trim(), pw.value));
    };
    card.querySelector("#kpscReset").onclick = function (e) {
      e.preventDefault();
      var m = mail.value.trim();
      if (!m) { say("Type your email above first."); return; }
      run(firebaseAuth.sendPasswordResetEmail(m).then(function () { say("Password-reset email sent.", true); }));
    };
  }

  /* ------------------------------------------------------------------
     Start
     ------------------------------------------------------------------ */
  function init() {
    if (!ENABLE_FIREBASE) { markReady(); emitAuth(); return; }
    if (hintState() === "0") {
      /* known signed-out browser: nothing to wait for, SDK loads only
         when the user opens the sign-in window */
      markReady();
      emitAuth();
    } else {
      loadFirebaseSDK().catch(function () {});
    }
  }

  onDomReady(ensurePill);
  init();
  setTimeout(function () {
    if (!initialDone) { readyTimedOut = true; markReady(); }
  }, READY_HARD_CAP);

  window.KPSC_Sync = {
    open: openModal,
    isConnected: function () { return !!currentUser; },
    getCurrentUser: function () { return currentUser ? { email: currentUser.email, uid: currentUser.uid } : null; },
    whenReady: whenReady,
    syncNow: syncNow,
    signOut: signOut,
    getStatus: function () { return { kind: status.kind, msg: status.msg }; }
  };
})();
