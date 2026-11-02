#!/usr/bin/env python3
"""
Kerala PSC Study Suite — content build.

1. Regenerates the mock-test manifests from the papers actually on disk:
       question-papers/573/list.js       -> window.MOCK_TESTS_573
       question-papers/883/list.js       -> window.MOCK_TESTS_883
       question-papers/subjects/list.js  -> window.MOCK_TESTS_SUBJECTS
   Titles, question counts and timings are read out of each paper, so the
   manifests can no longer drift from the folder (they had drifted badly:
   573 listed 2 of 25 papers, 883 listed 2 papers that do not exist).

2. Wires those manifests into the three listing pages so the lists render
   from a local file instead of the GitHub contents API.  That makes the
   lists work offline / from file:// as the site claims, and stops each
   visit from downloading every paper just to read metadata.

Each entry carries an `updated` date and the lists are ordered newest first.
The date comes from .git/index (the file's own mtime when it was staged),
falling back to the filesystem mtime.  Pass --keep-dates in CI: a fresh
checkout stamps every file with the same time, so recomputing there would
flatten the order.

Every file is backed up first; the script is idempotent.
"""
import json
import os
import re
import shutil
import struct
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = os.path.join(ROOT, "tools", "_backup", STAMP)

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
SECONDS_RE = re.compile(r"SECONDS_PER_QUESTION\s*=\s*(\d+)")
# Question-count heuristics: papers use four different literal shapes.
COUNTERS = [
    (re.compile(r'\{s:"'), "compact"),          # {s:"..",q:"..",o:[..],a:1}
    (re.compile(r'(?<![\w$])["\']?question["\']?\s*:'), "long"),   # {subject:..,question:..}
    (re.compile(r"\bq\(\s*['\"]"), "helper"),   # q('H', mt(`..`))
    (re.compile(r"(?<![\w$])q\s*:"), "bare"),   # { q: "..", o: [..] }
]

SUBJECT_OF = [
    ("biology", "Biology"),
    ("english", "English"),
    ("physics", "Physics"),
    ("chemistry", "Chemistry"),
    ("geography", "Geography"),
    ("history", "History"),
    ("constitution", "Constitution"),
    ("economics", "Economics"),
    ("administration", "Kerala Admin"),
    ("metrology", "Legal Metrology"),
    ("arithmetic", "Arithmetic"),
    ("mental", "Mental Ability"),
    ("current", "Current Affairs"),
    ("acts", "Important Acts"),
    ("malayalam", "Malayalam"),
    ("computer", "Computer"),
]

TARGETS = [
    ("573", "question-papers/573", "MOCK_TESTS_573", "573", False),
    ("883", "question-papers/883", "MOCK_TESTS_883", "883", False),
    ("subjects", "question-papers/subjects", "MOCK_TESTS_SUBJECTS", "BOTH", True),
]

PAGE_WIRING = [
    ("mock-tests/573.html", "../question-papers/573/list.js", "MOCK_TESTS_573", "paperGrid"),
    ("mock-tests/883.html", "../question-papers/883/list.js", "MOCK_TESTS_883", "paperGrid"),
    ("mock-tests/subjects.html", "../question-papers/subjects/list.js", "MOCK_TESTS_SUBJECTS", "subjectHost"),
]

changed = []


def read(path):
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
        return fh.read()


