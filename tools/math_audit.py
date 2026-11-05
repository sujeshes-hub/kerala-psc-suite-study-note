#!/usr/bin/env python3
"""
Kerala PSC Study Suite — math / symbol formatting audit.

The site must work fully offline, so MathJax and KaTeX are not an option:
every equation has to be native HTML + Unicode.  This walks the parsed *text
nodes* of each page (never markup, never script/style bodies, never attributes)
and reports anything that would reach a reader as raw LaTeX, an ASCII stand-in
for a real symbol, or a broken character reference.

Usage:
    python tools/math_audit.py                  # whole topics/ tree
    python tools/math_audit.py --path topics/arithmetic
    python tools/math_audit.py --samples 6 --files
"""
import argparse
import html
import os
import re
import sys
from collections import Counter, defaultdict
from html.parser import HTMLParser

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "tools", "node_modules", "acl-recovery"}

# ---- patterns applied to text nodes only -----------------------------------
LATEX_CMD = re.compile(r"\\[a-zA-Z]{2,}")
LATEX_DELIM = re.compile(r"\\[\(\[]|\\[\)\]]")
DOLLAR = re.compile(r"\$(.+?)\$", re.S)
CARET = re.compile(r"(?<![\w$])([A-Za-z0-9\)\]])\^\{?(-?\w+)\}?")
UNDER = re.compile(r"(?<![\w$])([A-Za-z])_\{?(\w+)\}?")
COMPARE = re.compile(r"(?<![\w<>=])(<=|>=|!=)(?![\w<>=])")
SQRT_CALL = re.compile(r"\bsqrt\s*\(")
PI_WORD = re.compile(r"(?<![\w.])pi(?![\w.])")
ARROW = re.compile(r"(?<=\s)(->|=>)(?=\s)")
TIMES_X = re.compile(r"(?<=\d)\s*x\s*(?=\d)")

# Formulas that only read correctly with subscripts.  Species without digits
# (NaCl, HCl, CaO, NaOH, KOH, MgO) are deliberately absent: they are correct.
CHEM = re.compile(
    r"(?<![\w><])(H2SO4|H2SO3|H2CO3|C6H12O6|C2H5OH|CH3COOH|KMnO4|NaHCO3|Na2CO3"
    r"|CaCO3|CuSO4|Fe2O3|Al2O3|ZnSO4|PbO2|HNO3|H2O2|H2O|CO2|SO2|NO2|NH3|CH4"
    r"|Cl2|O3|P4|S8|O2|N2|H2)(?![.\w)])")
UNIT_POW = re.compile(r"(?<![\w/.])(km|cm|mm|dm|kg|m|g)(2|3)(?![0-9\w])")
# Spreadsheet absolute/mixed references ($A$1, $A1, A$1) legitimately use $.
EXCEL_ABS = re.compile(r"\$[A-Za-z]{1,3}\$?\d{1,5}(?![\w])|(?<![\w])\$?[A-Za-z]{1,3}\$\d{1,5}(?![\w])")

# Entity names that are fine to leave; anything else in text is suspicious.
KNOWN_ENTITIES = set(k.rstrip(";") for k in html.entities.html5)

MATH_ENTITY_HINTS = ("times", "divide", "plusmn", "radic", "sup2", "sup3", "pi",
                     "sum", "infin", "deg", "ne", "le", "ge", "frac", "middot",
                     "asymp", "equiv", "there4", "nabla", "Delta", "Omega", "mu")


class PageParser(HTMLParser):
    """Collects text nodes (entities left raw) and unknown entity references.

    Text inside <code>/<pre> is skipped: those blocks deliberately show raw
    source (e.g. the "pi * r^2" example of what the pages used to look like).
    """

    SKIP = {"script", "style", "code", "pre", "textarea", "title", "option"}

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.chunks = []          # text nodes outside skipped elements
        self.bad_entities = []    # (name, )
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP and not dict(attrs).get("src"):
            self._skip += 1
        elif tag in ("sub", "sup") and not self._skip:
            # A sentinel keeps "O<sub>2</sub>" from reading as the plain text
            # "O2", which would look like an unformatted chemical formula.
            self.chunks.append("\x00")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag in ("sub", "sup") and not self._skip:
            self.chunks.append("\x00")

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_data(self, data):
        if not self._skip:
            self.chunks.append(data)

    def handle_entityref(self, name):
        if not self._skip and name not in KNOWN_ENTITIES:
            self.bad_entities.append(name)

    def handle_charref(self, name):
        if self._skip:
            return
        try:
            int(name[1:], 16) if name[:1].lower() == "x" else int(name)
        except ValueError:
            self.bad_entities.append("#" + name)


