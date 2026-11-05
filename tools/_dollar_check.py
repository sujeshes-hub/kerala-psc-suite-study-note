import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"H:\kerala-psc-suite\kerala-psc-suite"
BASE = os.path.join(ROOT, "tools", "_backup", "20261105-221220", "topics")

def read(p):
    return open(p, encoding="utf-8", errors="replace").read()

flagged = []
for dp, dn, fn in os.walk(os.path.join(ROOT, "topics")):
    for f in sorted(fn):
        if not f.endswith(".html"):
            continue
        cur_p = os.path.join(dp, f)
        rel = os.path.relpath(cur_p, os.path.join(ROOT, "topics"))
        old_p = os.path.join(BASE, rel)
        if not os.path.isfile(old_p):
            continue
        cur, old = read(cur_p), read(old_p)
        if cur.count("$") >= old.count("$"):
            continue
        # original dollars that are NOT part of a LaTeX/math expression
        plain = []
        for line in old.splitlines():
            if "$" not in line:
                continue
            if re.search(r"[\\^_]", line):
                continue           # LaTeX/math line: expected to be converted
            for m in re.finditer(r"\$", line):
                seg = line[max(0, m.start() - 30):m.start() + 30]
                plain.append(re.sub(r"\s+", " ", seg).strip())
        # keep only those whose surrounding text is still present but without $
        damaged = []
        for seg in plain:
            core = seg.replace("$", "")
            if core and core in cur.replace("$", "") and seg in old:
                pass
            if seg not in cur and seg.replace("$", "") in cur.replace("$", ""):
                damaged.append(seg)
        if damaged:
            flagged.append((rel.replace(os.sep, "/"), damaged[:3]))

print(f"files with suspicious $ removal: {len(flagged)}")
for rel, samples in flagged:
    print(f"\n  {rel}")
    for s in samples:
        print("     was: " + s)
