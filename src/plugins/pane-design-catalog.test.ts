/**
 * Static catalog scans for AGENTS.md connection registration and ART
 * written-text search. These do not render panes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CommandDef, GloomPluginContext } from "../types/plugin";
import { shouldSearchWrittenCorpus } from "../components/command-bar/routes/root/article-results";
import { adjacentPlugin } from "./builtin/adjacent";
import { newsPlugin } from "./builtin/news";
import { DEFAULT_FEEDS } from "./builtin/news/wire/default-feeds";
import { newsWireModule } from "./builtin/news/wire";
import {
  ARTICLE_SEARCH_QUERY,
  looksLikeArticleQuery,
} from "./builtin/news/wire/article-search";
import { NEWS_ARTICLE_READER_PANE_ID } from "./builtin/shared/article-pop-out";

const PLUGINS_ROOT = import.meta.dir;
const BUILTIN_ROOT = join(PLUGINS_ROOT, "builtin");
const PREDICTION_MARKETS_ROOT = join(PLUGINS_ROOT, "prediction-markets");
const SETUP_FILENAMES = new Set(["index.ts", "index.tsx", "registration.ts"]);
const SOURCE_EXT = /\.(ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

/** Real fetch-path calls. `prefetch(` / `refetch(` are not network. */
const NETWORK_RE =
  /(?<!\w)fetch\s*\(|globalThis\.fetch\s*\(|apiClient\.|withConnectionRequest\s*\(|new\s+WebSocket\b|(?<!\w)WebSocket\s*\(/;
/** registerConnectionSource plus helpers that wrap it. */
const REGISTER_RE =
  /registerConnectionSource\s*\(|createChartSource\s*\(|createFeedSource\s*\(|createConnection\s*\(|createDocumentSource\s*\(/;
const SETUP_RE = /\bsetup\s*\(/;

const WRITTEN_TEXT_LIST_PANE_IDS = [
  "news-top",
  "news-feed",
  "news-industry",
  "news-rss",
  "news-breaking",
  "news-firehose",
] as const;

function isSourceFile(name: string): boolean {
  return SOURCE_EXT.test(name) && !TEST_FILE.test(name) && !name.endsWith(".d.ts");
}

function listDirNames(dir: string): string[] {
  return readdirSync(dir).filter((name) => {
    if (name.startsWith(".")) return false;
    return statSync(join(dir, name)).isDirectory();
  });
}

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const name of readdirSync(current)) {
      if (name.startsWith(".")) continue;
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (name === "node_modules") continue;
        visit(full);
        continue;
      }
      if (isSourceFile(name)) files.push(full);
    }
  };
  visit(dir);
  return files;
}

function hasSetupEntry(pluginDir: string): boolean {
  for (const name of SETUP_FILENAMES) {
    const full = join(pluginDir, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (SETUP_RE.test(readFileSync(full, "utf8"))) return true;
  }
  return false;
}

function isSetupOrClientFile(pluginDir: string, file: string): boolean {
  const rel = relative(pluginDir, file);
  if (SETUP_FILENAMES.has(rel)) return true;
  const base = rel.split(/[/\\]/).pop() ?? rel;
  return base === "client.ts" || base === "client.tsx";
}

interface FetchingPlugin {
  id: string;
  dir: string;
  fetchFiles: string[];
  registerFiles: string[];
}

function firstPartyPluginDirs(): Array<{ id: string; dir: string }> {
  const dirs = listDirNames(BUILTIN_ROOT)
    .filter((name) => name !== "shared")
    .map((name) => ({ id: name, dir: join(BUILTIN_ROOT, name) }));
  dirs.push({ id: "prediction-markets", dir: PREDICTION_MARKETS_ROOT });
  return dirs.filter((plugin) => hasSetupEntry(plugin.dir));
}

function scanFetchingPlugins(): FetchingPlugin[] {
  const found: FetchingPlugin[] = [];
  for (const plugin of firstPartyPluginDirs()) {
    const sources = walkSourceFiles(plugin.dir);
    const fetchFiles = sources.filter((file) => (
      isSetupOrClientFile(plugin.dir, file) && NETWORK_RE.test(readFileSync(file, "utf8"))
    ));
    if (fetchFiles.length === 0) continue;
    const registerFiles = sources.filter((file) => REGISTER_RE.test(readFileSync(file, "utf8")));
    found.push({
      id: plugin.id,
      dir: plugin.dir,
      fetchFiles: fetchFiles.map((file) => relative(plugin.dir, file)),
      registerFiles: registerFiles.map((file) => relative(plugin.dir, file)),
    });
  }
  return found;
}

async function collectRegisteredCommands(
  setup: ((ctx: GloomPluginContext) => unknown) | undefined,
): Promise<CommandDef[]> {
  const commands: CommandDef[] = [];
  const ctx = {
    configState: {
      get: () => null,
      set: async () => {},
      delete: async () => {},
      keys: () => [],
    },
    persistence: {
      getResource: () => null,
      setResource() {},
      getState: () => null,
      setState() {},
    },
    tickerRepository: { loadAllTickers: async () => [] },
    registerCapability() {},
    registerCommand(command: CommandDef) {
      commands.push(command);
    },
    registerTickerResearchTab() {},
    registerDocumentSearchProvider: () => () => {},
    registerChartSeriesCatalog: () => () => {},
    registerCommandBarSearchProvider() {},
    registerAgentPromptFragment() {},
    createPaneFromTemplate() {},
    notify() {},
    on: () => () => {},
    log: { warn() {}, info() {} },
    resume: { setPaneState() {} },
    focusPane() {},
  } as unknown as GloomPluginContext;
  await setup?.(ctx);
  return commands;
}

describe("pane design catalog — connections", () => {
  test("plugins that fetch on the real path also register a connection source", () => {
    const fetching = scanFetchingPlugins();
    expect(fetching.length).toBeGreaterThan(0);

    const gaps = fetching.filter((plugin) => plugin.registerFiles.length === 0);
    expect(
      gaps,
      gaps.map((plugin) => (
        `${plugin.id} fetches via ${plugin.fetchFiles.join(", ")} but never calls registerConnectionSource/createChartSource (${plugin.dir})`
      )).join("\n"),
    ).toEqual([]);
  });
});

describe("pane design catalog — ART / written-text", () => {
  afterEach(() => {
    newsPlugin.dispose?.();
  });

  test("news plugin still registers the ART article lookup command", async () => {
    const commands = await collectRegisteredCommands(newsPlugin.setup ?? newsWireModule.setup);
    const art = commands.find((command) => command.shortcut === "ART");
    expect(art, "news plugin must register command-bar shortcut ART").toBeDefined();
    expect(art?.id).toBe("open-news-article");
    expect(art?.label).toBe("Open Article");

    const description = (art?.description ?? "").toLowerCase();
    const keywords = (art?.keywords ?? []).join(" ").toLowerCase();
    const inventory = `${description} ${keywords}`;
    expect(inventory).toContain("article");
    expect(inventory).toContain("headline");
    expect(inventory).toContain("rss");

    const buildResultsSource = Function.prototype.toString.call(art?.buildResults);
    expect(buildResultsSource).toContain("buildOpenArticleCommandResults");
    expect(buildResultsSource).toContain("cachedNewsArticles");
    const executeSource = Function.prototype.toString.call(art?.execute);
    expect(executeSource).toContain("loadNewsArticles");
    expect(executeSource).toContain("searchAdjacentRelatedArticles");

    expect(ARTICLE_SEARCH_QUERY.feed).toBe("latest");
    expect(looksLikeArticleQuery("ART hormuz")).toBe(true);
    expect(shouldSearchWrittenCorpus("ART hormuz")).toBe(true);
  });

  test("written-text article list panes stay on the ART lookup path", () => {
    const paneIds = new Set((newsPlugin.panes ?? []).map((pane) => pane.id));
    const presentListPanes = WRITTEN_TEXT_LIST_PANE_IDS.filter((id) => paneIds.has(id));
    expect(presentListPanes).toEqual([...WRITTEN_TEXT_LIST_PANE_IDS]);
    expect(paneIds.has(NEWS_ARTICLE_READER_PANE_ID)).toBe(true);

    expect(DEFAULT_FEEDS.some((feed) => feed.id === "adjacent-press" && feed.enabled)).toBe(true);

    // Adjacent news has no list pane of its own; ART execute still searches it.
    expect((adjacentPlugin.panes ?? []).some((pane) => pane.id.includes("news"))).toBe(false);

    // Substack list panes live in the extracted plugin; first-party coverage is
    // the firehose latest pool that ART scores.
    const firehose = (newsPlugin.paneTemplates ?? []).find((template) => template.paneId === "news-firehose");
    const firehoseText = [
      firehose?.description ?? "",
      ...(firehose?.keywords ?? []),
    ].join(" ").toLowerCase();
    expect(firehoseText).toContain("substack");
    expect(firehoseText).toContain("rss");
    expect(firehoseText).toContain("adjacent");
  });
});
