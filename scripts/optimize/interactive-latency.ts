/**
 * Measurement harness for ce-optimize spec `interactive-latency`.
 *
 * Prints one JSON object to stdout. Experiments must not modify this file.
 * Extra logs go to stderr so measure.sh can parse stdout.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newsProvider } from "../../src/capabilities";
import { NewsService } from "../../src/news/aggregator";
import type { NewsArticle } from "../../src/news/types";
import { searchNewsArticles } from "../../src/plugins/builtin/news/wire/article-search";
import { encodeRpcValue } from "../../src/renderers/electrobun/view/rpc-codec";
import { TickerRefreshQueue } from "../../src/state/ticker-refresh-queue";
import { fuzzyFilter } from "../../src/utils/fuzzy-search";
import {
  enableUiYield,
  resetUiYieldForTests,
  setUiYieldReason,
  shouldYieldToUi,
  subscribeUiYield,
  UI_YIELD_QUIET_MS,
} from "../../src/utils/ui-yield";

const ROOT = join(import.meta.dir, "../..");

const TARGETED_TESTS = [
  "src/utils/ui-yield.test.ts",
  "src/utils/startup-interaction.test.ts",
  "src/state/ticker-refresh-queue.test.ts",
  "src/news/aggregator.test.ts",
];

const POLL_MODULES = [
  "src/plugins/builtin/shared/use-auto-refresh.ts",
  "src/plugins/prediction-markets/controller/catalog.ts",
  "src/state/hooks/quote-streaming.ts",
] as const;

const SAMPLE_COUNT = 24;
const LEAKY_SLICE_MS = 2;
const QUEUE_SLICE_MS = 4;

function now(): number {
  return performance.now();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const weight = rank - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

function median(values: number[]): number {
  return percentile(values, 50);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function burnCpu(ms: number): void {
  const start = now();
  let acc = 0;
  while (now() - start < ms) {
    acc += Math.sqrt((acc % 1000) + 1);
  }
  if (acc < 0) throw new Error("unreachable");
}

function moduleYieldsOnPoll(relPath: string): boolean {
  const text = readFileSync(join(ROOT, relPath), "utf8");
  const importsYield = /from ["'][^"']*ui-yield["']/.test(text);
  const uses = /\bshouldYieldToUi\b/.test(text) || /\bwhenUiQuiet\b/.test(text);
  return importsYield && uses;
}

function kittyRendererIntact(): boolean {
  const selection = readFileSync(join(ROOT, "src/components/chart/native/renderer-selection.ts"), "utf8");
  const types = readFileSync(join(ROOT, "src/types/config.ts"), "utf8");
  const disabled = /kitty_graphics\s*:\s*false/.test(selection)
    || /preference\s*=\s*["']braille["']/.test(selection)
    || !selection.includes("nativeReady ? \"kitty\"")
    || !selection.includes("preference === \"kitty\"");
  return !disabled && types.includes("\"kitty\"");
}

function runTargetedTests(): boolean {
  const result = spawnSync("bun", ["test", ...TARGETED_TESTS], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

function makeArticle(index: number): NewsArticle {
  const topics = ["markets", "energy", "fed", "earnings", "crypto"][index % 5]!;
  return {
    id: `art-${index}`,
    title: `${topics} headline ${index} Trump oil Hormuz Fed funds`,
    url: `https://example.com/${index}`,
    source: index % 2 === 0 ? "Adjacent Press" : "Wire",
    publishedAt: new Date(1_700_000_000_000 + index * 60_000),
    summary: `Summary for article ${index} covering ${topics} and ticker flow.`,
    topic: topics,
    topics: [topics],
    sectors: [],
    categories: [topics],
    tickers: index % 7 === 0 ? ["SPY"] : [],
    scores: { importance: 50, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 50,
  };
}

function makeQuoteSnapshot(size: number): Map<string, Record<string, unknown>> {
  const snapshot = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < size; i++) {
    snapshot.set(`SYM${i}`, {
      price: 100 + (i % 17),
      change: i % 2 === 0 ? 0.4 : -0.2,
      volume: 1_000 + i,
      asOf: new Date(1_700_000_000_000 + i),
    });
  }
  return snapshot;
}

async function nextTick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function measureEventLoopDelay(): Promise<number> {
  const start = now();
  await nextTick();
  return now() - start;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureYieldDeferral(articles: NewsArticle[]): Promise<{
  yieldDefersBackground: boolean;
  quoteStartsDuringYield: number;
}> {
  resetUiYieldForTests();
  enableUiYield();

  const queue = new TickerRefreshQueue(3);
  const started: string[] = [];
  const syncPause = () => {
    queue.setPaused(shouldYieldToUi());
  };
  const unsubscribe = subscribeUiYield(syncPause);
  syncPause();

  setUiYieldReason("input", true);
  for (let i = 0; i < 6; i++) {
    queue.enqueue({
      key: `yield-task-${i}`,
      priority: 1,
      run: async () => {
        started.push(`yield-task-${i}`);
        burnCpu(QUEUE_SLICE_MS);
      },
    });
  }
  await nextTick();
  await sleep(20);
  const quoteStartsDuringYield = started.length;
  setUiYieldReason("input", false);
  await sleep(UI_YIELD_QUIET_MS + 20);
  unsubscribe();

  const news = new NewsService();
  news.register(newsProvider({
    id: "bench-rss",
    name: "bench-rss",
    provider: {
      fetchNews: async () => articles.slice(0, 80),
    },
  }));
  const seen: number[] = [];
  const dispose = news.subscribe(() => {
    seen.push(news.getVersion());
  });
  setUiYieldReason("command-bar", true);
  const loading = news.load({ feed: "latest", limit: 80 });
  await sleep(20);
  const notifiedDuringYield = seen.length > 0;
  setUiYieldReason("command-bar", false);
  await loading;
  await sleep(UI_YIELD_QUIET_MS + 20);
  dispose();
  news.stop();
  resetUiYieldForTests();

  return {
    yieldDefersBackground: quoteStartsDuringYield === 0 && !notifiedDuringYield,
    quoteStartsDuringYield,
  };
}

async function measureInteractiveLatency(articles: NewsArticle[], commands: Array<{ label: string }>): Promise<{
  stalls: number[];
  commandBarMs: number[];
  articleSearchMs: number[];
  backgroundCpuDuringYieldMs: number;
  unawarePollerCount: number;
}> {
  resetUiYieldForTests();
  enableUiYield();

  const snapshot = makeQuoteSnapshot(80);
  const pollers = POLL_MODULES.map((path) => ({
    path,
    respectsYield: moduleYieldsOnPoll(path),
  }));
  const unawarePollerCount = pollers.filter((poller) => !poller.respectsYield).length;

  const queue = new TickerRefreshQueue(3);
  const unsubscribe = subscribeUiYield(() => {
    queue.setPaused(shouldYieldToUi());
  });
  queue.setPaused(shouldYieldToUi());
  for (let i = 0; i < 12; i++) {
    queue.enqueue({
      key: `bg-quote-${i}`,
      priority: 2,
      run: async () => {
        encodeRpcValue(snapshot);
        burnCpu(QUEUE_SLICE_MS);
      },
    });
  }

  let backgroundCpuDuringYieldMs = 0;
  const pollTimer = setInterval(() => {
    const yielding = shouldYieldToUi();
    for (const poller of pollers) {
      if (poller.respectsYield && yielding) continue;
      const start = now();
      encodeRpcValue(snapshot);
      burnCpu(LEAKY_SLICE_MS);
      if (yielding) backgroundCpuDuringYieldMs += now() - start;
    }
  }, 8);

  const stalls: number[] = [];
  const commandBarMs: number[] = [];
  const articleSearchMs: number[] = [];
  const queries = ["ART trump", "ART hormuz", "CAT spy", "chat", "layout"];

  setUiYieldReason("input", true);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    stalls.push(await measureEventLoopDelay());
  }
  setUiYieldReason("input", false);
  await sleep(UI_YIELD_QUIET_MS + 5);

  setUiYieldReason("command-bar", true);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const query = queries[i % queries.length]!;
    const searchStart = now();
    searchNewsArticles(articles, query);
    articleSearchMs.push(now() - searchStart);
    const commandStart = now();
    searchNewsArticles(articles, query);
    fuzzyFilter(commands, query.replace(/^ART\s+/i, ""), (item) => item.label);
    commandBarMs.push(now() - commandStart);
    stalls.push(await measureEventLoopDelay());
  }
  setUiYieldReason("command-bar", false);
  await sleep(UI_YIELD_QUIET_MS + 5);

  setUiYieldReason("pointer", true);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    stalls.push(await measureEventLoopDelay());
  }
  setUiYieldReason("pointer", false);
  await sleep(UI_YIELD_QUIET_MS + 5);

  clearInterval(pollTimer);
  unsubscribe();
  resetUiYieldForTests();

  return {
    stalls,
    commandBarMs,
    articleSearchMs,
    backgroundCpuDuringYieldMs,
    unawarePollerCount,
  };
}

async function main(): Promise<void> {
  const targetedTestsPassed = runTargetedTests();
  const kittyIntact = kittyRendererIntact();
  const articles = Array.from({ length: 200 }, (_, index) => makeArticle(index));
  const commands = Array.from({ length: 400 }, (_, index) => ({
    label: `${["Open", "Show", "Catalog", "Chat", "Layout"][index % 5]} pane ${index}`,
  }));

  const deferral = await measureYieldDeferral(articles);
  const latency = await measureInteractiveLatency(articles, commands);

  const metrics = {
    interactive_latency_ms: round1(percentile(latency.stalls, 95)),
    targeted_tests_passed: targetedTestsPassed ? 1 : 0,
    yield_defers_background: deferral.yieldDefersBackground ? 1 : 0,
    kitty_renderer_intact: kittyIntact ? 1 : 0,
    command_bar_query_ms: round1(median(latency.commandBarMs)),
    article_search_ms: round1(median(latency.articleSearchMs)),
    quote_starts_during_yield: deferral.quoteStartsDuringYield,
    background_cpu_during_yield_ms: round1(latency.backgroundCpuDuringYieldMs),
    unaware_poller_count: latency.unawarePollerCount,
  };

  process.stdout.write(`${JSON.stringify(metrics)}\n`);
  if (metrics.targeted_tests_passed !== 1) process.exitCode = 1;
}

await main();
