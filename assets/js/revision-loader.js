/* =====================================================================
   Kerala PSC Study Suite — Revision Notes button auto-loader
   Injects "📘 Revision Notes" on subjects/NN-name.html pages.
   Hides itself automatically if NN-name-revision.html doesn't exist.
   ===================================================================== */
(function () {
  "use strict";

  var path = location.pathname.replace(/\\/g, "/");
  var file = path.split("/").pop();

  /* Only run on subjects/NN-name.html — not on index, not on revision pages */
  if (!/^\d{2}-[a-z0-9-]+\.html$/i.test(file)) return;
  if (/-revision\.html$/i.test(file)) return;

  var base    = file.replace(/\.html$/i, "");      // 01-history
  var revFile = base + "-revision.html";           // 01-history-revision.html

  var isLive = /\.github\.io$/i.test(location.hostname) ||
               /^https?:$/i.test(location.protocol);

  if (isLive) {
    /* Probe the revision file — only inject if it exists */
    fetch(revFile, { method: "HEAD" })
      .then(function (r) { if (r.ok) inject(revFile); })
      .catch(function () { inject(revFile); });
  } else {
    /* file:// or unknown — inject anyway */
    inject(revFile);
  }

  function inject(href) {
    if (document.getElementById("revisionBtn")) return;

    var btn = document.createElement("a");
    btn.id = "revisionBtn";
    btn.href = href;
    btn.innerHTML = "📘 Revision Notes";
    btn.style.cssText =
      "display:inline-flex;align-items:center;gap:8px;" +
      "background:linear-gradient(135deg,#3b4cca,#7a3bcc);" +
      "color:#fff;padding:11px 20px;border-radius:999px;" +
      "text-decoration:none;font-family:'Noto Sans Malayalam','Segoe UI',system-ui,sans-serif;" +
      "font-weight:700;font-size:.92rem;letter-spacing:.3px;" +
      "box-shadow:0 4px 16px rgba(59,76,204,.35);" +
      "margin:14px 0 6px;transition:transform .15s,box-shadow .15s;";

    btn.addEventListener("mouseenter", function () {
      btn.style.transform = "translateY(-2px)";
      btn.style.boxShadow = "0 6px 20px rgba(59,76,204,.45)";
    });
    btn.addEventListener("mouseleave", function () {
      btn.style.transform = "translateY(0)";
      btn.style.boxShadow = "0 4px 16px rgba(59,76,204,.35)";
    });

    var main = document.querySelector("main");
    if (main) main.insertBefore(btn, main.firstChild);
    else document.body.insertBefore(btn, document.body.firstChild);
  }
})();