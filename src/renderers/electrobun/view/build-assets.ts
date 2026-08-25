import { copyFile, readFile, rename, writeFile } from "fs/promises";
import { dirname, join, relative } from "path";
import { TITLEBAR_OVERLAY_HEIGHT_PX } from "../../../components/layout/titlebar-overlay";
import { toRootAbsoluteAssetUrl } from "./asset-urls";

type AliasRule = readonly [string, string] | readonly [string, string, string];
type PageOptions = {
  entrypoint: string;
  outdir: string;
  pluginName: string;
  extraAliasRules?: AliasRule[];
  failureMessage: string;
  missingEntryMessage: string;
  title: string;
  loadingText: string;
  bootstrapScript: string;
  /** Async chunks for heavy media/chart deps. Desktop stays a single file. */
  splitting?: boolean;
};

const ELECTROBUN_VIEW_DIR = join(process.cwd(), "src", "renderers", "electrobun", "view");
const SHARE_VIEW_DIR = join(process.cwd(), "src", "renderers", "share");
const COMMON_ALIAS_RULES: AliasRule[] = [
  ["notes-files", "notes-files.ts"],
  ["./files", "plugins/builtin/notes/index.tsx", "notes-files.ts"],
  ["native/kitty/support", "native-stubs/chart/kitty-support.ts"],
  ["./kitty/support", "components/chart/native/renderer-selection.ts", "native-stubs/chart/kitty-support.ts"],
  ["native/surface/manager", "native-stubs/chart/surface-manager.ts"],
  ["native/surface/sync", "native-stubs/chart/surface-sync.ts"],
  ["./native-loader", "plugins/ibkr/gateway/service/index.ts", "native-stubs/ibkr-native-loader.ts"],
  ["./native-loader", "plugins/broker-sync/robinhood.ts", "native-stubs/broker-sync-native-loader.ts"],
];

export function electrobunViewPath(...parts: string[]): string {
  return join(ELECTROBUN_VIEW_DIR, ...parts);
}

export async function writeElectrobunViewPage(options: PageOptions): Promise<string> {
  const { entrySrc, stylesheet } = await buildElectrobunViewBundle(options);
  const htmlPath = join(options.outdir, "index.html");
  await writeFile(htmlPath, renderElectrobunViewHtml({
    ...options,
    stylesheet,
    entrySrc,
  }));
  return htmlPath;
}

export async function writeWebClientPage(options: Omit<PageOptions, "pluginName"> & { sessionToken: string }): Promise<string> {
  const { entrySrc, stylesheet } = await buildElectrobunViewBundle({
    ...options,
    pluginName: "gloomberb-web-client-renderer",
    // youtubei.js / hls.js / lightweight-charts are dynamic imports. Without
    // splitting Bun inlines them into web-main.js and Portfolio pays for TV.
    splitting: true,
    extraAliasRules: [
      ["./backend-rpc", "web-backend-rpc.ts"],
      ["./native-loader", "plugins/broker-sync/robinhood.ts", "native-stubs/broker-sync-native-loader-hosted.ts"],
      ...(options.extraAliasRules ?? []),
    ],
  });
  await copyFile(electrobunViewPath("favicon.svg"), join(options.outdir, "favicon.svg"));
  const hashedEntryPath = await hashJsEntrypoint(
    join(options.outdir, entrySrc.replace(/^\.\//, "")),
    "web-main",
  );
  const robinhoodBrowserSrc = await writeRobinhoodBrowserBundle(options.outdir);
  const htmlPath = join(options.outdir, "index.html");
  // Nested routes (`/s/{id}`) serve this same document; relative `./web-main.js`
  // would resolve under `/s/` and the SPA fallback would return HTML instead of
  // the module. Desktop keeps relative URLs (file/custom scheme, no origin root).
  const absoluteEntrySrc = toRootAbsoluteAssetUrl(
    `./${relative(options.outdir, hashedEntryPath).replaceAll("\\", "/")}`,
  );
  await writeFile(htmlPath, renderElectrobunViewHtml({
    ...options,
    pluginName: "gloomberb-web-client-renderer",
    stylesheet,
    entrySrc: absoluteEntrySrc,
    faviconHref: toRootAbsoluteAssetUrl("favicon.svg"),
    bootstrapScript: `window.__GLOOM_WEB_SESSION = ${JSON.stringify(options.sessionToken)};\nwindow.__GLOOM_ROBINHOOD_BROWSER_SRC = ${JSON.stringify(robinhoodBrowserSrc)};\n${options.bootstrapScript}`,
  }));
  return htmlPath;
}

/**
 * Unsplit MCP/Zod graph. Hosted `splitting: true` drops Zod `util` bindings
 * from the lazy Robinhood chunk (`Y0 is not defined` on Connect Broker).
 */
async function writeRobinhoodBrowserBundle(outdir: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(process.cwd(), "src", "plugins", "broker-sync", "robinhood-browser.ts")],
    outdir,
    target: "browser",
    format: "esm",
    splitting: false,
    sourcemap: "external",
    minify: true,
    define: {
      "process.env.NODE_ENV": "\"production\"",
    },
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).filter(Boolean).join("\n");
    throw new Error(details ? `Failed to build Robinhood browser bundle\n${details}` : "Failed to build Robinhood browser bundle");
  }
  const entry = result.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"));
  if (!entry) throw new Error("Robinhood browser build did not produce a JavaScript entrypoint");
  const hashedPath = await hashJsEntrypoint(entry.path, "robinhood-browser");
  return toRootAbsoluteAssetUrl(`./${relative(outdir, hashedPath).replaceAll("\\", "/")}`);
}

