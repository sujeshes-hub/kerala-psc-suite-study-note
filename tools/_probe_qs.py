import os
import re

ROOT = r"H:\kerala-psc-suite\kerala-psc-suite\question-papers"

COMPACT = re.compile(r'\{s:"')
LONG = re.compile(r'(?<![\w$])["\']?question["\']?\s*:')
HELPER = re.compile(r"\bq\(\s*['\"]")
TITLE = re.compile(r"<title>(.*?)</title>", re.S)

for dp, dn, fn in os.walk(ROOT):
    for f in sorted(fn):
        if not f.lower().endswith(".html"):
            continue
        p = os.path.join(dp, f)
        txt = open(p, encoding="utf-8", errors="replace").read()
        n = {"compact": len(COMPACT.findall(txt)), "long": len(LONG.findall(txt)),
             "helper": len(HELPER.findall(txt))}
        best = max(n.values())
        t = TITLE.search(txt)
        title = (t.group(1).strip()[:44] if t else "")
        flag = "" if best else "   <<< UNKNOWN"
        print("%-50s %-34s %-44s%s" % (
            os.path.relpath(p, ROOT).replace(os.sep, "/")[:50],
            {k: v for k, v in n.items() if v}, title, flag))
