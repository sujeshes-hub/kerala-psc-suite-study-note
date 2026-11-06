#!/usr/bin/env python3
"""Prove that a paper dropped into question-papers/ is listed automatically."""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMMY = os.path.join(ROOT, "question-papers", "573", "__auto-test.json")
URL = "http://127.0.0.1:8130/question-papers/papers.js"

dummy_paper = {
    "id": "qp-auto-test",
    "title": "Auto Discovery Test",
    "titleMl": "ഓട്ടോ ഡിസ്കവറി ടെസ്റ്റ്",
    "secondsPerQuestion": 30,
    "negativeMarking": 0.33,
    "shuffleOptions": True,
    "questions": [
        {"subject": "Test", "question": "1 + 1 = ?",
         "options": ["A) 1", "B) 2", "C) 3", "D) 4"], "correct": 1, "explanation": "2"},
        {"subject": "Test", "question": "2 + 2 = ?",
         "options": ["A) 2", "B) 3", "C) 4", "D) 5"], "correct": 2, "explanation": "4"},
    ],
}


def fetch_counts():
    with urllib.request.urlopen(URL, timeout=15) as r:
        text = r.read().decode("utf-8")
    return text.count('"kind": "json"'), text.count('"kind": "html"'), "Auto Discovery Test" in text


def main():
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "serve.py"),
                             "--port", "8130"],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                base = fetch_counts()
                break
            except OSError:
                time.sleep(0.5)
        else:
            print("server did not start")
            return 1

        print("before      : %d data / %d standalone, dummy present=%s" % base)

        with open(DUMMY, "w", encoding="utf-8") as fh:
            json.dump(dummy_paper, fh, ensure_ascii=False, indent=2)
        time.sleep(0.6)
        mid = fetch_counts()
        print("after adding: %d data / %d standalone, dummy present=%s  %s"
              % (mid[0], mid[1], mid[2], "PASS" if mid[0] == base[0] + 1 and mid[2] else "FAIL"))

        os.unlink(DUMMY)
        time.sleep(0.6)
        end = fetch_counts()
        print("after remove: %d data / %d standalone, dummy present=%s  %s"
              % (end[0], end[1], end[2], "PASS" if end[0] == base[0] and not end[2] else "FAIL"))

        return 0 if (mid[0] == base[0] + 1 and mid[2] and end[0] == base[0] and not end[2]) else 1
    finally:
        if os.path.exists(DUMMY):
            os.unlink(DUMMY)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
