#!/usr/bin/env python3
"""
Kerala PSC Study Suite — content build.

1. Regenerates the mock-test manifests from the papers actually on disk:
       question-papers/573/list.js       -> window.MOCK_TESTS_573
       question-papers/883/list.js       -> window.MOCK_TESTS_883
       question-papers/subjects/list.js  -> window.MOCK_TESTS_SUBJECTS

2. Regenerates the month-wise Current Affairs manifest automatically:
       topics/current-affairs/list.js    -> window.CURRENT_AFFAIRS_MONTHLY
   Scans topics/current-affairs/ (and topics/current-affairs/monthly/ if
   present), skipping index.html and the 6 fixed syllabus files (15.1.x).

3. Wires the mock-test manifests into the three listing pages.

Every file is backed up first; the script is idempotent.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from urllib.parse import quote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUP = os.path.join(ROOT, "tools", "_backup", STAMP)

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
SECONDS_RE = re.compile(r"SECONDS_PER_QUESTION\s*=\s*(\d+)")
META_UPDATED_RE = re.compile(
    r'<meta\s+[^>]*name=["\'](?:mock|ca):(?:updated|update-date|date)["\'][^>]*content=["\']([^"\']+)["\']',
    re.I,
)
META_UPDATED_RE_REV = re.compile(
    r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*name=["\'](?:mock|ca):(?:updated|update-date|date)["\']',
    re.I,
)
META_MONTH_RE = re.compile(
    r'<meta\s+[^>]*name=["\']ca:month["\'][^>]*content=["\']([^"\']+)["\']',
    re.I,
)
META_MONTH_RE_REV = re.compile(
    r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']ca:month["\']',
    re.I,
)
CA_FIXED_RE = re.compile(r"^15\.\d+\.\d+-", re.I)

COUNTERS = [
    (re.compile(r'\{s:"'), "compact"),
    (re.compile(r'(?<![\w$])["\']?question["\']?\s*:'), "long"),
    (re.compile(r"\bq\(\s*['\"]"), "helper"),
    (re.compile(r"(?<![\w$])q\s*:"), "bare"),
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

CA_FOLDER_REL = "topics/current-affairs"
CA_VAR = "CURRENT_AFFAIRS_MONTHLY"

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

MONTH_PATTERNS = [
    (1,  r"(?:january|jan|ജനുവരി)"),
    (2,  r"(?:february|feb|ഫെബ്രുവരി)"),
    (3,  r"(?:march|mar|മാർച്ച്|മാര്ച്ച്)"),
    (4,  r"(?:april|apr|ഏപ്രിൽ|ഏപ്രില്)"),
    (5,  r"(?:may|മെയ്|മേയ്)"),
    (6,  r"(?:june|jun|ജൂൺ|ജൂണ്)"),
    (7,  r"(?:july|jul|ജൂലൈ)"),
    (8,  r"(?:august|aug|ഓഗസ്റ്റ്|ആഗസ്റ്റ്)"),
    (9,  r"(?:september|sept|sep|സെപ്റ്റംബർ|സെപ്തംബർ)"),
    (10, r"(?:october|oct|ഒക്ടോബർ|ഒക്‌ടോബർ)"),
    (11, r"(?:november|nov|നവംബർ)"),
    (12, r"(?:december|dec|ഡിസംബർ)"),
]

GENERIC_TITLES = {"", "kerala psc mock test", "kerala psc", "mock test", "current affairs"}

changed = []
_GIT_INFO_CACHE = None


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
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "paper"


def subject_for(name):
    low = name.lower()
    for key, value in SUBJECT_OF:
        if key in low:
            return value
    return "Uncategorised"


def extract_meta_updated(text):
    m = META_UPDATED_RE.search(text) or META_UPDATED_RE_REV.search(text)
    return m.group(1).strip() if m else ""


def extract_meta_month(text):
    m = META_MONTH_RE.search(text) or META_MONTH_RE_REV.search(text)
    return m.group(1).strip() if m else ""


def detect_month_year(*sources):
    """Extract (month_key 'YYYY-MM', month_label 'October 2026', year '2026')."""
    for raw in sources:
        if not raw:
            continue
        s = str(raw).strip()
        if not s:
            continue

        # 1) Named month + 4-digit year (either order)
        for m_num, pat in MONTH_PATTERNS:
            rx1 = re.compile(r"(?<!\w)" + pat + r"(?!\w)[\s_\-/,]*(20\d{2})\b", re.I)
            rx2 = re.compile(r"\b(20\d{2})[\s_\-/,]*" + pat + r"(?!\w)", re.I)
            m = rx1.search(s) or rx2.search(s)
            if m:
                yr = int(m.group(1))
                return f"{yr:04d}-{m_num:02d}", f"{MONTH_NAMES[m_num]} {yr}", str(yr)

        # 2) Numeric YYYY-MM or YYYY_MM
        m = re.search(r"(?<!\d)(20\d{2})[_\-/ ](0?[1-9]|1[0-2])(?![0-9])", s)
        if m:
            yr, m_num = int(m.group(1)), int(m.group(2))
            return f"{yr:04d}-{m_num:02d}", f"{MONTH_NAMES[m_num]} {yr}", str(yr)

        # 3) Numeric MM-YYYY or MM_YYYY
        m = re.search(r"(?<!\d)(0?[1-9]|1[0-2])[_\-/ ](20\d{2})(?![0-9])", s)
        if m:
            m_num, yr = int(m.group(1)), int(m.group(2))
            return f"{yr:04d}-{m_num:02d}", f"{MONTH_NAMES[m_num]} {yr}", str(yr)

    return "", "", ""


def format_ts(stamp):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stamp))


def normalize_date_key(raw):
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.match(
        r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?",
        s,
    )
    if m:
        return "%04d-%02d-%02d %02d:%02d:%02d" % (
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4) or 0),
            int(m.group(5) or 0),
            int(m.group(6) or 0),
        )
    m = re.match(
        r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?",
        s,
    )
    if m:
        return "%04d-%02d-%02d %02d:%02d:%02d" % (
            int(m.group(3)),
            int(m.group(2)),
            int(m.group(1)),
            int(m.group(4) or 0),
            int(m.group(5) or 0),
            int(m.group(6) or 0),
        )
    return s


def read_git_index_dates():
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
        if version not in (2, 3):
            return {}
        dates, pos = {}, 12
        for _ in range(count):
            start = pos
            mtime = struct.unpack(">I", data[start + 8 : start + 12])[0]
            flags = struct.unpack(">H", data[start + 60 : start + 62])[0]
            namelen = flags & 0x0FFF
            name_start = start + 62
            if version >= 3 and (flags & 0x4000):
                name_start += 2
            if namelen < 0x0FFF:
                name_end = name_start + namelen
            else:
                name_end = data.index(b"\x00", name_start)
            path = data[name_start:name_end].decode("utf-8", "replace")
            pos = start + (((name_end - start) + 8) & ~7)
            dates[path.replace("/", os.sep)] = mtime
        return dates
    except (struct.error, IndexError, ValueError):
        return {}


def read_git_info():
    """Read git log commit history and dirty/untracked files once per run."""
    global _GIT_INFO_CACHE
    if _GIT_INFO_CACHE is not None:
        return _GIT_INFO_CACHE

    info = {"dirty": set(), "latest": {}, "nonbulk": {}, "added": {}}
    git_scopes = ["question-papers", CA_FOLDER_REL]

    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain", "--"] + git_scopes,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                if len(line) < 4:
                    continue
                p = line[3:].strip()
                if " -> " in p:
                    p = p.split(" -> ", 1)[1].strip()
                p = p.strip('"').replace("/", os.sep)
                info["dirty"].add(p)
    except (OSError, subprocess.SubprocessError):
        pass

    try:
        proc = subprocess.run(
            ["git", "log", "--format=__KPSC_TS__%at", "--name-only", "--"] + git_scopes,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        if proc.returncode == 0:
            commits = []
            cur_ts = 0
            cur_files = []
            for line in proc.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("__KPSC_TS__"):
                    if cur_ts and cur_files:
                        commits.append((cur_ts, cur_files))
                    try:
                        cur_ts = int(line[len("__KPSC_TS__"):])
                    except ValueError:
                        cur_ts = 0
                    cur_files = []
                elif cur_ts:
                    cur_files.append(line.replace("/", os.sep))
            if cur_ts and cur_files:
                commits.append((cur_ts, cur_files))

            for ts, files in commits:
                by_folder = {}
                for rel in files:
                    if rel.lower().endswith((".html", ".htm", ".json")):
                        by_folder.setdefault(os.path.dirname(rel), []).append(rel)

                for folder_rel, f_list in by_folder.items():
                    is_bulk = len(f_list) >= 8
                    for rel in f_list:
                        if rel not in info["latest"]:
                            info["latest"][rel] = ts
                        if not is_bulk and rel not in info["nonbulk"]:
                            info["nonbulk"][rel] = ts
                        info["added"][rel] = ts
    except (OSError, subprocess.SubprocessError):
        pass

    _GIT_INFO_CACHE = info
    return info


def _has_spread(timestamps):
    vals = [t for t in timestamps if t]
    return len(vals) >= 2 and (max(vals) - min(vals)) > 10


def _pick_folder_source(paths, index_dates, git_info):
    rels = [os.path.relpath(p, ROOT) for p in paths]
    fs_vals = []
    for p in paths:
        try:
            fs_vals.append(os.path.getmtime(p))
        except OSError:
            fs_vals.append(0)

    idx_vals = [index_dates.get(r, 0) for r in rels]
    lat_vals = [git_info["latest"].get(r, 0) for r in rels]
    nb_vals = [git_info["nonbulk"].get(r, 0) for r in rels]
    add_vals = [git_info["added"].get(r, 0) for r in rels]

    if _has_spread(idx_vals):
        return "index"
    if _has_spread(fs_vals):
        return "fs"
    if _has_spread(lat_vals):
        return "latest"
    if _has_spread(nb_vals):
        return "nonbulk"
    if _has_spread(add_vals):
        return "added"
    return "fs"


def read_manifest_dates(folder):
    path = os.path.join(folder, "list.js")
    if not os.path.isfile(path):
        return {}
    try:
        text = read(path)
    except OSError:
        return {}

    m = re.search(r"window\.[A-Za-z0-9_]+\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if m:
        try:
            items = json.loads(m.group(1))
            if isinstance(items, list):
                return {
                    item["file"]: item.get("updated", "")
                    for item in items
                    if isinstance(item, dict) and item.get("file") and item.get("updated")
                }
        except ValueError:
            pass

    dates = {}
    for block in re.findall(r"\{[^{}]*\}", text):
        mf = re.search(r'"file"\s*:\s*"([^"]+)"', block)
        mu = re.search(r'"updated"\s*:\s*"([^"]*)"', block)
        if mf and mu and mu.group(1):
            dates[mf.group(1)] = mu.group(1)
    return dates


def resolve_updated(path, index_dates, known="", meta_updated="", source="index", git_info=None):
    if meta_updated:
        return meta_updated
    if known:
        return known

    rel = os.path.relpath(path, ROOT)
    index_dates = index_dates or {}
    git_info = git_info or {"dirty": set(), "latest": {}, "nonbulk": {}, "added": {}}

    try:
        fs_mtime = os.path.getmtime(path)
    except OSError:
        fs_mtime = 0

    if rel in git_info["dirty"] and fs_mtime:
        return format_ts(fs_mtime)

    if source == "index":
        stamp = index_dates.get(rel) or fs_mtime
    elif source == "latest":
        stamp = git_info["latest"].get(rel) or index_dates.get(rel) or fs_mtime
    elif source == "nonbulk":
        stamp = (
            git_info["nonbulk"].get(rel)
            or git_info["added"].get(rel)
            or git_info["latest"].get(rel)
            or fs_mtime
        )
    elif source == "added":
        stamp = git_info["added"].get(rel) or git_info["latest"].get(rel) or fs_mtime
    else:
        stamp = fs_mtime or index_dates.get(rel)

    return format_ts(stamp) if stamp else ""


def fallback_title(filename):
    stem = os.path.splitext(os.path.basename(filename))[0]
    pretty = humanise(stem)
    if len(pretty.strip()) < 4 or pretty.strip().isdigit():
        return stem
    return pretty


def dedupe_titles(papers, folder):
    seen = {}
    for entry in papers:
        key = entry["title"].strip().lower()
        seen.setdefault(key, []).append(entry)

    for key, group in seen.items():
        if len(group) > 1 or key in GENERIC_TITLES:
            for entry in group:
                entry["title"] = fallback_title(entry["file"])


def describe_folder(folder, tag, with_subject, index_dates=None, keep_dates=False):
    papers = []
    if not os.path.isdir(folder):
        return papers

    index_dates = index_dates or {}
    git_info = read_git_info()
    recorded = read_manifest_dates(folder) if keep_dates else {}

    names = [
        name
        for name in sorted(os.listdir(folder))
        if name.lower().endswith(".html") and name.lower() != "index.html"
    ]
    paths = [os.path.join(folder, name) for name in names]
    source = _pick_folder_source(paths, index_dates, git_info)

    for name, path in zip(names, paths):
        text = read(path)
        stem = os.path.splitext(name)[0]
        qs = count_questions(text)
        secs = SECONDS_RE.search(text)
        secs_per_q = int(secs.group(1)) if secs else 0
        title_match = TITLE_RE.search(text)
        meta_updated = extract_meta_updated(text)

        entry = {
            "id": slugify(stem),
            "key": slugify(stem),
            "title": clean_title(title_match.group(1) if title_match else "", fallback_title(name)),
            "titleMl": "",
            "updated": resolve_updated(
                path,
                index_dates,
                recorded.get(name, ""),
                meta_updated=meta_updated,
                source=source,
                git_info=git_info,
            ),
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
    papers.sort(key=lambda p: p["file"].lower())
    papers.sort(key=lambda p: normalize_date_key(p.get("updated", "")), reverse=True)
    return papers


def describe_current_affairs_monthly(index_dates=None, keep_dates=False):
    """Auto-discover month-wise Current Affairs HTML files in topics/current-affairs/."""
    ca_dir = os.path.join(ROOT, CA_FOLDER_REL)
    items = []
    if not os.path.isdir(ca_dir):
        return items

    index_dates = index_dates or {}
    git_info = read_git_info()
    recorded = read_manifest_dates(ca_dir) if keep_dates else {}

    candidates = []
    for root_dir, sub_prefix in [(ca_dir, ""), (os.path.join(ca_dir, "monthly"), "monthly/")]:
        if not os.path.isdir(root_dir):
            continue
        for name in sorted(os.listdir(root_dir)):
            low = name.lower()
            if not low.endswith((".html", ".htm")):
                continue
            if low == "index.html":
                continue
            if not sub_prefix and CA_FIXED_RE.match(name):
                continue
            candidates.append((sub_prefix + name, os.path.join(root_dir, name)))

    if not candidates:
        return items

    paths = [p for _, p in candidates]
    source = _pick_folder_source(paths, index_dates, git_info)

    for rel_file, path in candidates:
        text = read(path)
        stem = os.path.splitext(os.path.basename(rel_file))[0]
        qs = count_questions(text)
        title_match = TITLE_RE.search(text)
        raw_title = title_match.group(1) if title_match else ""
        title = clean_title(raw_title, fallback_title(rel_file))
        meta_updated = extract_meta_updated(text)
        meta_month = extract_meta_month(text)

        month_key, month_label, year = detect_month_year(meta_month, rel_file, title)
        updated = resolve_updated(
            path,
            index_dates,
            recorded.get(rel_file, ""),
            meta_updated=meta_updated,
            source=source,
            git_info=git_info,
        )

        items.append({
            "id": slugify(stem),
            "key": "current-affairs-" + slugify(stem),
            "title": title,
            "month": month_key,
            "monthLabel": month_label,
            "year": year,
            "file": rel_file,
            "qs": qs,
            "tag": "BOTH",
            "updated": updated,
        })

    dedupe_titles(items, ca_dir)
    # Sort: newest month first -> newest updated timestamp -> filename
    items.sort(key=lambda p: p["file"].lower())
    items.sort(
        key=lambda p: (p.get("month") or "", normalize_date_key(p.get("updated", ""))),
        reverse=True,
    )
    return items


def render_manifest(var, papers, exam_label):
    body = json.dumps(papers, ensure_ascii=False, indent=2)
    return (
        "/* =====================================================================\n"
        f"   {exam_label} — generated manifest, do not edit by hand\n"
        "   ---------------------------------------------------------------------\n"
        "   Rebuild after adding or removing a file:\n"
        "       python tools/build_content.py\n"
        "   ===================================================================== */\n"
        f"window.{var} = {body};\n"
    )


def write_manifest(folder, var, papers, exam_label):
    return save(
        os.path.join(folder, "list.js"),
        render_manifest(var, papers, exam_label),
    )


def wire_page(rel, manifest_src, var, grid_id):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return False
    text = read(path)
    original = text

    tag_line = f'<script src="{manifest_src}"></script>\n'
    if manifest_src not in text:
        m = re.search(r"<script>\s*\(function \(\) \{", text)
        if not m:
            return False
        text = text[: m.start()] + tag_line + text[m.start() :]

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
        text = text[: m.end()] + guard + text[m.end() :]

    return save(path, text) if text != original else False


def _paper_tag(folder_rel, data=None):
    name = os.path.basename(folder_rel)
    if data and data.get("tag"):
        return data["tag"]
    if name in ("573", "883"):
        return name
    return "BOTH"


def collect_papers(index_dates=None, keep_dates=False):
    index_dates = index_dates or {}
    git_info = read_git_info()
    base = os.path.join(ROOT, "question-papers")
    entries = []

    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "_backup"]
        folder_rel = os.path.relpath(dirpath, ROOT).replace("\\", "/")
        tag = _paper_tag(folder_rel)

        json_names = [n for n in sorted(filenames) if n.lower().endswith(".json")]
        json_paths = [os.path.join(dirpath, n) for n in json_names]
        json_source = _pick_folder_source(json_paths, index_dates, git_info) if json_paths else "fs"

        for name, path in zip(json_names, json_paths):
            rel = f"{folder_rel}/{name}"
            try:
                data = json.loads(read(path))
            except (ValueError, OSError):
                print(f"  ! skipped unreadable JSON: {rel}")
                continue
            if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
                print(f"  ! skipped (no questions[]): {rel}")
                continue
            qs = len(data["questions"])
            spq = data.get("secondsPerQuestion") or 45
            stem = os.path.splitext(name)[0]
            entries.append({
                "id": data.get("id") or slugify(stem),
                "kind": "json",
                "title": data.get("title") or fallback_title(name),
                "titleMl": data.get("titleMl") or "",
                "url": "../mock-test.html?paper=" + quote(rel, safe="/"),
                "data": rel,
                "qs": qs,
                "duration": round(qs * spq / 60) if qs else 0,
                "tag": _paper_tag(folder_rel, data),
                "updated": resolve_updated(
                    path,
                    index_dates,
                    "",
                    meta_updated=data.get("updated") or "",
                    source=json_source,
                    git_info=git_info,
                ),
            })

        html_names = [
            n
            for n in sorted(filenames)
            if n.lower().endswith(".html") and n.lower() != "index.html"
        ]
        if not html_names:
            continue
        described = describe_folder(dirpath, tag, False, index_dates, keep_dates)
        by_name = {d["file"]: d for d in described}
        for name in html_names:
            d = by_name.get(name)
            if not d:
                continue
            entries.append({
                "id": d.get("key") or slugify(os.path.splitext(name)[0]),
                "kind": "html",
                "title": d["title"],
                "titleMl": d.get("titleMl") or "",
                "url": quote(os.path.basename(folder_rel), safe="/") + "/" + quote(name, safe=""),
                "file": f"{folder_rel}/{name}",
                "qs": d.get("qs") or 0,
                "duration": d.get("duration") or 0,
                "tag": d.get("tag") or tag,
                "subject": d.get("subject") or "",
                "updated": d.get("updated") or "",
            })

    entries.sort(
        key=lambda p: (normalize_date_key(p.get("updated", "")), p.get("title", "")),
        reverse=True,
    )
    return entries


def render_papers_js(entries):
    body = json.dumps(entries, ensure_ascii=False, indent=2)
    return (
        "/* =====================================================================\n"
        "   question-papers/papers.js — generated index of every mock test\n"
        "   ---------------------------------------------------------------------\n"
        "   Nothing here is written by hand: the build scans question-papers/ and\n"
        "   lists each .json (data paper) and .html (standalone paper) it finds.\n"
        "   Rebuild with:  python tools/build_content.py\n"
        "   ===================================================================== */\n"
        f"window.KPSC_PAPERS = {body};\n"
    )


def papers_manifest_path():
    return os.path.join(ROOT, "question-papers", "papers.js")


def papers_index_stale():
    target = papers_manifest_path()
    if not os.path.isfile(target):
        return True
    newest = 0.0
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "question-papers")):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.lower().endswith((".json", ".html")):
                newest = max(newest, os.path.getmtime(os.path.join(dirpath, name)))
    return newest > os.path.getmtime(target)


def write_papers_index(index_dates=None, keep_dates=False):
    entries = collect_papers(index_dates, keep_dates)
    return save(papers_manifest_path(), render_papers_js(entries)), entries


def main():
    keep_dates = "--keep-dates" in sys.argv
    print("Kerala PSC Study Suite — content build")
    print("-" * 64)
    index_dates = read_git_index_dates()
    git_info = read_git_info()
    if keep_dates:
        print("  dates     : keeping the dates already in each manifest")
    elif index_dates or git_info["latest"]:
        print(
            f"  dates     : auto (.git/index={len(index_dates)}, "
            f"git-log={len(git_info['latest'])}, dirty={len(git_info['dirty'])})"
        )
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

    # Month-wise Current Affairs manifest
    ca_dir = os.path.join(ROOT, CA_FOLDER_REL)
    ca_items = describe_current_affairs_monthly(index_dates, keep_dates)
    if os.path.isdir(ca_dir):
        if write_manifest(ca_dir, CA_VAR, ca_items, "Current Affairs month-wise notes"):
            print(f"  manifest  {CA_FOLDER_REL}/list.js  -> {len(ca_items)} monthly file(s)")
        if ca_items:
            print("  top current-affairs monthly (newest first):")
            for item in ca_items[:5]:
                label = item.get("monthLabel") or item.get("updated") or "-"
                print(f"    {label:16s} | {item['file']}")

    changed_papers, entries = write_papers_index(index_dates, keep_dates)
    json_n = sum(1 for e in entries if e["kind"] == "json")
    html_n = len(entries) - json_n
    if changed_papers:
        print(
            f"  index     question-papers/papers.js -> {len(entries)} paper(s)"
            f" ({json_n} data, {html_n} standalone)"
        )

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