#!/usr/bin/env python3
"""
Kerala PSC Study Suite — link/depth repairs (idempotent, backs up first).

Repairs applied
  1. Replaces the hard-coded root-relative sync loader
        <script src="/kerala-psc-suite-study-note/assets/js/sync.js">
     with a path relative to each page's real depth.  (350 pages)
  2. Fixes the over-deep ../../ prefixes in chapters/1.1-kerala-history.html
     (the file lives at chapters/ = depth 1, not depth 2).
  3. Creates chapters/art-sports-literature/9-art-sports-literature.html
     from the canonical chapter template — CHAPTER_FILES["9"] pointed at a
     file that did not exist.
  4. Points the two dead QUESTION_PAPERS entries in assets/js/syllabus.js at
     the real papers under question-papers/573/.

Every touched file is copied to tools/_backup/<stamp>/ first and a
restore script is written next to it.  Running twice changes nothing.
"""
import json
import os
import re
import shutil
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = os.path.join(ROOT, "tools", "_backup", STAMP)
SKIP_DIRS = {".git", "tools", "node_modules", "acl-recovery"}

OLD_SYNC = '/kerala-psc-suite-study-note/assets/js/sync.js'
SYNC_RE = re.compile(r'(<script\b[^>]*?\bsrc=)(["\'])' + re.escape(OLD_SYNC) + r'\2')

changed = []


def backup(path):
    rel = os.path.relpath(path, ROOT)
    dest = os.path.join(BACKUP, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(path, dest)


def save(path, text, original):
    if text == original:
        return False
    backup(path)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    changed.append(os.path.relpath(path, ROOT).replace("\\", "/"))
    return True


def read(path):
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        return fh.read()


def html_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(".html"):
                yield os.path.join(dirpath, name)


def prefix_for(path):
    """'../' repeated once per directory level below the site root."""
    depth = os.path.relpath(os.path.dirname(path), ROOT).count(os.sep)
    if os.path.relpath(os.path.dirname(path), ROOT) == ".":
        depth = 0
    else:
        depth += 1
    return "../" * depth


def repair_sync_paths():
    fixed = 0
    for path in html_files():
        text = read(path)
        if OLD_SYNC not in text:
            continue
        p = prefix_for(path)

        def sub(m, p=p):
            return f'{m.group(1)}{m.group(2)}{p}assets/js/sync.js{m.group(2)} data-kpsc-sync="1"'

        new = SYNC_RE.sub(sub, text)
        if save(path, new, text):
            fixed += 1
    return fixed


def repair_deep_chapter():
    path = os.path.join(ROOT, "chapters", "1.1-kerala-history.html")
    if not os.path.isfile(path):
        return False
    text = read(path)
    new = text.replace("../../", "../")
    return save(path, new, text)


def create_missing_chapter():
    src = os.path.join(ROOT, "chapters", "biology", "6-biology-public-health.html")
    dst = os.path.join(ROOT, "chapters", "art-sports-literature", "9-art-sports-literature.html")
    if os.path.exists(dst) or not os.path.isfile(src):
        return False
    text = read(src)
    # The template derives everything from the filename; only the static
    # <title> is page-specific, so make it descriptive for this chapter.
    text = text.replace(
        "<title>Loading - Kerala PSC</title>",
        "<title>Art, Sports &amp; Literature - Kerala PSC</title>",
        1,
    )
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    changed.append(os.path.relpath(dst, ROOT).replace("\\", "/"))
    return True


def repair_question_papers():
    path = os.path.join(ROOT, "assets", "js", "syllabus.js")
    text = read(path)
    new = text.replace(
        'file: "question-papers/qp-001-full-mock-1.html"',
        'file: "question-papers/573/qp-573-001-full-mock-1.html"',
    ).replace(
        'file: "question-papers/qp-002-full-mock-2.html"',
        'file: "question-papers/573/qp-573-002-full-mock-2.html"',
    )
    return save(path, new, text)


def write_restore():
    if not changed:
        return None
    lines = [
        "# Restores the files changed by tools/repair_site.py",
        f"# Backup: tools/_backup/{STAMP}",
        "$ErrorActionPreference = 'Stop'",
        f"$backup = Join-Path $PSScriptRoot '{STAMP}'",
        f"$root   = '{ROOT}'",
        "Get-ChildItem -Path $backup -Recurse -File | ForEach-Object {",
        "  $rel  = $_.FullName.Substring($backup.Length).TrimStart('\\')",
        "  $dest = Join-Path $root $rel",
        "  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force",
        "  Write-Host \"restored $rel\"",
        "}",
    ]
    path = os.path.join(BACKUP, "restore.ps1")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def main():
    print("Kerala PSC Study Suite — repairs")
    print("-" * 60)
    n = repair_sync_paths()
    print(f"1. sync.js paths made relative      : {n} file(s)")
    print(f"2. chapters/1.1-kerala-history.html : {'fixed' if repair_deep_chapter() else 'no change'}")
    print(f"3. missing chapter 9 page           : {'created' if create_missing_chapter() else 'already ok'}")
    print(f"4. QUESTION_PAPERS paths            : {'fixed' if repair_question_papers() else 'no change'}")

    manifest = os.path.join(BACKUP, "changed-files.json")
    if changed:
        os.makedirs(BACKUP, exist_ok=True)
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"stamp": STAMP, "files": changed}, fh, indent=2)
    restore = write_restore()
    print("-" * 60)
    print(f"files changed: {len(changed)}")
    if restore:
        print(f"backup + rollback: {os.path.relpath(restore, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
