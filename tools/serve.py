#!/usr/bin/env python3
"""
Kerala PSC Study Suite — local preview server with live manifests.

Why: the mock-test listing pages read a generated `question-papers/<folder>/
list.js`.  Opened straight from disk (`file://`) a browser cannot list a
folder, so a paper you just dropped in only shows up after rebuilding the
manifest.  This server removes that step: whenever a `list.js` is requested and
any paper in that folder is newer than the manifest, it is rebuilt in memory
and served, so "drop the file in and refresh" is enough.

    python tools/serve.py                 # http://127.0.0.1:8000/
    python tools/serve.py --port 8080
    python tools/serve.py --no-auto       # serve the committed manifests as-is

The site itself is untouched: this only serves files from the repository root.
Opening `index.html` directly still works — there the committed manifest is used.
"""
import argparse
import importlib.util
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE_ROOT = ROOT
AUTO = True


def load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_content", os.path.join(ROOT, "tools", "build_content.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILDER = load_builder()
# url path -> (folder, manifest global, tag, with_subject, label)
MANIFESTS = {}
for exam, folder_rel, var, tag, with_subject in BUILDER.TARGETS:
    MANIFESTS["/" + folder_rel + "/list.js"] = (folder_rel, var, tag, with_subject, f"{exam} papers")


def is_stale(folder):
    manifest = os.path.join(folder, "list.js")
    if not os.path.isfile(manifest):
        return True
    newest = 0.0
    for name in os.listdir(folder):
        if name.lower().endswith(".html"):
            newest = max(newest, os.path.getmtime(os.path.join(folder, name)))
    return newest > os.path.getmtime(manifest)


class Handler(SimpleHTTPRequestHandler):
    server_version = "KPSC-Preview/1.0"

    def do_GET(self):
        if AUTO and self._serve_live_manifest():
            return
        super().do_GET()

    def _serve_live_manifest(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        entry = MANIFESTS.get(path)
        if not entry:
            return False
        folder_rel, var, tag, with_subject, label = entry
        folder = os.path.join(SERVE_ROOT, folder_rel)
        if not os.path.isdir(folder):
            return False
        if not is_stale(folder):
            return False
        papers = BUILDER.describe_folder(folder, tag, with_subject,
                                         BUILDER.read_git_index_dates())
        body = BUILDER.render_manifest(var, papers, label).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cache_control_sent = True
        self.end_headers()
        self.wfile.write(body)
        print(f"  rebuilt {folder_rel}/list.js -> {len(papers)} paper(s)")
        return True

    def end_headers(self):
        # The file on disk may be current, but never let the browser cache a
        # manifest that a later paper could invalidate.
        if (not getattr(self, "_cache_control_sent", False)
                and self.path.split("?", 1)[0].endswith("/list.js")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "list.js" in self.path:
            return  # already reported when it was rebuilt
        super().log_message(fmt, *args)


def main():
    global AUTO, SERVE_ROOT
    ap = argparse.ArgumentParser(description="Preview the study suite with live mock-test manifests.")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--root", default=ROOT,
                    help="directory to serve (default: the repository root)")
    ap.add_argument("--no-auto", action="store_true",
                    help="serve the committed list.js files instead of rebuilding on the fly")
    args = ap.parse_args()
    AUTO = not args.no_auto
    SERVE_ROOT = os.path.abspath(args.root)

    handler = partial(Handler, directory=SERVE_ROOT)
    with ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        print("Kerala PSC Study Suite — preview server")
        print(f"  root    : {SERVE_ROOT}")
        print(f"  address : http://{args.host}:{args.port}/")
        print("  manifests: " + ("rebuilt automatically when a paper is added" if AUTO
                                 else "served as committed"))
        print("  Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
