/* =====================================================================
   Kerala PSC Study Suite — Progress reader + back button
   Paths: assets/js/sections.js
   Used by : index.html, subjects/*.html, chapters/**/*.html
   ===================================================================== */
(function () {
  "use strict";

  var SUMMARY_KEY = "kpsc_summaries_v1";

  /* -------- Progress reader -------- */
  function readSummaries() {
    try {
      return JSON.parse(localStorage.getItem(SUMMARY_KEY) || "{}");
    } catch (e) {
      console.warn("sections.js: could not parse summaries", e);
      return {};
    }
  }

  function updateCard(card) {
    var key = card.dataset.part;
    if (!key) return;

    var sum = readSummaries()[key];

    var barEl    = card.querySelector(".bar i");
    var statusEl = card.querySelector(".progressline .status") || card.querySelector(".status");
    var scoreEl  = card.querySelector(".progressline .score")  || card.querySelector(".score");

    if (!barEl) return;

    if (!sum || !sum.total) {
      if (statusEl) statusEl.textContent = "Not started";
      if (scoreEl)  scoreEl.textContent  = "";
      barEl.style.width = "0%";
      return;
    }

    var total     = sum.total || 0;
    var attempted = sum.attempted || 0;
    var correct   = sum.correct || 0;
    var wrong     = sum.wrong || 0;
    var net       = sum.net || 0;
    var pct = total ? (attempted / total) * 100 : 0;

    barEl.style.width = pct.toFixed(1) + "%";
    if (statusEl) statusEl.textContent = attempted + " / " + total + " attempted";
    if (scoreEl)  scoreEl.textContent  = "Net: " + Number(net).toFixed(2) + "  ✓ " + correct + "  ✗ " + wrong;
  }

  function updateSummary() {
    var sums = readSummaries();
    var cards = document.querySelectorAll(".card[data-part]");

    var partsAttempted = 0, total = 0, att = 0, cor = 0, wr = 0, net = 0;

    cards.forEach(function (card) {
      var s = sums[card.dataset.part];
      if (!s) return;
      if ((s.attempted || 0) > 0) partsAttempted++;
      total += s.total || 0;
      att   += s.attempted || 0;
      cor   += s.correct || 0;
      wr    += s.wrong || 0;
      net   += s.net || 0;
    });

    var $id = function (id) { return document.getElementById(id); };
    if ($id("sumParts")) $id("sumParts").textContent = partsAttempted;
    if ($id("sumTotal")) $id("sumTotal").textContent = total;
    if ($id("sumAtt"))   $id("sumAtt").textContent   = att;
    if ($id("sumCor"))   $id("sumCor").textContent   = cor;
    if ($id("sumWr"))    $id("sumWr").textContent    = wr;
    if ($id("sumNet"))   $id("sumNet").textContent   = Number(net).toFixed(2);
  }

  function updateAll() {
    document.querySelectorAll(".card[data-part]").forEach(updateCard);
    updateSummary();
  }

  function resetAll() {
    if (!confirm("Delete ALL saved progress across every part? This cannot be undone.")) return;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.indexOf("kpsc_summaries_") === 0 || k.indexOf("kpsc_mock_") === 0)) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    updateAll();
    alert("All progress has been reset.");
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

  /* -------- Init -------- */
  function init() {
    updateAll();

    var refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn && !refreshBtn.dataset.kpscBound) {
      refreshBtn.dataset.kpscBound = "1";
      refreshBtn.addEventListener("click", updateAll);
    }
    var resetBtn = document.getElementById("resetAllBtn");
    if (resetBtn && !resetBtn.dataset.kpscBound) {
      resetBtn.dataset.kpscBound = "1";
      resetBtn.addEventListener("click", resetAll);
    }

    tryInjectBack();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.addEventListener("focus", updateAll);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) updateAll();
  });

  window.KPSC_Progress = {
    refresh: updateAll,
    reset: resetAll
  };
})();