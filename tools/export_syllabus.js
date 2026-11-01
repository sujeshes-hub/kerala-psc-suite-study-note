#!/usr/bin/env node
/* =====================================================================
   Kerala PSC Study Suite — export data/syllabus.json from the single
   source of truth (assets/js/syllabus.js).

   The old data/syllabus.json was hand-maintained, described only 10 of
   the 17 subjects and pointed at topic filenames that never existed.
   Nothing read it, so it rotted silently.  Regenerating it keeps a
   machine-readable copy that matches the site exactly, and loading
   syllabus.js here doubles as a syntax check of that file.

   Usage:  node tools/export_syllabus.js
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "assets", "js", "syllabus.js");
const OUT = path.join(ROOT, "data", "syllabus.json");

global.window = {};
require(SRC);

const K = global.window.KPSC_SYLLABUS;
const S = global.window.Syllabus;
if (!K || !S) {
  console.error("assets/js/syllabus.js did not expose KPSC_SYLLABUS / Syllabus");
  process.exit(1);
}

const subjects = S.getAllSubjects().map((subject) => ({
  id: subject.id,
  code: subject.code,
  title: subject.title,
  titleMl: subject.titleMl,
  icon: subject.icon,
  desc: subject.desc || "",
  chapters: subject.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    titleMl: chapter.titleMl,
    tag: chapter.tag,
    file: chapter.file,
    topics: (chapter.topics || []).map((topic) => ({
      id: topic.id,
      title: topic.title,
      titleMl: topic.titleMl,
      tag: topic.tag,
      file: topic.file,
      key: topic.key,
      qs: topic.qs,
    })),
  })),
}));

const payload = {
  generated: new Date().toISOString(),
  source: "assets/js/syllabus.js",
  note: "Generated file — edit assets/js/syllabus.js and re-run `node tools/export_syllabus.js`.",
  exams: K.EXAMS,
  marks: K.MARKS,
  counts: {
    subjects: subjects.length,
    chapters: subjects.reduce((n, s) => n + s.chapters.length, 0),
    topics: subjects.reduce(
      (n, s) => n + s.chapters.reduce((m, c) => m + c.topics.length, 0), 0),
    publishedTopics: subjects.reduce(
      (n, s) => n + s.chapters.reduce(
        (m, c) => m + c.topics.filter((t) => t.file).length, 0), 0),
  },
  questionPapers: K.QUESTION_PAPERS,
  subjects,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

const c = payload.counts;
console.log(
  "data/syllabus.json written  " +
  c.subjects + " subjects, " + c.chapters + " chapters, " +
  c.topics + " topics (" + c.publishedTopics + " published)"
);
