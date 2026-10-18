/* =====================================================================
   Auto-load sync.js site-wide (used by topic pages and mock tests)
   Path: assets/js/engine.js
   NOTE: for pages that must wait for the cloud pull before starting
   (mock tests), use the blocking snippet in the page <head> instead —
   see the comment at the bottom of this file.
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
    if (/\/question-papers\//.test(p)) depth = 1;      /* was 2 — wrong: question-papers/x.html is 1 level deep */
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

/* ---------------------------------------------------------------------
   BLOCKING LOADER (paste inside <head> of any page, any folder depth):

   <script>(function(){var p=location.pathname.replace(/\\/g,"/"),
   m=p.match(/^(.*?\/)(?:topics|chapters|question-papers|mock-tests|subjects)\//),
   b=m?m[1]:p.replace(/[^\/]*$/,"");
   if(!window.KPSC_Sync)document.write('<script src="'+b+'assets/js/sync.js"><\/script>');})();</script>
   --------------------------------------------------------------------- */
