/* =====================================================================
   Auto-load revision-notes button on subjects/NN-*.html pages
   ===================================================================== */
(function () {
  if (document.querySelector('script[data-kpsc-revision-loader]')) return;

  var p = location.pathname.replace(/\\/g, "/");
  if (!/\/subjects\/\d{2}-[a-z0-9-]+\.html$/i.test(p)) return;

  var prefix = "";
  var scripts = document.querySelectorAll('script[src]');
  for (var i = 0; i < scripts.length; i++) {
    var m = (scripts[i].getAttribute("src") || "").match(/^(.*?)assets\/js\//);
    if (m) { prefix = m[1]; break; }
  }
  if (!prefix) {
    var depth = 0;
    if (/\/subjects\//.test(p)) depth = 1;
    prefix = new Array(depth + 1).join("../");
  }

  var s = document.createElement("script");
  s.src = prefix + "assets/js/revision-loader.js";
  s.setAttribute("data-kpsc-revision-loader", "1");
  document.head.appendChild(s);
})();