#!/usr/bin/env python3
"""
Kerala PSC Study Suite — order mock-test lists by update date.

The generated manifests are already written newest-first, but each listing page
re-sorted by filename, which put a paper added today at the bottom of the list.
This patch:

  1. inserts a shared `byUpdated` comparator (newest first, filename as tie-break)
  2. uses it wherever a page sorted the list itself
  3. shows the date on each card, so the order is visible rather than implied

Idempotent: a page that already has `byUpdated` is skipped.
"""
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGES = ["mock-tests/573.html", "mock-tests/883.html", "mock-tests/subjects.html"]

HELPER = """  /* Newest paper first; the filename keeps ties stable. */
  function byUpdated(a, b) {
    var da = a.updated || "";
    var db = b.updated || "";
    if (da !== db) return da < db ? 1 : -1;
    return (a.file || "").localeCompare(b.file || "");
  }

"""

# "a.file.localeCompare(b.file)" used as a sort callback, single or multi-line.
SINGLE = re.compile(r"function \(a, b\) \{ return a\.file\.localeCompare\(b\.file\); \}")
MULTI = re.compile(
    r"function \(a, b\) \{\s*\n\s*return a\.file\.localeCompare\(b\.file\);\s*\n\s*\}")

META = re.compile(r"(\n[ \t]*)(\(p\.duration \? '<span>⏱ ' \+ p\.duration \+ ' min</span>' : ''\) \+)")


def patch(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return "missing"
    with open(path, "r", encoding="utf-8", newline="") as fh:
        text = original = fh.read()
    if "function byUpdated" in text:
        return "already patched"

    anchor = "  function titleFromFilename"
    if anchor not in text:
        return "anchor not found"
    text = text.replace(anchor, HELPER + anchor, 1)

    text = SINGLE.sub("byUpdated", text)
    text = MULTI.sub("byUpdated", text)

    def add_date(m):
        indent, line = m.group(1), m.group(2)
        return (f"{indent}{line}"
                f"{indent}(p.updated ? '<span>📅 ' + p.updated + '</span>' : '') +")

    text, n = META.subn(add_date, text, count=1)

    if text == original:
        return "no change"
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return f"patched (dates shown: {'yes' if n else 'no'})"


def main():
    print("Sort mock-test lists by update date")
    print("-" * 52)
    bad = 0
    for rel in PAGES:
        result = patch(rel)
        print(f"  {rel:<28} {result}")
        if result in ("missing", "anchor not found"):
            bad = 1
    return bad


if __name__ == "__main__":
    sys.exit(main())
