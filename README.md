# Kerala PSC Study Suite

Static, offline-first study site for the Kerala PSC **573/2025** and **883/2025**
(Inspecting Assistant, Legal Metrology) exams: 17 subjects, 33 chapters,
370 topic notes and 34 full-length mock tests.

No build step is required to *view* the site — every page is plain HTML, CSS
and JavaScript. Optional Python/Node scripts under `tools/` keep the generated
files honest.

---

## 1. Open it

| How | Notes |
| --- | --- |
| Double-click `index.html` | Works fully offline (`file://`). Progress stays in `localStorage`. |
| Publish to GitHub Pages | Push the folder; the site root is the repository root. |
| Any static server | `python -m http.server` from the repository root. |

Nothing hard-codes a repository name any more, so any of the three modes work.
Cloud sync (optional, Firebase) only activates when `assets/js/sync.js` loads
and the visitor signs in.

---

## 2. Layout

```
index.html                     landing page: mock tests, subjects, overall progress
all-subjects-quick-revision.html   cross-subject revision sheet
data/syllabus.json             GENERATED export of the syllabus (see §4)

assets/
  css/landing.css, app.css
  js/
    syllabus.js                ← single source of truth for the whole syllabus
    sections.js                subject/chapter page behaviour
    revision-loader.js         "Revision Notes" button loader
    quick-revision.js          quick-revision page logic
    sync.js                    optional Firebase cloud sync
    engine.js                  auto-loads sync.js on pages that need it

subjects/   NN-<subject>.html            one page per subject
chapters/   <subject>/<chapter>.html      one page per chapter
topics/     <subject>/<id>-<slug>.html   the actual study notes + MCQ practice
question-papers/
  573/ 883/ subjects/   mock-test papers + a generated list.js manifest
mock-tests/  573.html 883.html subjects.html   paper listings

tools/      maintenance scripts (§5)
```

### How a page finds things

* `syllabus.js` holds the syllabus tree (`MARKS`, `TITLE_ML`, `FILES`,
  `CHAPTER_FILES`, `QUESTION_PAPERS`) and exposes it as `window.KPSC_SYLLABUS`
  plus a legacy `window.Syllabus`.
* **`FILES`** maps a topic id → published topic page. A topic with no entry
  renders as a disabled "Coming soon" card.
* **`CHAPTER_FILES`** maps a chapter id → chapter page.
* Chapter and subject pages read their own filename to decide what to show, so
  a page only has to be named correctly (`chapters/biology/6.1-biology.html`
  → chapter id `6.1`).

---

## 3. Adding content

**A study topic**

1. Save the page as `topics/<subject>/<id>-<slug>.html`.
2. Add it to `FILES` in `assets/js/syllabus.js`:
   ```js
   "2.3.4": { file: "topics/geography/2.3.4-climate.html", key: "geography-2.3.4-climate", qs: 15 },
   ```
3. Add a Malayalam title under `TITLE_ML` if it is missing.

**A mock-test paper**

1. Drop the paper into `question-papers/573/`, `question-papers/883/` or
   `question-papers/subjects/`.
2. Run `python tools/build_content.py` to regenerate that folder's `list.js`
   manifest. The listing page reads the manifest, so the paper appears in the
   list even offline.

**A subject or chapter** — add the node to `SYLLABUS` in `syllabus.js`, map it
in `FILES` / `CHAPTER_FILES`, then re-run `node tools/export_syllabus.js`.

---

## 4. Generated files — do not hand-edit

| File | Produced by |
| --- | --- |
| `question-papers/*/list.js` | `python tools/build_content.py` |
| `data/syllabus.json` | `node tools/export_syllabus.js` |

`list.js` carries each paper's title, question count, duration and tag, read
straight out of the paper. `data/syllabus.json` is a machine-readable copy of
`syllabus.js` (17 subjects / 33 chapters / 370 topics) for tooling.

---

## 5. Tools

All scripts are read-only unless noted, and every script that rewrites files
backs them up first under `tools/_backup/<timestamp>/` (with a `restore.ps1`).

```bash
python tools/site_audit.py          # link + data integrity; exit 1 on failure
python tools/check_inline_js.py     # parse every inline page script with Node
python tools/build_content.py       # WRITES: mock-test manifests
node   tools/export_syllabus.js     # WRITES: data/syllabus.json
python tools/repair_site.py         # one-off historical repairs (idempotent)
```

Run the audit before publishing: it checks every internal `href`/`src`, every
path referenced by `syllabus.js`, that each mock-test manifest matches the
folder, and that `data/syllabus.json` still resolves.

Current status: **0 failures**. The audit also lists 14 advisory "stale pages"
(§6).

---

## 6. Known issues / technical debt

* **Stale chapter stubs (advisory).** 14 HTML files under `chapters/` and
  `topics/` are not reachable from `syllabus.js` — older duplicates such as
  `chapters/biology/6.1-biology.html` (its chapter id `6.1` no longer exists,
  so it renders "Chapter not found") and Malayalam-named copies such as
  `chapters/geography/2.2-ഇന്ത്യ.html`. Safe to delete once confirmed nothing
  links to them externally.
* **Progress UI is inert.** Cards render `data-part`, `data-total`, a bar and a
  "Not started" line, and `index.html` has an "Overall Progress" panel, but no
  script reads them and the papers discard their result on submit. Either wire
  a progress recorder into the papers or remove the placeholders.
* **Mock-test pages still contain a GitHub-API fallback.** It only runs when a
  folder has no `list.js`; it never works from `file://`.
* **Legacy root pages.** `chapters/03-economics.html` and
  `chapters/1.1-kerala-history.html` are early subject/chapter pages that now
  duplicate `subjects/03-economics.html` and `chapters/history/1.1-kerala-history.html`.
* `_generate.ps1` / `_generate.bat` build topic-page *stubs* from a hard-coded
  list. The list is older than the published pages, so do not run it on the
  live tree without reviewing the diff.

---

## 7. Fixed in the last maintenance pass

* 350 pages loaded `assets/js/sync.js` from the root-relative path
  `/kerala-psc-suite-study-note/…` — a repository name that no longer exists.
  Cloud sync 404-ed everywhere, including on GitHub Pages; the path is now
  relative to each page (`../` or `../../`), so sync loads in every deployment
  mode. Each tag also carries `data-kpsc-sync="1"` so `engine.js` will not
  double-load it.
* `chapters/1.1-kerala-history.html` used `../../` prefixes while sitting one
  level deep, so its CSS, syllabus and links all missed.
* `CHAPTER_FILES["9"]` pointed at `chapters/art-sports-literature/9-art-sports-literature.html`,
  which did not exist — subject 09 showed "Coming soon" for a chapter that has
  topics. The page now exists and resolves chapter id `9`.
* `QUESTION_PAPERS` pointed at `question-papers/qp-00{1,2}-full-mock-{1,2}.html`,
  neither of which existed. Both now point at the real papers in
  `question-papers/573/`.
* `question-papers/573/list.js` listed 2 of 25 papers, `883/list.js` listed 2
  papers that do not exist, and neither manifest was read by any page — the
  listings depended on the GitHub contents API, which fails offline. Manifests
  are now generated from disk and consumed by the pages.
* `data/syllabus.json` described 10 subjects with topic filenames that never
  existed and was not read by any page. It is now generated from
  `syllabus.js` and audited.
