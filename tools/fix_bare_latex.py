#!/usr/bin/env python3
"""
Kerala PSC Study Suite — sweep up LaTeX left outside $...$ math.

Two things ended up in the pages and must not reach a reader:

  * escaped tags ("&lt;sub&gt;") created by a conversion-order bug
  * raw commands sitting in plain text: \\dfrac{a}{b}, \\frac{a}{b},
    \\sqrt{x}, \\text{...}

This unescapes the tags, then converts those commands in place, treating any
HTML tag inside a brace group as opaque text so already-rendered markup (for
example r<sup>n</sup>) survives untouched.

    python tools/fix_bare_latex.py            # dry run
    python tools/fix_bare_latex.py --apply
"""
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
TAG = re.compile(r"</?[a-zA-Z!][^>]*>", re.S)
SKIP_TEXT_INSIDE = {"script", "style", "code", "pre", "textarea", "title", "option"}

UNESCAPE = [
    ("&lt;sub&gt;", "<sub>"), ("&lt;/sub&gt;", "</sub>"),
    ("&lt;sup&gt;", "<sup>"), ("&lt;/sup&gt;", "</sup>"),
    ("&lt;strong&gt;", "<strong>"), ("&lt;/strong&gt;", "</strong>"),
]

SYMBOLS = {
    r"\times": "×", r"\div": "÷", r"\pm": "±", r"\cdot": "·", r"\le": "≤",
    r"\ge": "≥", r"\ne": "≠", r"\approx": "≈", r"\to": "→", r"\Rightarrow": "⇒",
    r"\infty": "∞", r"\pi": "π", r"\dots": "…", r"\left": "", r"\right": "",
    r"\,": " ", r"\;": " ", r"\ ": " ", r"\%": "%",
}

counts = {"unescaped": 0, "frac": 0, "sqrt": 0, "text": 0, "symbol": 0}


def read_group(s, i):
    depth, start, j = 1, i + 1, i + 1
    while j < len(s) and depth:
        if s[j] == "\\":
            j += 2
            continue
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if not depth:
                return s[start:j], j + 1
        j += 1
    return s[start:], len(s)


def read_arg(s, i):
    while i < len(s) and s[i] == " ":
        i += 1
    if i >= len(s):
        return "", i
    if s[i] == "{":
        return read_group(s, i)
    if s[i] == "\\":
        m = re.match(r"\\[a-zA-Z]+|\\.", s[i:])
        return m.group(0), i + len(m.group(0))
    return s[i], i + 1


def convert(s, depth=0):
    """Convert bare LaTeX in s; tags already present are preserved verbatim."""
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\":
            m = re.match(r"\\[a-zA-Z]+|\\.", s[i:])
            if not m:
                out.append(s[i])
                i += 1
                continue
            cmd = m.group(0)
            i += len(cmd)
            name = cmd[1:]
            if name in ("frac", "dfrac", "tfrac"):
                a, i = read_arg(s, i)
                b, i = read_arg(s, i)
                counts["frac"] += 1
                out.append('<span class="kfrac"><span class="kfnum">%s</span>'
                           '<span class="kfden">%s</span></span>' % (convert(a, depth + 1), convert(b, depth + 1)))
            elif name == "sqrt":
                a, i = read_arg(s, i)
                inner = convert(a, depth + 1)
                plain = re.sub(r"<[^>]+>", "", inner)
                counts["sqrt"] += 1
                out.append(f"√({inner})" if len(plain) > 1 else f"√{inner}")
            elif name == "text":
                a, i = read_arg(s, i)
                counts["text"] += 1
                out.append(a)
            elif name == "mathbf":
                a, i = read_arg(s, i)
                out.append("<strong>%s</strong>" % convert(a, depth + 1))
            elif cmd in SYMBOLS:
                counts["symbol"] += 1
                out.append(SYMBOLS[cmd])
            else:
                # unknown command: drop the backslash word, keep going
                out.append("")
            continue
        out.append(s[i])
        i += 1
    return "".join(out)


def fix_chunk(chunk):
    if "\\" not in chunk and "&lt;sub&gt;" not in chunk and "&lt;sup&gt;" not in chunk:
        return chunk
    for a, b in UNESCAPE:
        if a in chunk:
            counts["unescaped"] += chunk.count(a)
            chunk = chunk.replace(a, b)
    if "\\" in chunk:
        chunk = convert(chunk)
    return chunk


def process(html):
    parts, pos = [], 0
    for m in TAG.finditer(html):
        if m.start() > pos:
            parts.append((False, html[pos:m.start()]))
        parts.append((True, m.group(0)))
        pos = m.end()
    if pos < len(html):
        parts.append((False, html[pos:]))

    out, skip = [], 0
    for is_tag, chunk in parts:
        if is_tag:
            out.append(chunk)
            name = re.match(r"([a-zA-Z0-9]+)", chunk.lstrip("</").lower())
            name = name.group(1) if name else ""
            if name in SKIP_TEXT_INSIDE:
                if chunk.lstrip().startswith("</"):
                    skip = max(0, skip - 1)
                elif not chunk.rstrip().endswith("/>"):
                    skip += 1
            continue
        out.append(chunk if skip else fix_chunk(chunk))
    result = "".join(out)
    if '<span class="kfrac"' in result and ".kfrac" not in result:
        result = result.replace(
            "</head>",
            "<style>/* inline fractions for offline math */\n"
            ".kfrac{display:inline-flex;flex-direction:column;vertical-align:middle;"
            "text-align:center;line-height:1.08;margin:0 .18em;font-size:.95em}\n"
            ".kfrac>.kfnum{padding:0 .25em;border-bottom:1px solid currentColor}\n"
            ".kfrac>.kfden{padding:0 .25em}\n</style>\n</head>", 1)
    return result


def main():
    apply = "--apply" in sys.argv
    changed = []
    for dp, dn, fn in os.walk(os.path.join(ROOT, "topics")):
        for name in sorted(fn):
            if not name.lower().endswith(".html"):
                continue
            path = os.path.join(dp, name)
            with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as fh:
                original = fh.read()
            updated = process(original)
            if updated == original:
                continue
            changed.append(os.path.relpath(path, ROOT).replace("\\", "/"))
            if apply:
                dest = os.path.join(BACKUP, os.path.relpath(path, ROOT))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(path, dest)
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(updated)

    print("=" * 70)
    print("BARE LATEX SWEEP — " + ("APPLIED" if apply else "DRY RUN"))
    print("=" * 70)
    print(f"pages changed: {len(changed)}")
    for k, v in counts.items():
        if v:
            print(f"  {k:<10} {v}")
    for c in changed[:20]:
        print("  " + c)
    if apply and changed:
        print(f"\nbackups: {os.path.relpath(BACKUP, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