def read(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        return raw.decode("utf-8"), None
    except UnicodeDecodeError as exc:
        return raw.decode("utf-8", "replace"), str(exc)


def snip(text, pos, width=64):
    start = max(0, pos - 12)
    return re.sub(r"\s+", " ", text[start:start + width]).strip()


def scan(path):
    text, decode_error = read(path)
    parser = PageParser()
    try:
        parser.feed(text)
    except Exception as exc:  # noqa: BLE001 - a broken page must not stop the audit
        return {"parse_error": [str(exc)]}

    # Join text nodes with nothing: inserting a space here would fabricate
    # false matches such as "20x 100" out of two neighbouring nodes.
    body = "".join(parser.chunks)
    body = re.sub(r"[ \t]+", " ", body)
    hits = defaultdict(list)

    if decode_error:
        hits["invalid_utf8"].append(decode_error[:70])
    for m in re.finditer("\ufffd", body):
        hits["replacement_char"].append(snip(body, m.start()))
    for m in re.finditer("Ã|Â[^\\w]|â€", body):
        hits["mojibake"].append(snip(body, m.start()))
    for m in LATEX_DELIM.finditer(body):
        hits["latex_delimiter"].append(snip(body, m.start()))
    for m in LATEX_CMD.finditer(body):
        hits["latex_cmd_outside_math"].append(snip(body, m.start()))

    for m in DOLLAR.finditer(EXCEL_ABS.sub(" ", body)):
        inner = m.group(1)
        if re.search(r"[^\x00-\x7f]", inner):
            continue          # $100 ബില്യൺ …  — a currency sign, not delimiters
        key = "latex_in_dollar" if "\\" in inner else "dollar_math"
        hits[key].append(m.group(0)[:70])

    for m in CARET.finditer(body):
        hits["caret_power"].append(m.group(0)[:40])
    for m in UNDER.finditer(body):
        hits["underscore_sub"].append(m.group(0)[:40])
    for m in COMPARE.finditer(body):
        hits["ascii_compare"].append(snip(body, m.start()))
    for m in SQRT_CALL.finditer(body):
        hits["ascii_sqrt"].append(snip(body, m.start()))
    for m in PI_WORD.finditer(body):
        hits["ascii_pi"].append(snip(body, m.start()))
    for m in ARROW.finditer(body):
        hits["ascii_arrow"].append(snip(body, m.start()))
    # "x" between numbers is genuinely ambiguous (4 x 14 is multiplication,
    # 20x is 20·x), so it is reported only when verbose, never auto-flagged.
    for m in CHEM.finditer(body):
        hits["chem_plain"].append(m.group(1))
    for m in UNIT_POW.finditer(body):
        hits["unit_power"].append(m.group(0))
    for name in parser.bad_entities:
        hits["bad_entity"].append("&" + name)

    return hits


def html_files(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(".html"):
                yield os.path.join(dirpath, name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default="topics")
    ap.add_argument("--samples", type=int, default=4)
    ap.add_argument("--files", action="store_true")
    args = ap.parse_args()

    base = args.path if os.path.isabs(args.path) else os.path.join(ROOT, args.path)
    totals = Counter()
    per_file = defaultdict(Counter)
    samples = defaultdict(list)
    n_files = 0

    for path in sorted(html_files(base)):
        n_files += 1
        hits = scan(path)
        if not hits:
            continue
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        for cat, items in hits.items():
            totals[cat] += len(items)
            per_file[rel][cat] += len(items)
            for item in items[:1]:
                if len(samples[cat]) < 500:
                    samples[cat].append((rel, item))

    print("=" * 80)
    print("MATH / SYMBOL FORMATTING AUDIT")
    print("=" * 80)
    print(f"pages scanned        : {n_files}")
    print(f"pages with findings  : {len(per_file)}")
    print("-" * 80)
    for cat, count in totals.most_common():
        files = len([f for f in per_file if per_file[f][cat]])
        print(f"{cat:<26} {count:6d}   {files:4d} file(s)")
    if not totals:
        print("No findings.")
        return 0
    print("-" * 80)
    for cat, _ in totals.most_common():
        print(f"\n### {cat}")
        for rel, item in samples[cat][:args.samples]:
            print(f"   {rel}\n      {item}")
    if args.files:
        print("\n--- per file ---")
        for rel in sorted(per_file, key=lambda r: -sum(per_file[r].values())):
            detail = ", ".join(f"{k}={v}" for k, v in per_file[rel].most_common())
            print(f"  {rel}: {detail}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
