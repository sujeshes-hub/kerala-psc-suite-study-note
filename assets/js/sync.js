/* =====================================================================
   Kerala PSC Study Suite — Real-Time Cloud Sync
   Path: assets/js/sync.js
   Version: 7.0 - Adds onSnapshot (Google Sheets style live sync)
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

  var PREFIX         = "KPS1.";
  var APP_ID         = "kerala-psc-suite";
  var TOKEN_KEY      = "kpsc_gh_token";
  var GIST_KEY       = "kpsc_gh_gist_id";
  var LASTS_KEY      = "kpsc_last_sync";
  var LASTREMOTE_KEY = "__kpsc_lastRemoteTs";
  var GIST_FILE      = "kerala-psc-progress.json";
  var FIRESTORE_COL  = "users";
  var SAVE_DEBOUNCE  = 1200; // Wait 1.2s after typing before pushing

  var SKIP_KEYS = {
    "kpsc_gh_token": 1, "kpsc_gh_gist_id": 1,
    "kpsc_last_sync": 1, "kp-theme": 1
  };

  var firebaseApp = null, firebaseAuth = null, firestoreDb = null;
  var firebaseReady = false, currentUser = null;
  var unsubscribeFirestore = null; // For real-time listener
  var pushing = false, pushQueued = false, pushTimer = null;
  var applyingPayload = false;

  function isTrackedKey(k, v) {
    if (!k || typeof k !== "string") return false;
    if (SKIP_KEYS[k]) return false;
    if (k.indexOf("__") === 0) return false;
    if (k.indexOf("kpsc_qr_cache") === 0) return false;
    if (k.indexOf("firebase") === 0) return false;
    if (k.indexOf("kpsc_") === 0)  return true;
    if (k.indexOf("kerala") === 0) return true;
    if (k.indexOf("quiz") === 0)   return true;
    if (k.indexOf("mock") === 0)   return true;
    if (typeof v === "string" && v.length > 8) {
      var first = v.charAt(0);
      if (first === "{" || first === "[") {
        try { var p = JSON.parse(v); return p && typeof p === "object"; }
        catch (e) { return false; }
      }
    }
    return false;
  }

  function scanTrackedKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && isTrackedKey(k, localStorage.getItem(k))) out.push(k);
    }
    return out;
  }

  function collectPayload() {
    var keys = scanTrackedKeys();
    var stores = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      try { stores[k] = JSON.parse(localStorage.getItem(k)); }
      catch (e) { try { stores[k] = localStorage.getItem(k); } catch (e2) {} }
    }
    return { v: 2, ts: Date.now(), app: APP_ID, stores: stores };
  }

  function deepMerge(local, remote) {
    if (typeof local !== typeof remote) return remote;
    if (local === null || remote === null) return remote;
    if (typeof local !== "object") return remote;

    if (Array.isArray(local) || Array.isArray(remote)) {
      if (!Array.isArray(local)) return remote;
      if (!Array.isArray(remote)) return local;
      var len = Math.max(local.length, remote.length);
      var mergedArr = new Array(len);
      for (var i = 0; i < len; i++) {
        var l = local[i], r = remote[i];
        if (r === undefined) mergedArr[i] = l;
        else if (l === undefined) mergedArr[i] = r;
        else if (typeof l === "object" && typeof r === "object" && l && r) mergedArr[i] = deepMerge(l, r);
        else mergedArr[i] = r;
      }
      return mergedArr;
    }

    var out = {}, k;
    for (k in local) if (Object.prototype.hasOwnProperty.call(local, k)) out[k] = local[k];
    for (k in remote) if (Object.prototype.hasOwnProperty.call(remote, k)) {
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = deepMerge(out[k], remote[k]);
      else out[k] = remote[k];
    }
    return out;
  }

  function applyPayload(payload, opts) {
    opts = opts || {};
    var force = !!opts.force;
    var remoteTs = Number(payload && payload.ts) || 0;
    var lastRemoteTs = Number(localStorage.getItem(LASTREMOTE_KEY) || 0);
    
    // If remote is newer, we MUST overwrite local
    var shouldForce = force || remoteTs > lastRemoteTs;

    var added = 0, changed = 0;
    applyingPayload = true;
    try {
      if (payload.stores && typeof payload.stores === "object") {
        Object.keys(payload.stores).forEach(function (k) {
          if (SKIP_KEYS[k] || k.indexOf("kpsc_qr_cache") === 0 || k.indexOf("__") === 0) return;
          var remote = payload.stores[k];
          var localRaw = localStorage.getItem(k);

          if (localRaw === null) {
            try { localStorage.setItem(k, JSON.stringify(remote)); added++; } catch (e) {}
            return;
          }

          var local;
          try { local = JSON.parse(localRaw); } catch (e) {
            try { localStorage.setItem(k, JSON.stringify(remote)); changed++; } catch (e2) {}
            return;
          }

          var merged = shouldForce ? remote : deepMerge(local, remote);
          try {
            var str = JSON.stringify(merged);
            if (str !== localRaw) {
              localStorage.setItem(k, str);
              changed++;
            }
          } catch (e) {}
        });
      }

      if (remoteTs > 0) {
        localStorage.setItem(LASTREMOTE_KEY, String(remoteTs));
      }
    } finally {
      applyingPayload = false;
    }

    return { totalChanged: added + changed };
  }

  function loadFirebaseSDK() {
    if (!ENABLE_FIREBASE) return Promise.reject("Firebase disabled");
    if (window.firebase) return Promise.resolve();

    return new Promise(function (resolve, reject) {
      var base = "https://www.gstatic.com/firebasejs/10.12.0/";
      var files = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
      var loaded = 0;
      files.forEach(function (f) {
        var s = document.createElement("script");
        s.src = base + f;
        s.onload = function () { loaded++; if (loaded === files.length) resolve(); };
        s.onerror = function () { reject("Failed to load Firebase"); };
        document.head.appendChild(s);
      });
    }).then(function () {
      firebaseApp  = window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseAuth = window.firebase.auth();
      firestoreDb  = window.firebase.firestore();
      try { firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      firebaseReady = true;

      return new Promise(function (resolve) {
        firebaseAuth.onAuthStateChanged(function (user) {
          currentUser = user;
          updateAccountUI();
          
          if (user) {
            startRealTimeSync();
            window.dispatchEvent(new Event("kpsc-auth-changed"));
          } else {
            stopRealTimeSync();
            window.dispatchEvent(new Event("kpsc-auth-changed"));
          }
          resolve(user);
        });
      });
    });
  }

  /* =================================================================
     REAL-TIME LISTENER (Google Sheets style)
     ================================================================= */
  function startRealTimeSync() {
    if (!firebaseReady || !currentUser) return;
    if (unsubscribeFirestore) unsubscribeFirestore(); // clear old listener

    // Listen to the user's document live
    unsubscribeFirestore = firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid)
      .onSnapshot(function (doc) {
        if (!doc.exists) {
          // New user / empty cloud. Push local data up.
          schedulePush();
          return;
        }
        
        var remote = doc.data();
        if (!remote || !remote.stores) return;

        // Ignore if this update was our own push (timestamps match)
        var remoteTs = Number(remote.ts) || 0;
        var lastRemoteTs = Number(localStorage.getItem(LASTREMOTE_KEY) || 0);
        if (remoteTs <= lastRemoteTs) return;

        // Apply remote changes
        var res = applyPayload(remote);
        
        if (res.totalChanged > 0) {
          // Tell the page to update its UI without a hard refresh
          window.dispatchEvent(new Event("kpsc-data-updated"));
          
          // Optional: soft reload if the page relies on deep state (like a quiz)
          if (typeof window.updateProgressBars === 'function') {
             window.updateProgressBars();
          } else {
             // If we don't know how to update the UI, just reload after a tiny delay
             console.log("New data from cloud applied. Reloading...");
             setTimeout(function(){ location.reload(); }, 500);
          }
        }
      }, function (error) {
        console.error("Firestore Listen Error:", error);
        showBanner("error", "Sync error: " + error.message + ". Check Firestore Rules.");
      });
  }

  function stopRealTimeSync() {
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
    }
  }

  /* =================================================================
     PUSH CHANGES TO CLOUD
     ================================================================= */
  function firebasePush() {
    if (!firebaseReady || !currentUser) return Promise.resolve(false);
    if (pushing) { pushQueued = true; return Promise.resolve(false); }
    
    pushing = true;
    var payload = collectPayload();
    payload.uid = currentUser.uid;
    payload.email = currentUser.email || "";

    return firestoreDb.collection(FIRESTORE_COL).doc(currentUser.uid).set(payload)
      .then(function () {
        localStorage.setItem(LASTS_KEY, String(Date.now()));
        updateStatusUI("ok", "Synced just now");
        pushDone();
        return true;
      })
      .catch(function (err) {
        pushDone();
        showBanner("error", "Write denied. Fix Firestore Rules. (" + err.message + ")");
        throw err;
      });
  }

  function schedulePush() {
    if (!currentUser) return;
    clearTimeout(pushTimer);
    updateStatusUI("wait", "Saving...");
    pushTimer = setTimeout(function () {
      firebasePush().catch(function(e){});
    }, SAVE_DEBOUNCE);
  }

  function pushDone() {
    pushing = false;
    if (pushQueued) { pushQueued = false; schedulePush(); }
  }

  // Intercept localStorage to trigger auto-save when user changes answers
  (function interceptSetItem() {
    var orig = localStorage.setItem;
    localStorage.setItem = function (key, value) {
      orig.apply(localStorage, arguments);
      if (applyingPayload) return; // Don't push if we just received this from cloud
      try {
        if (isTrackedKey(key, value)) schedulePush();
      } catch (e) {}
    };
  })();

  function showBanner(kind, msg) {
    var b = document.getElementById("kpscSyncBanner");
    if (!b) {
      b = document.createElement("div");
      b.id = "kpscSyncBanner";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;background:#fdecea;color:#c5221f;padding:10px;text-align:center;font-weight:bold;z-index:99999;font-family:sans-serif;border-bottom:2px solid #c5221f;";
      document.body.appendChild(b);
    }
    b.innerHTML = "⚠️ " + msg + ' <button onclick="this.parentNode.style.display=\'none\'" style="margin-left:20px;cursor:pointer;border:none;background:none;font-weight:bold;color:#c5221f;">✕</button>';
    b.style.display = "block";
  }

  function updateStatusUI(kind, msg) {
    var btn = document.querySelector(".kpsc-sync-btn");
    if (btn) {
      btn.classList.remove("connected", "saving");
      if (kind === "wait") btn.classList.add("saving");
      if (kind === "ok") btn.classList.add("connected");
    }
  }

  function updateAccountUI() {
    var isLogged = !!currentUser;
    window.dispatchEvent(new Event("kpsc-auth-changed"));
  }

  // Init
  function init() {
    if (ENABLE_FIREBASE) {
      loadFirebaseSDK().catch(function(e){ console.log(e); });
    }
    
    var btn = document.createElement("button");
    btn.className = "kpsc-sync-btn";
    btn.innerHTML = "☁️ Cloud Sync";
    btn.onclick = function() {
      if (!currentUser) {
        loadFirebaseSDK().then(function(){
          var provider = new window.firebase.auth.GoogleAuthProvider();
          firebaseAuth.signInWithPopup(provider);
        });
      } else {
        if (confirm("Sign out?")) firebaseAuth.signOut();
      }
    };
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose API for index.html banner
  window.KPSC_Sync = {
    isConnected: function() { return !!currentUser; },
    getCurrentUser: function() {
      if (!currentUser) return null;
      return { email: currentUser.email, displayName: currentUser.displayName };
    }
  };
})();