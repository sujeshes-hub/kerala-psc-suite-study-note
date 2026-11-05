#!/usr/bin/env python3
"""One-off spot fixes left after the math sweep."""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"H:\kerala-psc-suite\kerala-psc-suite"
APPLY = "--apply" in sys.argv

EDITS = [
    # a fraction was wrongly built out of "\\frac, \\times" inside prose
    ("topics/arithmetic/11.11-average.html",
     'LaTeX കോഡ് (<span class="kfrac"><span class="kfnum">,</span><span class="kfden">×</span></span>) വായനയ്ക്ക് തടസ്സം',
     "LaTeX കോഡുകൾ വായനയ്ക്ക് തടസ്സം"),
    # SVG <text> cannot hold <sup>: use Unicode superscripts instead
    ("topics/arithmetic/11.12-exponents.html",
     '>a^m × aⁿ = a^(m+n)<', '>aᵐ × aⁿ = a⁽ᵐ⁺ⁿ⁾<'),
    ("topics/arithmetic/11.12-exponents.html",
     '>a^m ÷ aⁿ = a^(m−n)<', '>aᵐ ÷ aⁿ = a⁽ᵐ⁻ⁿ⁾<'),
    ("topics/arithmetic/11.12-exponents.html",
     '>(a^m)^n = a^(mn)<', '>(aᵐ)ⁿ = a⁽ᵐⁿ⁾<'),
]

changed = 0
for rel, old, new in EDITS:
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        text = fh.read()
    if old not in text:
        print(f"  MISS  {rel}: {old[:50]}")
        continue
    text = text.replace(old, new)
    if APPLY:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    changed += 1
    print(f"  {'fixed' if APPLY else 'would fix'}  {rel}: {new[:46]}")

print(f"edits applied: {changed} / {len(EDITS)}")
