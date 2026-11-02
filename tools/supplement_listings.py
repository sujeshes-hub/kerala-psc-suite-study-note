#!/usr/bin/env python3
"""
Kerala PSC Study Suite — keep the mock-test listings fresh.

The listing pages render from the generated `question-papers/<folder>/list.js`
manifest, which is what makes them work offline and avoids downloading every
paper on each visit.  The trade-off: a paper copied into the folder *after* the
manifest was built stays invisible until someone rebuilds.

This patcher gives each listing page a `supplement()` step:

    render(manifest)                  -> instant, works offline / file://
    then ask the GitHub contents API  -> if it reports files the manifest does
                                         not know, fetch only those and re-render

On a static host with no API (file://, local server, rate limit) the API call
throws and is ignored, so the manifest list simply stands.

Run it once; it is idempotent (a page that already has supplement() is skipped).
`python tools/build_content.py` still refreshes the manifest itself.
"""
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGES = [
    # page, manifest global, container variable, extra field for render()
    ("mock-tests/573.html", "MOCK_TESTS_573", "grid", False),
    ("mock-tests/883.html", "MOCK_TESTS_883", "grid", False),
    ("mock-tests/subjects.html", "MOCK_TESTS_SUBJECTS", "host", True),
]

TAG_EXPR = {
    False: "m.tag || EXAM_CODE",
    True: 'm.tag || "BOTH"',
}


def supplement_source(var, with_subject):
    extra = ""
    if with_subject:
        extra = '\n          subject: m.subject || "Uncategorised",'
    return f'''
  /* ------------------------------------------------------------------
     The manifest is the offline source of truth.  A paper dropped into
     the folder afterwards is not in it yet, so ask the host for the
     folder listing and fold in anything the manifest does not know.
     Not on GitHub Pages (file://, local server) -> the call throws and
     the manifest list stands unchanged.
     ------------------------------------------------------------------ */
  var supplementTried = false;
  async function supplement(local) {{
    if (supplementTried || !local.length) return;
    supplementTried = true;
    try {{
      var files = await fetchFolderList();
      var known = {{}};
      local.forEach(function (p) {{ known[p.file] = 1; }});
      var extra = files.filter(function (f) {{ return !known[f.name]; }});
      if (!extra.length) return;

      var metas = await Promise.all(extra.map(function (f) {{ return readMeta(f.name); }}));
      var merged = local.concat(extra.map(function (f, i) {{
        var m = metas[i] || {{}};
        return {{
          file: f.name,
          title: m.title,
          titleMl: m.titleMl,
          desc: m.desc,
          duration: m.duration,
          qs: m.qs,
          key: m.key,{extra}
          tag: {TAG_EXPR[with_subject]}
        }};
      }}));
      merged.sort(function (a, b) {{ return a.file.localeCompare(b.file); }});
      render(merged);
    }} catch (e) {{ /* offline or no folder listing available */ }}
  }}

'''


def patch(rel, var, grid, with_subject):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return "missing"
    with open(path, "r", encoding="utf-8", newline="") as fh:
        text = original = fh.read()
    if "function supplement(" in text:
        return "already patched"

    anchor = "  async function load(force) {"
    if anchor not in text:
        return "anchor not found"
    text = text.replace(anchor, supplement_source(var, with_subject) + anchor, 1)

    guard = (f"    var local_{var} = window.{var};\n"
             f"    if (local_{var} && local_{var}.length) {{ render(local_{var}); return; }}\n")
    if guard not in text:
        return "guard not found"
    replacement = (f"    var local_{var} = window.{var};\n"
                   f"    if (local_{var} && local_{var}.length) {{\n"
                   f"      render(local_{var});\n"
                   f"      await supplement(local_{var});\n"
                   f"      return;\n"
                   f"    }}\n")
    text = text.replace(guard, replacement, 1)

    # render() re-appends sections.js; with a second render that would double it.
    tail = ('    var s = document.createElement("script");\n'
            '    s.src = "../assets/js/sections.js";\n'
            '    document.body.appendChild(s);\n')
    guarded = ('    if (!window.__kpscSectionsLoaded) {\n'
               '      window.__kpscSectionsLoaded = true;\n'
               '      var s = document.createElement("script");\n'
               '      s.src = "../assets/js/sections.js";\n'
               '      document.body.appendChild(s);\n'
               '    }\n')
    if tail in text:
        text = text.replace(tail, guarded, 1)

    if text == original:
        return "no change"
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return "patched"


def main():
    print("Mock-test listing supplement")
    print("-" * 52)
    worst = 0
    for rel, var, grid, with_subject in PAGES:
        result = patch(rel, var, grid, with_subject)
        print(f"  {rel:<28} {result}")
        if result in ("missing", "anchor not found", "guard not found"):
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
