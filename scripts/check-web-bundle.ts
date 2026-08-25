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
import { pathToFileURL } from "url";
import { readdir } from "fs/promises";
import { Window } from "happy-dom";
import { findRelativeAssetUrls } from "../src/renderers/electrobun/view/asset-urls";

const HASHED_WEB_MAIN_SRC = /src="(\/web-main\.[A-Za-z0-9_-]+\.js)"/;
const UNHASHED_WEB_MAIN_SRC = /src="\/web-main\.js"/;
const INITIAL_GRAPH_FORBIDDEN = [
  "node_modules/youtubei.js/",
  "node_modules/hls.js/",
  "node_modules/lightweight-charts/",
  "node_modules/jimp/",
  "node_modules/@opentui/",
] as const;

const outdir = process.argv[2] ? dirname(process.argv[2]) : join("dist", "web-client");

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

// Same failure mode as a module-scope Node global: nested routes serve these
// documents, relative assets resolve under the route, SPA fallback returns HTML.
// share.html is served for `/s/{id}`, so it is the one that fails most visibly.
// After a deploy, unhashed /web-main.js 404s (or worse, SPA-falls-back to HTML)
// while hashed chunks have already been replaced.
let hashedWebMainHref: string | null = null;
for (const document of ["index.html", "share.html"]) {
  const htmlPath = join(outdir, document);
  const html = Bun.file(htmlPath);
  if (!await html.exists()) {
    console.error(`No hosted page at ${htmlPath}. Run \`bun run cloud:build\` first.`);
    process.exit(1);
  }
  const htmlText = await html.text();
  const relativeAssets = findRelativeAssetUrls(htmlText);
  if (relativeAssets.length > 0) {
    console.error(
      `${document} references assets with relative URLs: ${relativeAssets.join(", ")}`
      + "\n\nNested routes are served the same document, so these resolve under the route path"
      + "\nand the SPA fallback returns HTML instead of the asset. Use root-absolute URLs.",
    );
    process.exit(1);
  }
  if (document === "index.html") {
    const hashed = htmlText.match(HASHED_WEB_MAIN_SRC);
    if (UNHASHED_WEB_MAIN_SRC.test(htmlText) || !hashed?.[1]) {
      console.error(
        "index.html must reference hashed root-absolute /web-main.<hash>.js, not /web-main.js."
        + "\n\nUnhashed /web-main.js is a stable URL. After a deploy the old hashed chunks"
        + "\nare gone and the SPA fallback serves HTML 200 for missing JS modules.",
      );
      process.exit(1);
    }
    hashedWebMainHref = hashed[1];
    if (!htmlText.includes("__GLOOM_ROBINHOOD_BROWSER_SRC")) {
      console.error(
        "index.html must set window.__GLOOM_ROBINHOOD_BROWSER_SRC to the unsplit"
        + "\nrobinhood-browser.<hash>.js bundle. Split MCP/Zod chunks throw minified"
        + "\nReferenceErrors (`Y0 is not defined`) on Connect Broker.",
      );
      process.exit(1);
    }
  }
}

const bundlePath = process.argv[2] ?? join(outdir, hashedWebMainHref!.slice(1));
const bundle = Bun.file(bundlePath);
if (!await bundle.exists()) {
  console.error(`No bundle at ${bundlePath}. Run \`bun run cloud:build\` first.`);
  process.exit(1);
}
const source = await bundle.text();

try {
  await evaluateHostedEntry(bundlePath, source);
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Hosted bundle failed to evaluate in a browser-like environment.\n${detail}`);
  console.error(
    "\nA module reached from the hosted renderer is reading a Node global at import time."
    + "\nMove the read inside the function that needs it, or keep the module out of the renderer graph.",
  );
  process.exit(1);
}

const names = await readdir(outdir);
const shareFiles = names.filter((name) => /^share-main(\.[A-Za-z0-9_-]+)?\.js$/.test(name));
if (shareFiles.length === 0) {
  console.error(`No share bundle at ${join(outdir, "share-main*.js")}. Run \`bun run cloud:build\` first.`);
  process.exit(1);
}
const shareBundle = Bun.file(join(outdir, shareFiles[0]!));
const shareBytes = shareBundle.size;
const terminalGraphBytes = await reachableBundleBytes(bundlePath);
if (shareBytes > terminalGraphBytes / 4) {
  console.error(
    `Share bundle is ${(shareBytes / 1024).toFixed(0)} KB against a ${(terminalGraphBytes / 1024).toFixed(0)} KB terminal graph.`
    + "\n\nThe share page has pulled in part of the terminal graph. Check for an import that"
    + "\nreaches plugins, the pane registry, or the renderer host.",
  );
  process.exit(1);
}

const entrySources = await readSourceMapSources(bundlePath);
const leaked = entrySources.filter((entry) => INITIAL_GRAPH_FORBIDDEN.some((marker) => entry.includes(marker)));
if (leaked.length > 0) {
  const sample = leaked.slice(0, 8).join("\n  ");
  console.error(
    `Hosted entry ${bundlePath} still contains deferred media/chart modules:\n  ${sample}`
    + "\n\nThose packages must load only when a TV/HLS/chart pane opens (dynamic import + bundle splitting).",
  );
  process.exit(1);
}

