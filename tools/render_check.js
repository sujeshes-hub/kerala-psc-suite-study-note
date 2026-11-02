/* Renders a listing page in Node with a tiny DOM shim, so we can see the cards
   a browser would produce.  Usage: node tools/_render_probe.js mock-tests/573.html */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const page = process.argv[2] || "mock-tests/573.html";
const html = fs.readFileSync(path.join(ROOT, page), "utf8");

// ---- collect the external manifest script + the inline controller ----
const manifestSrc = [...html.matchAll(/<script src="([^"]*list\.js)"><\/script>/g)].map(m => m[1])[0];
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  .filter(s => s.includes("function load") || s.includes("supplement")).pop();

const captured = { html: "" };
function fakeEl(id) {
  return {
    innerHTML: "",
    textContent: "",
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
const grid = fakeEl();
const sandbox = {
  window: {},
  document: {
    getElementById: (id) => (id === "paperGrid" || id === "subjectHost" ? grid : fakeEl(id)),
    createElement: () => ({ set src(v) {}, setAttribute() {} }),
    body: { appendChild() {} },
    documentElement: { setAttribute() {}, hasAttribute: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  location: { pathname: "/mock-tests/" + path.basename(page), hostname: "127.0.0.1", href: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {},
  fetch: () => Promise.reject(new Error("offline")),
  console,
  setTimeout,
  clearTimeout,
  Promise,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// manifest first, exactly like the page's <script src> order
if (manifestSrc) {
  const resolved = path.resolve(ROOT, path.dirname(page), manifestSrc);
  vm.runInContext(fs.readFileSync(resolved, "utf8"), sandbox, { filename: manifestSrc });
}
vm.runInContext(inline, sandbox, { filename: page });

setTimeout(() => {
  const out = grid.innerHTML;
  const cards = [...out.matchAll(/<a href="([^"]+)" class="card"[^>]*>([\s\S]*?)<\/a>/g)];
  console.log(`page: ${page}`);
  console.log(`cards rendered: ${cards.length}`);
  cards.slice(0, 5).forEach((m, i) => {
    const date = (m[2].match(/📅 ([0-9-]+)/) || [])[1] || "(no date)";
    const title = (m[2].match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || "";
    console.log(`  ${i + 1}. ${date}  ${title.replace(/<[^>]+>/g, "").trim().slice(0, 54)}`);
  });
  console.log("  ...");
  cards.slice(-2).forEach((m, i) => {
    const date = (m[2].match(/📅 ([0-9-]+)/) || [])[1] || "(no date)";
    const title = (m[2].match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || "";
    console.log(`  ${cards.length - 1 + i}. ${date}  ${title.replace(/<[^>]+>/g, "").trim().slice(0, 54)}`);
  });
  const badHref = cards.filter(m => !m[1] || m[1].includes('"'));
  console.log(`broken hrefs: ${badHref.length}`);
}, 50);
