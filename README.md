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
| `python tools/serve.py` | **Recommended locally** — same site, but the mock-test manifests rebuild themselves when you add a paper. |
| Double-click `index.html` | Works fully offline (`file://`). Progress stays in `localStorage`; new papers need `build_content.py` (§5). |
| Publish to GitHub Pages | Push the folder; the site root is the repository root. A workflow keeps the manifests current. |
| Any static server | `python -m http.server` from the repository root (serves the committed manifests). |

Nothing hard-codes a repository name any more, so every mode works.
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
2. That's it — the list picks it up by itself:

   * previewing with `python tools/serve.py` → the manifest is rebuilt on the
     next request, so a refresh shows the new paper;
   * on GitHub Pages → the commit triggers the workflow that rebuilds the
     manifest, and the page also folds in files the contents API reports as
     not yet in it;
   * opened from `file://` → the committed manifest is used, so run
     `python tools/build_content.py` (see §5 for why this one case cannot be
     automatic).

   `python tools/site_audit.py` reports any paper still missing as
   "on disk, unlisted".

**A subject or chapter** — add the node to `SYLLABUS` in `syllabus.js`, map it
in `FILES` / `CHAPTER_FILES`, then re-run `node tools/export_syllabus.js`.

---

## 4. Generated files — do not hand-edit

| File | Produced by |
| --- | --- |
| `question-papers/*/list.js` | `python tools/build_content.py` |
| `data/syllabus.json` | `node tools/export_syllabus.js` |

`list.js` carries each paper's title, question count, duration, tag and
`updated` date, read straight out of the paper, ordered newest first. The
listing pages render that order and show the date on each card.
`data/syllabus.json` is a machine-readable copy of `syllabus.js`
(17 subjects / 33 chapters / 370 topics) for tooling.

---

## 5. Tools

All scripts are read-only unless noted, and every script that rewrites files
backs them up first under `tools/_backup/<timestamp>/` (with a `restore.ps1`).

```bash
python tools/serve.py               # local preview; rebuilds manifests on request
python tools/site_audit.py          # link + data integrity; exit 1 on failure
python tools/math_audit.py          # LaTeX / symbol / character formatting
python tools/check_inline_js.py     # parse every inline page script with Node
node   tools/render_check.js        # render a listing page headlessly, show the cards
python tools/build_content.py       # WRITES: mock-test manifests (+ --keep-dates)
node   tools/export_syllabus.js     # WRITES: data/syllabus.json
python tools/reduce_borders.py      # WRITES: thinner borders on topic pages
python tools/fix_math.py            # WRITES: LaTeX/ASCII math -> native HTML
python tools/fix_bare_latex.py      # WRITES: leftover commands outside $...$
python tools/repair_site.py         # one-off historical repairs (idempotent)
```

Newest papers come first. Each manifest entry carries an `updated` date taken
from `.git/index` — the file's own mtime when it was staged, which survives
later edits and is readable without the `git` binary — falling back to the
filesystem mtime for a paper that has not been staged yet. CI runs the build
with `--keep-dates`, because a fresh checkout stamps every file with the same
time and would flatten the order; only papers missing from the manifest then get
today's date.

`render_check.js` executes a listing page in Node with a small DOM shim and
prints the cards it produced — handy when a headless browser is not available.

### Adding a mock-test paper — no manual step

A browser cannot list a folder from `file://`, which is why the listings read a
generated manifest. All three routes keep it current by themselves:

| You are viewing via | What keeps the list current |
| --- | --- |
| `python tools/serve.py` | The server rebuilds `list.js` in memory whenever a paper in that folder is newer than the manifest — drop the file in, refresh. |
| GitHub Pages | `.github/workflows/refresh-mock-manifests.yml` rebuilds and commits the manifests when a `question-papers/**/*.html` file is pushed; the pages also fold in anything the contents API reports that the manifest does not know. |
| `file://` (double-click) | Uses the committed manifest. Papers added after the last build show up once `build_content.py` runs — the only route that needs it. |

`serve.py` flags: `--port`, `--host`, `--root`, `--no-auto` (serve the committed
manifests as-is).

`reduce_borders.py` enforces the house style for the topic pages: every
all-round outline is `1px`, every one-sided accent bar is at most `2px`;
border colours, styles and radii are never touched. It covers the inline
styles in `topics/**/*.html` and `assets/css/app.css` (used only by the topic
stub pages — `landing.css` is shared with the subject/chapter/mock pages and is
deliberately excluded). Add `--dry-run` to see what it would change.

### Mathematics and symbols

The site works offline, so there is no MathJax or KaTeX: every formula is
native HTML plus Unicode.

| Written as | Rendered as |
| --- | --- |
| `$a_n = a + (n-1)d$` | `a<sub>n</sub> = a + (n-1)d` |
| `$b = \sqrt{ac}$` | `b = √(ac)` |
| `$\frac{a+c}{2}$` | a stacked fraction (`.kfrac`, 1px rule, no external CSS) |
| `$2^n\pm1$` | `2<sup>n</sup>±1` |
| `H2O`, `CO2`, `H2SO4` | `H<sub>2</sub>O`, `CO<sub>2</sub>`, `H<sub>2</sub>SO<sub>4</sub>` |
| `F_c`, `E_g`, `a^k` | `F<sub>c</sub>`, `E<sub>g</sub>`, `a<sup>k</sup>` |

`<svg><text>` cannot hold `<sup>`/`<sub>`, so inside diagrams the scripts use
Unicode (`aᵐ`, `H₂O`) or a `<tspan baseline-shift>` when no Unicode form exists.
`$A$1` spreadsheet references and a `$` used as an operator in a coding question
are left exactly as they are — `fix_math.py` protects them explicitly.

```bash
python tools/math_audit.py     # raw LaTeX, ASCII stand-ins, broken characters
python tools/fix_math.py       # WRITES: converts to native HTML/Unicode
python tools/fix_bare_latex.py # WRITES: leftover \dfrac / \sqrt outside $...$
```

`math_audit.py` reads text nodes only — never markup, attributes, `<script>`,
`<style>` or `<code>` — and reports `0 findings` on the current tree.

Run the audit before publishing: it checks every internal `href`/`src`, every
path referenced by `syllabus.js`, that each mock-test manifest matches the
folder, and that `data/syllabus.json` still resolves.

Current status: **0 failures**, and `math_audit.py` reports **0 findings**
across all 371 topic pages. The audit also lists 12 advisory "stale pages" (§6).

---

## 6. Known issues / technical debt

* **Stale chapter stubs (advisory).** 12 HTML files under `chapters/` and
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
* **Prose still quotes a few ASCII forms on purpose.** `pi * r^2` inside a
  `<code>` block is a deliberate example of the old raw style, and `20x`
  (meaning 20·x) is algebraic, so neither is auto-converted.
* `_generate.ps1` / `_generate.bat` build topic-page *stubs* from a hard-coded
  list. The list is older than the published pages, so do not run it on the
  live tree without reviewing the diff.

---

## 7. Fixed in the last maintenance pass

* 350 pages loaded `assets/js/sync.js` from the root-relative, hard-coded path
  `/kerala-psc-suite-study-note/assets/js/sync.js`. That only resolves when the
  site is served from the project root of that exact GitHub Pages repository:
  it fails from `file://`, from a local server, and after any rename (the repo
  name had already drifted from the one used elsewhere in the code). Each page
  now uses a path relative to its own depth (`../` or `../../`), so sync loads
  in every mode. Each tag also carries `data-kpsc-sync="1"` so `engine.js` will
  not double-load it.
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
