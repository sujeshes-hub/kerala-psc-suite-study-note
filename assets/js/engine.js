/* =====================================================================
   Auto-load sync.js site-wide (used by topic pages and mock tests)
   ===================================================================== */
(function () {
  if (window.KPSC_Sync) return;
  if (document.querySelector('script[data-kpsc-sync]')) return;

  var prefix = "";
  var scripts = document.querySelectorAll('script[src]');
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].getAttribute('src') || "";
    var m = src.match(/^(.*?)assets\/js\//);
    if (m) { prefix = m[1]; break; }
  }
  if (!prefix) {
    var p = location.pathname.replace(/\\/g, "/");
    var depth = 0;
    if (/\/question-papers\//.test(p)) depth = 2;
    else if (/\/topics\//.test(p))     depth = 2;
    else if (/\/chapters\//.test(p))   depth = 2;
    else if (/\/mock-tests\//.test(p)) depth = 1;
    else if (/\/subjects\//.test(p))   depth = 1;
    prefix = new Array(depth + 1).join("../");
  }

  var s = document.createElement("script");
  s.src = prefix + "assets/js/sync.js";
  s.setAttribute("data-kpsc-sync", "1");
  document.head.appendChild(s);
})();