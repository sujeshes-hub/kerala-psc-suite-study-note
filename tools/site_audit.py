#!/usr/bin/env python3
"""
Kerala PSC Study Suite — static site integrity audit.

Checks (all read-only, no network):
  1. broken internal links (href/src in HTML, ignoring inline <script> bodies)
  2. every path referenced by assets/js/syllabus.js exists on disk
  3. every topic page on disk is reachable from syllabus.js (orphans)
  4. hardcoded absolute site base paths (e.g. "/repo-name/assets/...")
  5. manifest (question-papers/*/list.js) entries vs files on disk
  6. duplicate <title> / duplicate ids within a page

Exit code 0 = clean, 1 = problems found.
Usage:  python tools/site_audit.py [--verbose]
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from html.parser import HTMLParser

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "tools", "acl-recovery"}

# Link attributes worth checking, keyed by (tag, attribute).
LINK_ATTRS = {
    ("a", "href"), ("link", "href"), ("script", "src"), ("img", "src"),
    ("source", "src"), ("iframe", "src"), ("area", "href"), ("form", "action"),
}
EXTERNAL = re.compile(r"^(?:https?:|mailto:|tel:|javascript:|data:|#|//)", re.I)


class LinkParser(HTMLParser):
    """Collects link targets, ids and the <title>, skipping script/style bodies."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = []
        self.title = ""
        self._in_script = False
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for t, attr in LINK_ATTRS:
            if tag == t and a.get(attr):
                self.links.append(a[attr].strip())
        if a.get("id"):
            self.ids.append(a["id"])
        if tag in ("script", "style"):
            self._in_script = True
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._in_script = False
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def walk_html():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(".html"):
                yield os.path.join(dirpath, name)


def read_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def parse_pages():
    pages = {}
    for path in walk_html():
        p = LinkParser()
        try:
            p.feed(read_text(path))
        except Exception as exc:  # noqa: BLE001 - report, never crash the audit
            print(f"  ! parse error {rel(path)}: {exc}")
            continue
        pages[path] = p
    return pages


def check_links(pages, problems):
    broken = defaultdict(list)
    checked = 0
    for path, page in pages.items():
        base = os.path.dirname(path)
        for target in page.links:
            if EXTERNAL.match(target):
                continue
            clean = target.split("#")[0].split("?")[0]
            if not clean:
                continue  # pure in-page anchor
            checked += 1
            if clean.startswith("/"):
                # Root-relative: only valid if a directory of that name sits at the
                # drive root, which never happens for this project. Flag it.
                broken[target].append(rel(path))
                continue
            resolved = os.path.normpath(os.path.join(base, clean.replace("/", os.sep)))
            if os.path.isdir(resolved) or clean.endswith("/"):
                ok = os.path.isfile(os.path.join(resolved, "index.html"))
            else:
                ok = os.path.exists(resolved)
            if not ok:
                broken[target].append(rel(path))
    problems["checked_links"] = checked
    problems["broken_links"] = broken


def check_syllabus_refs(problems):
    path = os.path.join(ROOT, "assets", "js", "syllabus.js")
    if not os.path.isfile(path):
        problems["syllabus_missing"] = True
        return
    src = read_text(path)
    refs = sorted(set(re.findall(r'"((?:topics|chapters|question-papers|assets)/[^"]+\.(?:html|js|css|json))"', src)))
    missing = [r for r in refs if not os.path.exists(os.path.join(ROOT, r.replace("/", os.sep)))]
    problems["syllabus_refs"] = refs
    problems["syllabus_missing_refs"] = missing


def check_orphans(pages, problems):
    """Topic/chapter pages on disk that syllabus.js never points at."""
    src = read_text(os.path.join(ROOT, "assets", "js", "syllabus.js"))
    referenced = set(re.findall(r'"((?:topics|chapters)/[^"]+\.html)"', src))
    orphans = []
    for folder in ("topics", "chapters"):
        root = os.path.join(ROOT, folder)
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            for name in filenames:
                if name.lower().endswith(".html"):
                    key = rel(os.path.join(dirpath, name))
                    if key not in referenced:
                        orphans.append(key)
    problems["orphan_pages"] = sorted(orphans)


def check_absolute_base(paths_text, problems):
    """Files hardcoding /<site-name>/... instead of a relative path."""
    hits = []
    pattern = re.compile(r'(?:src|href)\s*=\s*"(/(?!\/)[^"]*)"')
    for path in paths_text:
        for m in pattern.finditer(read_text(path)):
            hits.append((rel(path), m.group(1)))
    problems["root_relative"] = hits