const dynamicChunks = referencedDynamicImportChunks(source);
for (const specifier of dynamicChunks) {
  const chunkPath = join(dirname(bundlePath), specifier.slice(2));
  const chunkFile = Bun.file(chunkPath);
  if (!await chunkFile.exists()) {
    console.error(`Hosted entry dynamically imports missing chunk ${specifier}.`);
    process.exit(1);
  }
  try {
    await import(`${pathToFileURL(chunkPath).href}?bundle-check=${Date.now()}`);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Hosted dynamic chunk failed to evaluate: ${specifier}\n${detail}`);
    console.error(
      "\nBun code-splitting dropped a binding from this lazy chunk (Connect Broker shows"
      + "\nthat as a minified ReferenceError like `Y0 is not defined`). Keep the module"
      + "\nin the hosted entry graph, or stop splitting that import.",
    );
    process.exit(1);
  }
}

const robinhoodFiles = names.filter((name) => /^robinhood-browser\.[A-Za-z0-9_-]+\.js$/.test(name));
if (robinhoodFiles.length !== 1) {
  console.error(
    `Expected one hashed robinhood-browser.<hash>.js in ${outdir}, found ${robinhoodFiles.length}.`,
  );
  process.exit(1);
}
try {
  await import(`${pathToFileURL(join(outdir, robinhoodFiles[0]!)).href}?bundle-check=${Date.now()}`);
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Unsplit Robinhood browser bundle failed to evaluate: ${robinhoodFiles[0]}\n${detail}`);
  process.exit(1);
}

console.log(`Hosted bundle evaluates cleanly without \`process\` (${bundlePath}).`);
console.log(`Unsplit Robinhood browser bundle evaluates (${robinhoodFiles[0]}).`);
console.log("Hosted pages reference only root-absolute asset URLs (index.html, share.html).");
console.log(`index.html references hashed ${hashedWebMainHref}.`);
console.log(
  `Share bundle is ${(shareBytes / 1024).toFixed(0)} KB`
  + ` (${((shareBytes / terminalGraphBytes) * 100).toFixed(1)}% of the terminal graph).`,
);
console.log(
  `Terminal entry is ${(Bun.file(bundlePath).size / 1024).toFixed(0)} KB;`
  + ` reachable graph is ${(terminalGraphBytes / 1024).toFixed(0)} KB.`,
);
process.exit(0);

function hasStaticEsmImports(source: string): boolean {
  return /(?:^|[;\n])\s*import\s*(?!\s*\()(?:[\w*{]|["'])/.test(source);
}

async function evaluateHostedEntry(path: string, source: string): Promise<void> {
  if (!hasStaticEsmImports(source)) {
    // Shadowing `process` and `global` as parameters makes any bare reference
    // inside the bundle resolve to undefined, exactly as it does in a browser.
    new Function("process", "global", source)(undefined, undefined);
    return;
  }

  const previous = Object.getOwnPropertyDescriptor(globalThis, "process");
  const previousGlobal = Object.getOwnPropertyDescriptor(globalThis, "global");
  Object.defineProperty(globalThis, "process", { configurable: true, value: undefined, writable: true });
  Object.defineProperty(globalThis, "global", { configurable: true, value: undefined, writable: true });
  try {
    await import(`${pathToFileURL(path).href}?bundle-check=${Date.now()}`);
  } finally {
    if (previous) Object.defineProperty(globalThis, "process", previous);
    else delete (globalThis as { process?: unknown }).process;
    if (previousGlobal) Object.defineProperty(globalThis, "global", previousGlobal);
    else delete (globalThis as { global?: unknown }).global;
  }
}

function referencedRelativeModules(source: string): string[] {
  const matches = source.matchAll(/["'](\.\/(?:chunk|web-main|share-main)[^"']+\.js)["']/g);
  return [...matches].flatMap((match) => match[1] ? [match[1]] : []);
}

function referencedDynamicImportChunks(source: string): string[] {
  const matches = source.matchAll(/import\(["'](\.\/chunk-[^"']+\.js)["']\)/g);
  return [...new Set([...matches].flatMap((match) => match[1] ? [match[1]] : []))];
}

async function reachableBundleBytes(entryPath: string): Promise<number> {
  const directory = dirname(entryPath);
  const pending = [entryPath];
  const seen = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const file = Bun.file(current);
    if (!await file.exists()) continue;
    total += file.size;
    const nextSource = await file.text();
    for (const specifier of referencedRelativeModules(nextSource)) {
      pending.push(join(directory, specifier.slice(2)));
    }
  }
  return total;
}

async function readSourceMapSources(jsPath: string): Promise<string[]> {
  const mapFile = Bun.file(`${jsPath}.map`);
  if (!await mapFile.exists()) return [];
  const map = JSON.parse(await mapFile.text()) as { sources?: unknown };
  if (!Array.isArray(map.sources)) return [];
  return map.sources.filter((entry): entry is string => typeof entry === "string");
}