def backup(path):
    rel = os.path.relpath(path, ROOT)
    dest = os.path.join(BACKUP, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if not os.path.exists(dest):
        shutil.copy2(path, dest)


def save(path, text):
    try:
        original = read(path)
    except FileNotFoundError:
        original = None
    if original == text:
        return False
    if original is not None:
        backup(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    changed.append(os.path.relpath(path, ROOT).replace("\\", "/"))
    return True


def count_questions(text):
    counts = [len(rx.findall(text)) for rx, _ in COUNTERS]
    return max(counts) if counts else 0


def clean_title(raw, fallback):
    title = re.sub(r"\s+", " ", (raw or "")).strip()
    title = re.sub(r"\s*[—–-]\s*Kerala PSC\s*$", "", title, flags=re.I)
    return title or fallback


def humanise(stem):
    name = re.sub(r"^qp-[a-z0-9]+-", "", stem)
    name = re.sub(r"[-_]+", " ", name).strip()
    return name[:1].upper() + name[1:] if name else stem


def slugify(stem):
    """Attribute-safe id: filenames contain spaces, & and en-dashes."""
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "paper"


def subject_for(name):
    low = name.lower()
    for key, value in SUBJECT_OF:
        if key in low:
            return value
    return "Uncategorised"


def read_git_index_dates():
    """path -> epoch seconds, from .git/index.

    Each index entry stores the file's own modification time as recorded when it
    was staged, so the date survives later rewrites of the file and is available
    without the `git` binary.  A CI checkout instead produces one uniform
    timestamp for every file, which is why the workflow passes --keep-dates.
    """
    idx = os.path.join(ROOT, ".git", "index")
    if not os.path.isfile(idx):
        return {}
    try:
        with open(idx, "rb") as fh:
            data = fh.read()
    except OSError:
        return {}
    if data[:4] != b"DIRC" or len(data) < 12:
        return {}
    try:
        version, count = struct.unpack(">II", data[4:12])
        if version != 2:
            return {}
        dates, pos = {}, 12
        for _ in range(count):
            start = pos
            mtime = struct.unpack(">I", data[pos + 8:pos + 12])[0]
            namelen = struct.unpack(">H", data[pos + 60:pos + 62])[0] & 0x0FFF
            name_start = pos + 62
            path = data[name_start:name_start + namelen].decode("utf-8", "replace")
            pos = start + ((name_start + namelen - start + 8) & ~7)
            dates[path.replace("/", os.sep)] = mtime
        return dates
    except (struct.error, IndexError):
        return {}


def read_manifest_dates(folder):
    """name -> updated, from a previously generated list.js."""
    path = os.path.join(folder, "list.js")
    if not os.path.isfile(path):
        return {}
    try:
        text = read(path)
        return {m.group(1): m.group(2)
                for m in re.finditer(r'"file"\s*:\s*"([^"]+)"[^}]*?"updated"\s*:\s*"([^"]*)"', text, re.S)}
    except OSError:
        return {}


def resolve_updated(path, index_dates, known):
    """Publication-ish date for a paper: known manifest value, git index, mtime."""
    rel = os.path.relpath(path, ROOT)
    if known:
        return known
    stamp = index_dates.get(rel)
    if not stamp:
        try:
            stamp = os.path.getmtime(path)
        except OSError:
            return ""
    return time.strftime("%Y-%m-%d", time.localtime(stamp))


def describe_folder(folder, tag, with_subject, index_dates=None, keep_dates=False):
    papers = []
    if not os.path.isdir(folder):
        return papers
    index_dates = index_dates or {}
    recorded = read_manifest_dates(folder) if keep_dates else {}
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(".html"):
            continue
        if name.lower() == "index.html":
            continue
        path = os.path.join(folder, name)
        text = read(path)
        stem = os.path.splitext(name)[0]
        qs = count_questions(text)
        secs = SECONDS_RE.search(text)
        secs_per_q = int(secs.group(1)) if secs else 0
        title_match = TITLE_RE.search(text)
        entry = {
            "id": slugify(stem),
            "key": slugify(stem),
            "title": clean_title(title_match.group(1) if title_match else "", fallback_title(name)),
            "titleMl": "",
            "updated": resolve_updated(path, index_dates, recorded.get(name, "")),
            "desc": (f"{qs} questions" if qs else "Question paper"),
            "file": name,
            "qs": qs,
            "duration": round(qs * secs_per_q / 60) if (qs and secs_per_q) else 0,
            "tag": tag,
        }
        if with_subject:
            entry["subject"] = subject_for(stem)
        papers.append(entry)

    dedupe_titles(papers, folder)
    # Newest first; the filename keeps the order stable inside the same day.
    papers.sort(key=lambda p: p["file"])
    papers.sort(key=lambda p: p.get("updated", ""), reverse=True)
    return papers


GENERIC_TITLES = {"", "kerala psc mock test", "kerala psc", "mock test"}


def fallback_title(filename):
    """A readable name from the filename, never just a bare number."""
    stem = os.path.splitext(filename)[0]
    pretty = humanise(stem)
    if len(pretty.strip()) < 4 or pretty.strip().isdigit():
        return stem
    return pretty


def dedupe_titles(papers, folder):
    """Several papers carry the same generic <title>; fall back to the filename.

    Without this the list showed three cards all titled "Kerala PSC Mock Test",
    which is indistinguishable for a student choosing a paper.
    """
    seen = {}
    for entry in papers:
        key = entry["title"].strip().lower()
        seen.setdefault(key, []).append(entry)

    for key, group in seen.items():
        if len(group) > 1 or key in GENERIC_TITLES:
            for entry in group:
                entry["title"] = fallback_title(entry["file"])


def render_manifest(var, papers, exam_label):
    """The manifest text, without touching the disk (used by tools/serve.py)."""
    body = json.dumps(papers, ensure_ascii=False, indent=2)
    return (
        "/* =====================================================================\n"
        f"   {exam_label} — generated manifest, do not edit by hand\n"
        "   ---------------------------------------------------------------------\n"
        "   Rebuild after adding or removing a paper:\n"
        "       python tools/build_content.py\n"
        "   Titles, question counts and durations are read from the papers.\n"
        "   ===================================================================== */\n"
        f"window.{var} = {body};\n"
    )


def write_manifest(folder, var, papers, exam_label):
    return save(os.path.join(folder, "list.js"),
                render_manifest(var, papers, exam_label))


def wire_page(rel, manifest_src, var, grid_id):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return False
    text = read(path)
    original = text

    # (a) load the manifest before the inline controller
    tag_line = f'<script src="{manifest_src}"></script>\n'
    if manifest_src not in text:
        m = re.search(r"<script>\s*\(function \(\) \{", text)
        if not m:
            return False
        text = text[:m.start()] + tag_line + text[m.start():]

    # (b) render from the manifest first, API/cache only as fallback
    guard = (
        f"    var local_{var} = window.{var};\n"
        f"    if (local_{var} && local_{var}.length) {{ render(local_{var}); return; }}\n"
    )
    parts = text.split("async function load", 1)
    already = len(parts) == 2 and f"window.{var}" in parts[1][:500]
    if not already:
        m = re.search(r"(?:grid|host)\.innerHTML = '<p class=\"empty\">Loading…</p>';\r?\n", text)
        if not m:
            return False
        text = text[:m.end()] + guard + text[m.end():]

    return save(path, text) if text != original else False


def main():
    keep_dates = "--keep-dates" in sys.argv
    print("Kerala PSC Study Suite — content build")
    print("-" * 64)
    index_dates = read_git_index_dates()
    if keep_dates:
        print("  dates     : keeping the dates already in each manifest")
    elif index_dates:
        print(f"  dates     : .git/index ({len(index_dates)} entries)")
    else:
        print("  dates     : file modification times")

    total = 0
    for exam, folder_rel, var, tag, with_subject in TARGETS:
        folder = os.path.join(ROOT, folder_rel)
        papers = describe_folder(folder, tag, with_subject, index_dates, keep_dates)
        if write_manifest(folder, var, papers, f"{exam} papers"):
            print(f"  manifest  {folder_rel}/list.js  -> {len(papers)} paper(s)")
        total += len(papers)

    print(f"  {total} paper(s) described")

    for rel, src, var, grid in PAGE_WIRING:
        if wire_page(rel, src, var, grid):
            print(f"  wired     {rel}")

    if changed:
        os.makedirs(BACKUP, exist_ok=True)
        with open(os.path.join(BACKUP, "changed-files.json"), "w", encoding="utf-8") as fh:
            json.dump({"stamp": STAMP, "files": changed}, fh, indent=2)

    print("-" * 64)
    print(f"files changed: {len(changed)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
