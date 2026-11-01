#!/usr/bin/env python3
"""
Kerala PSC Study Suite — inline <script> syntax check.

Every page in this site carries its controller as an inline script, so a
broken edit shows up as a blank page rather than a 404.  This extracts each
inline script and hands it to Node's parser (node --check), which catches
syntax errors without running any page code.

Usage:  python tools/check_inline_js.py [--node <path-to-node>]
Exit code 0 = every inline script parses.
"""
import os
import re
import subprocess
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "tools", "node_modules", "acl-recovery"}

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
TYPE_OK = re.compile(r"type\s*=\s*[\"']?(?:text/javascript|module|application/javascript)[\"']?", re.I)
TYPE_ANY = re.compile(r"type\s*=", re.I)
# Code that only makes sense inside a browser; keep it, Node only parses it.


def find_node():
    for arg in sys.argv[1:]:
        if arg.startswith("--node="):
            return arg.split("=", 1)[1]
    local = os.path.join(os.environ.get("LOCALAPPDATA", ""), "dsh", "dsh-runtimes",
                         "dsh-primary-runtime", "dependencies", "node", "bin", "node.exe")
    if os.path.isfile(local):
        return local
    return "node"


def html_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.lower().endswith(".html"):
                yield os.path.join(dirpath, name)


def main():
    node = find_node()
    checked = 0
    failures = []
    for path in html_files():
        text = open(path, "r", encoding="utf-8", errors="replace").read()
        for i, match in enumerate(SCRIPT_RE.finditer(text)):
            attrs, body = match.group(1), match.group(2)
            if re.search(r"\bsrc\s*=", attrs, re.I):
                continue
            if TYPE_ANY.search(attrs) and not TYPE_OK.search(attrs):
                continue  # JSON-LD, text/template, ...
            if not body.strip():
                continue
            checked += 1
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                             encoding="utf-8") as fh:
                fh.write(body)
                tmp = fh.name
            try:
                proc = subprocess.run([node, "--check", tmp],
                                      capture_output=True, text=True)
                if proc.returncode != 0:
                    line = text[:match.start()].count("\n") + 1
                    failures.append((os.path.relpath(path, ROOT).replace("\\", "/"),
                                     line, i, proc.stderr.strip().splitlines()[:4]))
            finally:
                os.unlink(tmp)

    print("=" * 72)
    print("INLINE SCRIPT SYNTAX CHECK")
    print("=" * 72)
    print(f"inline scripts checked : {checked}")
    print(f"parse failures         : {len(failures)}")
    for name, line, idx, err in failures:
        print(f"\n  {name} (page line {line}, script #{idx + 1})")
        for row in err:
            print(f"      {row}")
    print("=" * 72)
    print("RESULT:", "OK" if not failures else "SYNTAX ERRORS")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