/**
 * Builds the slim share page (`share.html` + `share-main.js`).
 *
 * A separate entrypoint, not a route inside the terminal bundle: the point of
 * the share page is that opening a link does not download the workspace. Sharing
 * the bundle would give up the only thing that makes it fast.
 */
export async function writeSharePage(options: {
  outdir: string;
  title: string;
  loadingText: string;
}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(SHARE_VIEW_DIR, "share-main.tsx")],
    outdir: options.outdir,
    target: "browser",
    format: "esm",
    // Unlike the terminal bundle, splitting is on so the chart renderer stays a
    // separate chunk that only chart shares fetch.
    splitting: true,
    sourcemap: "external",
    minify: true,
    define: { "process.env.NODE_ENV": "\"production\"" },
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).filter(Boolean).join("\n");
    throw new Error(details ? `Failed to build share page\n${details}` : "Failed to build share page");
  }
  const entry = result.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"));
  if (!entry) throw new Error("Share page build did not produce a JavaScript entrypoint");
  const hashedEntryPath = await hashJsEntrypoint(entry.path, "share-main");

  const htmlPath = join(options.outdir, "share.html");
  await writeFile(htmlPath, renderSharePageHtml({
    title: options.title,
    loadingText: options.loadingText,
    stylesheet: await readFile(join(SHARE_VIEW_DIR, "styles.css"), "utf8"),
    // The share document is served for `/s/{id}` and `/article`, so a relative
    // URL would resolve under the route and hit the SPA fallback.
    entrySrc: toRootAbsoluteAssetUrl(`./${relative(options.outdir, hashedEntryPath).replaceAll("\\", "/")}`),
    faviconHref: toRootAbsoluteAssetUrl("favicon.svg"),
  }));
  return htmlPath;
}

/**
 * `/web-main.js` and `/share-main.js` are stable URLs. Browsers that once
 * received `immutable` keep that file for a year without revalidating, so a
 * logged-in profile can keep an old bundle while incognito gets the current
 * one. Hash the filename; HTML is already must-revalidate/no-store, so it
 * picks up the new URL. After a deploy the unhashed name 404s instead of
 * serving SPA HTML for a missing module.
 */
async function hashJsEntrypoint(entryPath: string, basename: string): Promise<string> {
  const bytes = await Bun.file(entryPath).arrayBuffer();
  const hash = Bun.hash(new Uint8Array(bytes)).toString(16).padStart(16, "0").slice(0, 10);
  const hashedPath = join(dirname(entryPath), `${basename}.${hash}.js`);
  if (hashedPath === entryPath) return entryPath;
  await rename(entryPath, hashedPath);
  return hashedPath;
}

function renderSharePageHtml({
  title,
  loadingText,
  stylesheet,
  entrySrc,
  faviconHref,
}: {
  title: string;
  loadingText: string;
  stylesheet: string;
  entrySrc: string;
  faviconHref: string;
}): string {
  return `<!doctype html>
<html lang="en" autocomplete="off">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="${faviconHref}" />
    <title>${title}</title>
    <style>${stylesheet}</style>
  </head>
  <body>
    <div id="root"><div class="share-main"><div class="share-loading-body">${loadingText}</div></div></div>
    <script type="module" src="${entrySrc}"></script>
  </body>
</html>
`;
}

async function buildElectrobunViewBundle({
  entrypoint,
  outdir,
  pluginName,
  extraAliasRules = [],
  failureMessage,
  missingEntryMessage,
  splitting = false,
}: PageOptions): Promise<{ entrySrc: string; stylesheet: string }> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: "browser",
    format: "esm",
    splitting,
    sourcemap: "external",
    minify: true,
    define: {
      "process.env.NODE_ENV": "\"production\"",
    },
    plugins: [
      {
        name: pluginName,
        setup(build) {
          const aliasRules = [...extraAliasRules, ...COMMON_ALIAS_RULES];
          build.onResolve({ filter: /.*/ }, (args) => resolveAlias(args, aliasRules));
        },
      },
    ],
  });

  if (!result.success) {
    const details = result.logs.map((log) => log.message).filter(Boolean).join("\n");
    throw new Error(details ? `${failureMessage}\n${details}` : failureMessage);
  }

  const entry = result.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"));
  if (!entry) throw new Error(missingEntryMessage);

  return {
    entrySrc: `./${relative(outdir, entry.path).replaceAll("\\", "/")}`,
    stylesheet: (await readFile(electrobunViewPath("styles.css"), "utf8"))
      .replaceAll("__TITLEBAR_OVERLAY_HEIGHT_PX__", String(TITLEBAR_OVERLAY_HEIGHT_PX)),
  };
}

function renderElectrobunViewHtml({
  title,
  loadingText,
  stylesheet,
  bootstrapScript,
  entrySrc,
  faviconHref = "favicon.svg",
}: PageOptions & { stylesheet: string; entrySrc: string; faviconHref?: string }): string {
  return `<!doctype html>
<html lang="en" autocomplete="off">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="${faviconHref}" />
    <title>${title}</title>
    <style>${stylesheet}</style>
  </head>
  <body style="margin:0;background:#000;">
    <div id="root"><div class="gloom-loading">${loadingText}</div></div>
    <script>
${bootstrapScript}
    </script>
    <script type="module" src="${entrySrc}"></script>
  </body>
</html>
`;
}

function resolveAlias(args: { path: string; importer?: string }, aliasRules: AliasRule[]) {
  const importer = args.importer?.replaceAll("\\", "/");
  for (const rule of aliasRules) {
    const target = rule.length === 2
      ? args.path.endsWith(rule[0]) && rule[1]
      : args.path === rule[0] && importer?.endsWith(rule[1]) && rule[2];
    if (target) return { path: electrobunViewPath(target) };
  }
}
