import importlib.util
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
spec = importlib.util.spec_from_file_location(
    "rb", r"H:\kerala-psc-suite\kerala-psc-suite\tools\reduce_borders.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

SAMPLES = [
    r"topics\history\1.1.1-europeans-in-kerala.html",
    r"topics\arithmetic\11.1-numbers.html",
    r"assets\css\app.css",
]

import os
for rel in SAMPLES:
    p = os.path.join(rb.ROOT, rel)
    if not os.path.isfile(p):
        print("missing", rel)
        continue
    before = rb.read(p)
    hits = Counter()
    after = rb.clamp(before, hits)
    bl = before.splitlines()
    al = after.splitlines()
    print("=" * 74)
    print(rel, "  lines", len(bl), "->", len(al), " replacements:", sum(hits.values()))
    shown = 0
    for i, (b, a) in enumerate(zip(bl, al)):
        if b != a and shown < 8:
            print("  L%-4d - %s" % (i + 1, b.strip()[:110]))
            print("        + %s" % a.strip()[:110])
            shown += 1
