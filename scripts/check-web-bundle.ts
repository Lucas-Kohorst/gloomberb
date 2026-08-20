/**
 * Evaluates the built hosted bundle in a DOM with `process` undefined.
 *
 * The hosted client shares most of its module graph with the terminal and
 * desktop builds, so a Node-only module reached from a renderer import is easy
 * to add and invisible in review: bundling succeeds, typecheck succeeds, and
 * every test still passes because the tests run under Bun where `process`
 * exists. The failure only appears in a browser, where a module-scope
 * `process.env` read throws before React mounts and the page hangs on its
 * loading placeholder.
 *
 * Running the real bundle with `process` shadowed reproduces that browser
 * condition, so the failure lands in CI instead of production.
 */
import { dirname, join } from "path";
import { readdir } from "fs/promises";
import { Window } from "happy-dom";
import { findRelativeAssetUrls } from "../src/renderers/electrobun/view/asset-urls";

const bundlePath = process.argv[2] ?? join("dist", "web-client", "web-main.js");

const bundle = Bun.file(bundlePath);
if (!await bundle.exists()) {
  console.error(`No bundle at ${bundlePath}. Run \`bun run cloud:build\` first.`);
  process.exit(1);
}
const source = await bundle.text();

const testWindow = new Window({ url: "https://terminal.kohor.st/" });
testWindow.document.body.innerHTML = '<div id="root"></div>';

const globals: Record<string, unknown> = {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  location: testWindow.location,
  history: testWindow.history,
  localStorage: testWindow.localStorage,
  sessionStorage: testWindow.sessionStorage,
  Event: testWindow.Event,
  CustomEvent: testWindow.CustomEvent,
  MouseEvent: testWindow.MouseEvent,
  HTMLElement: testWindow.HTMLElement,
  Element: testWindow.Element,
  Node: testWindow.Node,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 8),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  // The hosted page sets both before loading the bundle.
  __GLOOM_WEB_SESSION: "bundle-check-session",
  __GLOOM_CLOUD_HOSTED: true,
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, value, writable: true });
}

try {
  // Shadowing `process` and `global` as parameters makes any bare reference
  // inside the bundle resolve to undefined, exactly as it does in a browser.
  new Function("process", "global", source)(undefined, undefined);
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Hosted bundle failed to evaluate in a browser-like environment.\n${detail}`);
  console.error(
    "\nA module reached from the hosted renderer is reading a Node global at import time."
    + "\nMove the read inside the function that needs it, or keep the module out of the renderer graph.",
  );
  process.exit(1);
}

// Same failure mode as a module-scope Node global: nested routes serve these
// documents, relative assets resolve under the route, SPA fallback returns HTML.
// share.html is served for `/s/{id}`, so it is the one that fails most visibly.
const outdir = dirname(bundlePath);
for (const document of ["index.html", "share.html"]) {
  const htmlPath = join(outdir, document);
  const html = Bun.file(htmlPath);
  if (!await html.exists()) {
    console.error(`No hosted page at ${htmlPath}. Run \`bun run cloud:build\` first.`);
    process.exit(1);
  }
  const relativeAssets = findRelativeAssetUrls(await html.text());
  if (relativeAssets.length > 0) {
    console.error(
      `${document} references assets with relative URLs: ${relativeAssets.join(", ")}`
      + "\n\nNested routes are served the same document, so these resolve under the route path"
      + "\nand the SPA fallback returns HTML instead of the asset. Use root-absolute URLs.",
    );
    process.exit(1);
  }
}

// A share link that costs a terminal-sized download is the thing this page
// exists to avoid, so the size gap is worth failing on rather than trusting.
const shareFiles = (await readdir(outdir)).filter((name) => /^share-main(\.[A-Za-z0-9_-]+)?\.js$/.test(name));
if (shareFiles.length === 0) {
  console.error(`No share bundle at ${join(outdir, "share-main*.js")}. Run \`bun run cloud:build\` first.`);
  process.exit(1);
}
const shareBundle = Bun.file(join(outdir, shareFiles[0]!));
const shareBytes = shareBundle.size;
const terminalBytes = bundle.size;
if (shareBytes > terminalBytes / 4) {
  console.error(
    `Share bundle is ${(shareBytes / 1024).toFixed(0)} KB against a ${(terminalBytes / 1024).toFixed(0)} KB terminal bundle.`
    + "\n\nThe share page has pulled in part of the terminal graph. Check for an import that"
    + "\nreaches plugins, the pane registry, or the renderer host.",
  );
  process.exit(1);
}

console.log(`Hosted bundle evaluates cleanly without \`process\` (${bundlePath}).`);
console.log("Hosted pages reference only root-absolute asset URLs (index.html, share.html).");
console.log(
  `Share bundle is ${(shareBytes / 1024).toFixed(0)} KB`
  + ` (${((shareBytes / terminalBytes) * 100).toFixed(1)}% of the terminal bundle).`,
);
process.exit(0);
