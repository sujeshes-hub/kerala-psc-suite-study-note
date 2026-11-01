#!/usr/bin/env python3
"""
Kerala PSC Study Suite — thin out borders on the topic pages.

Rule (matches the requested look):
  * all-round outlines      border: Npx …        -> capped at 1px
  * one-sided accent bars   border-left/… Npx …  -> capped at 2px
  * border-width longhands                       -> capped at 1px
  * border-radius, colours, style keywords (solid/dashed/…) are never touched

Applies to every topic page and to the shared stylesheet the stub topic pages
use.  Files are backed up first; the script is idempotent (a second run finds
nothing to change).

Usage:
    python tools/reduce_borders.py --dry-run   # report only
    python tools/reduce_borders.py             # write
"""
import os
import re
import shutil
import sys
import time
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = os.path.join(ROOT, "tools", "_backup", STAMP)

STYLE_KW = r"(?:solid|dashed|dotted|double|groove|ridge|inset|outset)"

# border: 5px solid -> border: 1px solid   (all-round outline)
ALL_SIDES = re.compile(
    r"(\bborder\s*:\s*)(\d+(?:\.\d+)?)px(\s+" + STYLE_KW + r"\b)", re.I)
# border-left: 5px solid -> 2px           (accent bar)
ONE_SIDE = re.compile(
    r"(\bborder-(?:top|right|bottom|left)\s*:\s*)(\d+(?:\.\d+)?)px(\s+" + STYLE_KW + r"\b)", re.I)
# border-width: 3px
LONGHAND = re.compile(
    r"(\bborder-width\s*:\s*)(\d+(?:\.\d+)?)px(?![\w-])", re.I)

OUTLINE_MAX = 1.0
ACCENT_MAX = 2.0


def read(path):
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        return fh.read()


def fmt(value):
    return ("%g" % value) + "px"


def clamp(text, hits):
    def all_sides(m):
        width = float(m.group(2))
        new = min(width, OUTLINE_MAX)
        if new != width:
            hits[("outline", m.group(2))] += 1
            return m.group(1) + fmt(new) + m.group(3)
        return m.group(0)

    def one_side(m):
        width = float(m.group(2))
        new = min(width, ACCENT_MAX)
        if new != width:
            hits[("accent", m.group(2))] += 1
            return m.group(1) + fmt(new) + m.group(3)
        return m.group(0)

    def longhand(m):
        width = float(m.group(2))
        new = min(width, OUTLINE_MAX)
        if new != width:
            hits[("width-longhand", m.group(2))] += 1
            return m.group(1) + fmt(new)
        return m.group(0)

    text = ALL_SIDES.sub(all_sides, text)
    text = ONE_SIDE.sub(one_side, text)
    text = LONGHAND.sub(longhand, text)
    return text


def targets():
    topics = os.path.join(ROOT, "topics")
    for dirpath, dirnames, filenames in os.walk(topics):
        for name in sorted(filenames):
            if name.lower().endswith(".html"):
                yield os.path.join(dirpath, name)
    # app.css is loaded only by the topic pages; landing.css is shared with the
    # subject/chapter/mock pages, so it is deliberately left alone.
    css = os.path.join(ROOT, "assets", "css", "app.css")
    if os.path.isfile(css):
        yield css


def main():
    dry = "--dry-run" in sys.argv
    changed = []
    hits = Counter()
    scanned = 0

    for path in targets():
        scanned += 1
        original = read(path)
        updated = clamp(original, hits)
        if updated == original:
            continue
        changed.append(os.path.relpath(path, ROOT).replace("\\", "/"))
        if not dry:
            dest = os.path.join(BACKUP, os.path.relpath(path, ROOT))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if not os.path.exists(dest):
                shutil.copy2(path, dest)
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(updated)

    print("=" * 68)
    print("BORDER REDUCTION — " + ("DRY RUN" if dry else "APPLIED"))
    print("=" * 68)
    print(f"files scanned            : {scanned}")
    print(f"files changed            : {len(changed)}")
    print(f"outline borders thinned  : {sum(v for k, v in hits.items() if k[0] == 'outline')}")
    print(f"accent bars thinned      : {sum(v for k, v in hits.items() if k[0] == 'accent')}")
    print(f"border-width thinned     : {sum(v for k, v in hits.items() if k[0] == 'width-longhand')}")
    print("\nby original width:")
    for (kind, width), count in sorted(hits.items(), key=lambda kv: -kv[1]):
        print(f"  {width:>5}px  {kind:<14} {count:5d}x")
    if changed:
        print("\nfirst changed files:")
        for name in changed[:8]:
            print("  " + name)
    if not dry and changed:
        print(f"\nbackups: {os.path.relpath(BACKUP, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
