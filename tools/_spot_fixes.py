#!/usr/bin/env python3
"""One-off spot fixes left after the math sweep (see README §6)."""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"H:\kerala-psc-suite\kerala-psc-suite"
APPLY = "--apply" in sys.argv

SUP = dict(zip("0123456789+-=()ni", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"))

EDITS = [
    # the replacement character destroyed the name Jefferson
    ("topics/history/1.3.2-american-war-independence.html",
     "ജെഫേഴ്സ\ufffdൺ", "ജെഫേഴ്സൺ"),
    # prose that quoted raw LaTeX as an example
    ("topics/arithmetic/11.11-average.html",
     "LaTeX കോഡ് (\\frac, \\times) വായനയ്ക്ക് തടസ്സം",
     "LaTeX കോഡുകൾ വായനയ്ക്ക് തടസ്സം"),
]

changed = []
for rel, old, new in EDITS:
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        text = fh.read()
    if old not in text:
        print(f"  skip  {rel}: pattern not found")
        continue
    text = text.replace(old, new)
    if APPLY:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    changed.append(rel)
    print(f"  {'fixed' if APPLY else 'would fix'}  {rel}")

# SVG text cannot hold <sup>, so map a^(m+n) to Unicode superscripts
svg_fixed = 0
for dp, dn, fn in os.walk(os.path.join(ROOT, "topics")):
    for name in fn:
        if not name.endswith(".html"):
            continue
        path = os.path.join(dp, name)
        with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
            text = fh.read()

        def repl(m):
            inner = m.group(2).strip()
            uni = "".join(SUP.get(c, "") for c in inner)
            if not uni or len(uni) != len(inner):
                return m.group(0)
            return m.group(1) + uni

        new = re.sub(r"(?<![\w$])([A-Za-z0-9\)\])\u00b2\u00b3])\^\(([^()]{1,12})\)", repl, text)
        if new != text:
            svg_fixed += 1
            if APPLY:
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(new)
            print(f"  {'fixed' if APPLY else 'would fix'}  {os.path.relpath(path, ROOT)} (^( ) exponent)")

print(f"\nfiles changed: {len(changed) + svg_fixed}")
