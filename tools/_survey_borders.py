import os
import re
from collections import Counter

ROOT = r"H:\kerala-psc-suite\kerala-psc-suite\topics"

STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
# widths used on the actual `border` / `border-*` shorthands
WIDTH = re.compile(r"border(?:-(?:top|right|bottom|left))?\s*:\s*([^;{}]+)")
RADIUS = re.compile(r"border-radius\s*:\s*([^;{}]+)")

widths = Counter()
radii = Counter()
files = 0
css_variants = Counter()

for dp, dn, fn in os.walk(ROOT):
    for f in sorted(fn):
        if not f.lower().endswith(".html"):
            continue
        files += 1
        txt = open(os.path.join(dp, f), encoding="utf-8", errors="replace").read()
        m = STYLE.search(txt)
        if not m:
            widths["<no style block>"] += 1
            continue
        css = m.group(1)
        css_variants[len(css)] += 1
        for decl in WIDTH.findall(css):
            decl = decl.strip()
            if decl.startswith("none") or decl.startswith("0") or decl.startswith("collapse"):
                continue
            widths[decl] += 1
        for decl in RADIUS.findall(css):
            radii[decl.strip()] += 1

print("topic files:", files)
print("\n--- border shorthand values (top 30) ---")
for k, v in widths.most_common(30):
    print("%5dx  %s" % (v, k))
print("\n--- border-radius values (top 20) ---")
for k, v in radii.most_common(20):
    print("%5dx  %s" % (v, k))
print("\n--- distinct style lengths (top 10) ---")
for k, v in css_variants.most_common(10):
    print("%5dx  len=%d" % (v, k))
