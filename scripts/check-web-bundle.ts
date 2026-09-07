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
import { Window } from "happy-dom";
import { findRelativeAssetUrls } from "../src/renderers/electrobun/view/asset-urls";

const SCRIPT_SRCS = /<script[^>]*\bsrc="(\/[^"]+\.js)"[^>]*>/g;
const HASHED_SCRIPT_SRC = /^\/[\w/.-]*[.-][\w-]{8,}\.js$/;
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
Object.assign(testWindow, {
  __GLOOM_WEB_SESSION: "bundle-check-session",
  __GLOOM_CLOUD_HOSTED: true,
});

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
// After a deploy, an unhashed bundle URL keeps serving whatever the CDN cached
// while its hashed siblings are gone, so every script a page references must
// carry its content hash in the file name.
let hostedEntryHref: string | null = null;
let shareEntryHref: string | null = null;
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
  const scripts = [...htmlText.matchAll(SCRIPT_SRCS)].map((match) => match[1]!);
  const unhashed = scripts.filter((src) => !HASHED_SCRIPT_SRC.test(src));
  if (scripts.length === 0 || unhashed.length > 0) {
    console.error(
      `${document} must reference hashed root-absolute bundles (name-<hash>.js);`
      + ` found: ${scripts.join(", ") || "(none)"}.`
      + "\n\nAn unhashed bundle URL is stable across deploys. After a deploy the old files"
      + "\nare gone and the SPA fallback serves HTML 200 for missing JS modules.",
    );
    process.exit(1);
  }
  if (document === "index.html") hostedEntryHref = scripts[0]!;
  else shareEntryHref = scripts[0]!;
}

const bundlePath = process.argv[2] ?? join(outdir, hostedEntryHref!.slice(1));
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

const shareBundle = Bun.file(join(outdir, shareEntryHref!.slice(1)));
if (!await shareBundle.exists()) {
  console.error(`No share bundle at ${shareEntryHref}. Run \`bun run cloud:build\` first.`);
  process.exit(1);
}
const shareBytes = shareBundle.size;
const terminalGraph = await inspectBundleGraph(bundlePath);
const terminalGraphBytes = terminalGraph.bytes;
if (!terminalGraph.sources.some((path) => path.endsWith("plugins/catalog-ui.ts"))
  || terminalGraph.sources.some((path) => path.endsWith("plugins/catalog-browser.ts"))) {
  throw new Error("Hosted client must ship the desktop plugin catalog; the reduced browser catalog drops Firehose, Marketplace, and other fork panes.");
}
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

try {
  await evaluateHostedEntry(join(outdir, shareEntryHref!.slice(1)), await shareBundle.text());
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Share bundle failed to evaluate in a browser-like environment.\n${detail}`);
  process.exit(1);
}

console.log(`Hosted bundle evaluates cleanly without \`process\` (${bundlePath}).`);
console.log(`Share bundle evaluates cleanly without \`process\` (${shareEntryHref}).`);
console.log("Hosted pages reference only root-absolute asset URLs (index.html, share.html).");
console.log(`index.html references hashed ${hostedEntryHref}.`);
console.log(
  `Share bundle is ${(shareBytes / 1024).toFixed(0)} KB`
  + ` (${((shareBytes / terminalGraphBytes) * 100).toFixed(1)}% of the terminal graph).`,
);
console.log(
  `Terminal entry is ${(Bun.file(bundlePath).size / 1024).toFixed(0)} KB;`
  + ` reachable graph is ${(terminalGraphBytes / 1024).toFixed(0)} KB.`,
);
process.exit(0);

function needsModuleEvaluation(source: string): boolean {
  // import.meta only parses in module scope, so even a bundle with no static
  // imports must load through import() when it uses it.
  return /(?:^|[;\n])\s*import\s*(?!\s*\()(?:[\w*{]|["'])/.test(source) || source.includes("import.meta");
}

async function evaluateHostedEntry(path: string, source: string): Promise<void> {
  if (!needsModuleEvaluation(source)) {
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
  const matches = source.matchAll(/["'](\.\/[\w.-]+\.js)["']/g);
  return [...matches].flatMap((match) => match[1] ? [match[1]] : []);
}

function referencedDynamicImportChunks(source: string): string[] {
  const matches = source.matchAll(/import\(["'](\.\/chunk-[^"']+\.js)["']\)/g);
  return [...new Set([...matches].flatMap((match) => match[1] ? [match[1]] : []))];
}

async function inspectBundleGraph(entryPath: string): Promise<{ bytes: number; sources: string[] }> {
  const directory = dirname(entryPath);
  const pending = [entryPath];
  const seen = new Set<string>();
  let total = 0;
  const sources = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const file = Bun.file(current);
    if (!await file.exists()) continue;
    total += file.size;
    for (const source of await readSourceMapSources(current)) sources.add(source);
    const nextSource = await file.text();
    for (const specifier of referencedRelativeModules(nextSource)) {
      pending.push(join(directory, specifier.slice(2)));
    }
  }
  return { bytes: total, sources: [...sources] };
}

async function readSourceMapSources(jsPath: string): Promise<string[]> {
  const source = await Bun.file(jsPath).text();
  const sourceMapUrl = source.match(/\/\/# sourceMappingURL=([^\s]+)/)?.[1];
  const mapFile = Bun.file(sourceMapUrl ? join(dirname(jsPath), sourceMapUrl) : `${jsPath}.map`);
  if (!await mapFile.exists()) return [];
  const map = JSON.parse(await mapFile.text()) as { sources?: unknown };
  if (!Array.isArray(map.sources)) return [];
  return map.sources.filter((entry): entry is string => typeof entry === "string");
}