def check_manifests(problems):
    """list.js entries must exist on disk; every paper on disk should be listed."""
    out = []
    for exam in ("573", "883"):
        folder = os.path.join(ROOT, "question-papers", exam)
        manifest = os.path.join(folder, "list.js")
        on_disk = sorted(
            n for n in os.listdir(folder)
            if n.lower().endswith(".html") and n.lower() != "index.html"
        ) if os.path.isdir(folder) else []
        listed = []
        if os.path.isfile(manifest):
            listed = re.findall(r'file:\s*"([^"]+)"', read_text(manifest))
        out.append({
            "exam": exam,
            "on_disk": len(on_disk),
            "listed": len(listed),
            "listed_but_missing": [f for f in listed if f not in on_disk],
            "on_disk_but_unlisted": [f for f in on_disk if f not in listed],
        })
    problems["manifests"] = out


def check_duplicates(pages, problems):
    titles = Counter()
    dup_ids = []
    for path, page in pages.items():
        titles[page.title.strip()] += 1
        if len(page.ids) != len(set(page.ids)):
            dup = [i for i, c in Counter(page.ids).items() if c > 1]
            dup_ids.append((rel(path), dup))
    problems["duplicate_titles"] = [(t, c) for t, c in titles.items() if c > 1 and t]
    problems["duplicate_ids"] = dup_ids


def main():
    verbose = "--verbose" in sys.argv
    pages = parse_pages()
    problems = {}

    check_links(pages, problems)
    check_syllabus_refs(problems)
    check_orphans(pages, problems)
    check_absolute_base(list(pages.keys()), problems)
    check_manifests(problems)
    check_duplicates(pages, problems)

    print("=" * 72)
    print("KERALA PSC STUDY SUITE — SITE AUDIT")
    print("=" * 72)
    print(f"HTML pages scanned : {len(pages)}")
    print(f"Internal links     : {problems['checked_links']}")

    broken = problems["broken_links"]
    print(f"\n[1] Broken internal links : {len(broken)}")
    for target, sources in sorted(broken.items(), key=lambda kv: -len(kv[1]))[:25]:
        print(f"    {len(sources):3d}x  {target}")
        if verbose:
            for s in sources[:4]:
                print(f"          from {s}")

    missing = problems["syllabus_missing_refs"]
    print(f"\n[2] syllabus.js refs       : {len(problems['syllabus_refs'])} declared, {len(missing)} missing")
    for m in missing:
        print(f"    MISSING  {m}")

    orphans = problems["orphan_pages"]
    print(f"\n[3] Pages not linked from syllabus.js : {len(orphans)}")
    for o in orphans[:25]:
        print(f"    {o}")

    rr = problems["root_relative"]
    print(f"\n[4] Root-relative (non-portable) URLs : {len(rr)}")
    agg = Counter()
    for _, url in rr:
        agg[url] += 1
    for url, count in agg.most_common(10):
        sample = next(f for f, u in rr if u == url)
        print(f"    {count:4d}x  {url}   (e.g. {sample})")

    print("\n[5] Mock-test manifests")
    for m in problems["manifests"]:
        print(f"    {m['exam']}: {m['on_disk']} papers on disk, {m['listed']} listed in list.js")
        if m["listed_but_missing"]:
            print(f"        listed but missing : {m['listed_but_missing']}")
        if m["on_disk_but_unlisted"]:
            print(f"        on disk, unlisted  : {len(m['on_disk_but_unlisted'])} files")

    print(f"\n[6] Duplicate <title> values : {len(problems['duplicate_titles'])}")
    for t, c in problems["duplicate_titles"][:10]:
        print(f"    {c:4d}x  {t!r}")
    print(f"    Duplicate ids in a page   : {len(problems['duplicate_ids'])}")
    for f, ids in problems["duplicate_ids"][:10]:
        print(f"    {f}: {ids}")

    total = (len(broken) + len(missing) + len(orphans) + len(rr)
             + sum(len(m["listed_but_missing"]) for m in problems["manifests"])
             + len(problems["duplicate_ids"]))
    print("\n" + "=" * 72)
    print(f"RESULT: {'CLEAN' if total == 0 else str(total) + ' problem group(s)'}")
    print("=" * 72)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
