import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { NewsService } from "./aggregator";
import { newsProvider, type NewsCapability } from "../capabilities";
import type { MarketNewsItem } from "../types/news-source";
import { resetUiYieldForTests, setUiYieldReason, UI_YIELD_QUIET_MS } from "../utils/ui-yield";

function makeItem(overrides: Partial<MarketNewsItem> & { url: string }): MarketNewsItem {
  return {
    ...overrides,
    id: overrides.id ?? overrides.url,
    title: "Test headline",
    url: overrides.url,
    source: "Test",
    publishedAt: overrides.publishedAt ?? new Date(),
    topic: overrides.topic ?? "general",
    topics: overrides.topics ?? [overrides.topic ?? "general"],
    sectors: overrides.sectors ?? [],
    categories: overrides.categories ?? [],
    tickers: [],
    scores: overrides.scores ?? {
      importance: overrides.importance ?? 50,
      urgency: overrides.isBreaking ? 80 : 0,
      marketImpact: overrides.importance ?? 50,
      novelty: 0,
      confidence: 0,
    },
    importance: overrides.importance ?? 50,
    isBreaking: overrides.isBreaking ?? false,
    isDeveloping: overrides.isDeveloping ?? false,
    summary: undefined,
  };
}

function makeSource(id: string, items: MarketNewsItem[]): NewsCapability {
  return newsProvider({
    id,
    name: id,
    provider: {
      fetchNews: mock(async () => items),
    },
  });
}

function makeCachedSource(id: string, cachedItems: MarketNewsItem[], fetchItems: MarketNewsItem[] = []): NewsCapability {
  return newsProvider({
    id,
    name: id,
    provider: {
      getCachedNews: () => cachedItems,
      fetchNews: mock(async () => fetchItems),
    },
  });
}

function makeStorySource(id: string, items: MarketNewsItem[], story: MarketNewsItem): NewsCapability {
  return newsProvider({
    id,
    name: id,
    provider: {
      fetchNews: mock(async () => items),
      fetchNewsStory: mock(async (storyId: string) => storyId === story.id ? story : null),
    },
  });
}

describe("NewsService", () => {
  let agg: NewsService;

  beforeEach(() => {
    agg = new NewsService();
  });

  afterEach(() => {
    agg.stop();
  });

  it("deduplicates by URL, keeping higher importance", async () => {
    const low = makeItem({ url: "https://example.com/1", importance: 40 });
    const high = makeItem({ url: "https://example.com/1", importance: 80 });

    agg.register(makeSource("a", [low]));
    agg.register(makeSource("b", [high]));
    await agg.poll();

    const stories = agg.getTopStories(10);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.importance).toBe(80);
  });

  it("stamps each article with the capability that produced it", async () => {
    agg.register(makeSource("rss", [makeItem({ url: "https://rss.example/1" })]));
    agg.register(makeSource("substack-news", [makeItem({ url: "https://sub.example/1" })]));
    await agg.poll();

    const byUrl = new Map(agg.getFirehose(undefined, 10).map((item) => [item.url, item.origin]));
    expect(byUrl.get("https://rss.example/1")).toBe("rss");
    expect(byUrl.get("https://sub.example/1")).toBe("substack-news");
  });

  it("re-runs watched queries when a source asks for a refresh", async () => {
    let items: MarketNewsItem[] = [];
    const source = newsProvider({
      id: "substack-news",
      name: "substack-news",
      provider: { fetchNews: mock(async () => items) },
    });
    agg.register(source);
    const query = { feed: "latest" as const, limit: 50 };
    const unwatch = agg.watchQuery(query, () => {});
    await agg.poll(query);
    expect(agg.getQueryState(query).articles).toHaveLength(0);

    // Signing in makes the source non-empty; a refresh must surface it.
    items = [makeItem({ url: "https://sub.example/late" })];
    await agg.refreshWatchedQueries();
    expect(agg.getQueryState(query).articles).toHaveLength(1);
    unwatch();
  });

  it("getTopStories returns items sorted by importance descending", async () => {
    const items = [
      makeItem({ url: "https://a.com/1", importance: 30 }),
      makeItem({ url: "https://a.com/2", importance: 90 }),
      makeItem({ url: "https://a.com/3", importance: 60 }),
    ];
    agg.register(makeSource("a", items));
    await agg.poll();

    const stories = agg.getTopStories(10);
    expect(stories[0]!.importance).toBe(90);
    expect(stories[1]!.importance).toBe(60);
    expect(stories[2]!.importance).toBe(30);
  });

  it("getFirehose returns items sorted by publishedAt descending", async () => {
    const now = Date.now();
    const items = [
      makeItem({ url: "https://b.com/1", publishedAt: new Date(now - 3000) }),
      makeItem({ url: "https://b.com/2", publishedAt: new Date(now - 1000) }),
      makeItem({ url: "https://b.com/3", publishedAt: new Date(now - 2000) }),
    ];
    agg.register(makeSource("b", items));
    await agg.poll();

    const firehose = agg.getFirehose(undefined, 10);
    expect(firehose[0]!.url).toBe("https://b.com/2");
    expect(firehose[1]!.url).toBe("https://b.com/3");
    expect(firehose[2]!.url).toBe("https://b.com/1");
  });

  it("getFirehose filters to items after `since`", async () => {
    const now = Date.now();
    const cutoff = new Date(now - 2000);
    const items = [
      makeItem({ url: "https://c.com/old", publishedAt: new Date(now - 5000) }),
      makeItem({ url: "https://c.com/new", publishedAt: new Date(now - 1000) }),
    ];
    agg.register(makeSource("c", items));
    await agg.poll();

    const firehose = agg.getFirehose(cutoff, 10);
    expect(firehose).toHaveLength(1);
    expect(firehose[0]!.url).toBe("https://c.com/new");
  });

  it("getBySector filters to items containing the sector in categories", async () => {
    const items = [
      makeItem({ url: "https://d.com/1", categories: ["tech", "earnings"] }),
      makeItem({ url: "https://d.com/2", categories: ["energy"] }),
      makeItem({ url: "https://d.com/3", categories: ["tech"] }),
    ];
    agg.register(makeSource("d", items));
    await agg.poll();

    const tech = agg.getBySector("tech", 10);
    expect(tech).toHaveLength(2);
    expect(tech.every((i) => i.categories.includes("tech"))).toBe(true);
  });

  it("getBreaking returns items that are isBreaking=true", async () => {
    const items = [
      makeItem({ url: "https://e.com/1", isBreaking: true }),
      makeItem({ url: "https://e.com/2", isBreaking: false }),
    ];
    agg.register(makeSource("e", items));
    await agg.poll();

    const breaking = agg.getBreaking(10);
    expect(breaking.some((i) => i.url === "https://e.com/1")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://e.com/2")).toBe(true);
  });

  it("getBreaking returns recent items with importance >= 70", async () => {
    const now = Date.now();
    const items = [
      makeItem({ url: "https://f.com/recent-high", publishedAt: new Date(now - 30 * 60 * 1000), importance: 75, isBreaking: false }),
      makeItem({ url: "https://f.com/recent-low", publishedAt: new Date(now - 30 * 60 * 1000), importance: 50, isBreaking: false }),
      makeItem({ url: "https://f.com/old-high", publishedAt: new Date(now - 2 * 60 * 60 * 1000), importance: 90, isBreaking: false }),
    ];
    agg.register(makeSource("f", items));
    await agg.poll();

    const breaking = agg.getBreaking(10);
    expect(breaking.some((i) => i.url === "https://f.com/recent-high")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://f.com/recent-low")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://f.com/old-high")).toBe(true);
  });

  it("retains at most 10000 articles", async () => {
    const items = Array.from({ length: 10_100 }, (_, i) =>
      makeItem({
        url: `https://g.com/${i}`,
        publishedAt: new Date(Date.now() - i * 1000),
      }),
    );
    agg.register(makeSource("g", items));
    await agg.poll();

    expect(agg.getFirehose(undefined, 20_000)).toHaveLength(10_000);
  });

  it("subscribe callback fires on poll and getVersion increments", async () => {
    let callCount = 0;
    const unsub = agg.subscribe(() => { callCount++; });

    const initialVersion = agg.getVersion();
    agg.register(makeSource("h", []));
    await agg.poll();

    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(agg.getVersion()).toBeGreaterThan(initialVersion);

    const afterFirst = callCount;
    const afterFirstVersion = agg.getVersion();
    await agg.poll();
    expect(callCount).toBeGreaterThan(afterFirst);
    expect(agg.getVersion()).toBeGreaterThan(afterFirstVersion);

    unsub();
    const afterUnsub = callCount;
    await agg.poll();
    expect(callCount).toBe(afterUnsub); // unsubscribed, no more calls
  });

  it("watchQuery refreshes a query without a mounted pane", async () => {
    const item = makeItem({ url: "https://watch.example.com/1", isBreaking: true });
    const states: string[][] = [];

    agg.register(makeSource("watch", [item]));
    const dispose = agg.watchQuery(
      { feed: "breaking", breaking: true, limit: 20 },
      (state) => states.push(state.articles.map((article) => article.url)),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(states).toContainEqual([item.url]);

    const callCount = states.length;
    dispose();
    await agg.poll({ feed: "breaking", breaking: true, limit: 20 });
    expect(states).toHaveLength(callCount);
  });

  it("polls referenced queries only and stops after the last watcher leaves", async () => {
    const query = { feed: "latest" as const, limit: 20 };
    let fetchCount = 0;
    const source = newsProvider({
      id: "poll-lifecycle",
      name: "poll-lifecycle",
      provider: {
        fetchNews: async () => {
          fetchCount++;
          return [];
        },
      },
    });
    agg.register(source);
    await agg.load(query);
    expect(fetchCount).toBe(1);

    agg.start();
    agg.register(makeSource("inactive-trigger", []));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(1);

    const dispose = agg.watchQuery(query, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(2);

    const disposeSecond = agg.watchQuery(query, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(3);

    agg.register(makeSource("active-trigger", []));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(4);

    dispose();
    agg.register(makeSource("single-watcher-trigger", []));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(5);

    disposeSecond();
    agg.register(makeSource("disposed-trigger", []));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCount).toBe(5);
  });

  it("retains inactive query state for remounts", async () => {
    const item = makeItem({ url: "https://remount.example.com/1" });
    const query = { feed: "latest" as const, limit: 20 };
    agg.register(makeSource("remount", [item]));
    await agg.load(query);

    const firstStates: string[][] = [];
    const dispose = agg.watchQuery(query, (state) => {
      firstStates.push(state.articles.map((article) => article.url));
    });
    dispose();

    const remountedStates: string[][] = [];
    const disposeRemount = agg.watchQuery(query, (state) => {
      remountedStates.push(state.articles.map((article) => article.url));
    });

    expect(firstStates[0]).toEqual([item.url]);
    expect(remountedStates[0]).toEqual([item.url]);
    disposeRemount();
  });

  it("reads a live pollIntervalMs getter on each scheduled cycle", async () => {
    const scheduled: number[] = [];
    let current = 20_000;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const pending = new Map<number, () => void>();
    let nextId = 1;
    globalThis.setTimeout = ((handler: TimerHandler, ms?: number) => {
      const id = nextId++;
      scheduled.push(ms ?? 0);
      pending.set(id, () => {
        pending.delete(id);
        if (typeof handler === "function") handler();
      });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      pending.delete(id as unknown as number);
    }) as typeof clearTimeout;

    try {
      agg.stop();
      agg = new NewsService({ pollIntervalMs: () => current });
      agg.start();
      expect(scheduled[0]).toBe(20_000);
      current = 45_000;
      pending.get(1)?.();
      await new Promise((resolve) => originalSetTimeout(resolve, 0));
      expect(scheduled[1]).toBe(45_000);
      agg.stop();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("bounds inactive query state by LRU and TTL", async () => {
    let now = 0;
    agg = new NewsService({
      inactiveQueryTtlMs: 10,
      maxInactiveQueries: 2,
      now: () => now,
    });
    agg.register(makeSource("bounded", [makeItem({ url: "https://bounded.example.com/1" })]));
    const first = { feed: "latest" as const, topics: ["first"], limit: 20 };
    const second = { feed: "latest" as const, topics: ["second"], limit: 20 };
    const third = { feed: "latest" as const, topics: ["third"], limit: 20 };

    await agg.load(first);
    now = 1;
    await agg.load(second);
    now = 2;
    await agg.load(third);

    expect(agg.getQueryState(first).phase).toBe("idle");
    expect(agg.getQueryState(third).phase).toBe("ready");

    now = 20;
    expect(agg.getQueryState(third).phase).toBe("idle");
  });

  it("seeds cached source items immediately on register", () => {
    const cached = makeItem({ url: "https://cached.example.com/1", importance: 70 });
    let callCount = 0;
    agg.subscribe(() => { callCount++; });

    const dispose = agg.register(makeCachedSource("cached", [cached]));

    expect(agg.getFirehose(undefined, 10)).toHaveLength(1);
    expect(agg.getFirehose(undefined, 10)[0]!.url).toBe(cached.url);
    expect(callCount).toBe(1);

    dispose();
  });

  it("register disposer removes the source", async () => {
    const item = makeItem({ url: "https://dispose.example.com/1" });
    const dispose = agg.register(makeSource("disposable", [item]));
    dispose();

    await agg.poll();

    expect(agg.getFirehose(undefined, 10)).toHaveLength(0);
  });

  it("ticker queries continue past empty high-priority sources", async () => {
    const empty = makeSource("empty", []);
    const fallbackItem = makeItem({ url: "https://fallback.example.com/1", tickers: ["AAPL"] });
    const fallback = makeSource("fallback", [fallbackItem]);
    agg.register({
      ...empty,
      priority: 10,
      provider: {
        ...empty.provider,
        supports: (query) => query.feed === "ticker" || query.scope === "ticker",
      },
    });
    agg.register({
      ...fallback,
      priority: 100,
      provider: {
        ...fallback.provider,
        supports: (query) => query.feed === "ticker" || query.scope === "ticker",
      },
    });

    const state = await agg.load({ feed: "ticker", ticker: "AAPL", limit: 10 });

    expect(state.articles).toHaveLength(1);
    expect(state.articles[0]!.url).toBe(fallbackItem.url);
    expect(state.sourceIds).toEqual(["fallback"]);
  });

  it("loads story detail and merges source items into existing query state", async () => {
    const listArticle = makeItem({
      id: "story-1",
      url: "https://detail.example.com/story",
      items: [],
    });
    const detailArticle = makeItem({
      ...listArticle,
      items: [{
        id: "item-2",
        sourceKey: "wire-b",
        sourceName: "Wire B",
        title: "Follow-up",
        url: "https://detail.example.com/follow-up",
        publishedAt: new Date("2026-04-01T10:05:00.000Z"),
      }, {
        id: "item-1",
        sourceKey: "wire-a",
        sourceName: "Wire A",
        title: "Original",
        url: "https://detail.example.com/original",
        publishedAt: new Date("2026-04-01T10:00:00.000Z"),
      }],
    });

    agg.register(makeStorySource("cloud", [listArticle], detailArticle));

    const initial = await agg.load({ feed: "top", limit: 10 });
    expect(initial.articles[0]?.items).toEqual([]);

    const detail = await agg.loadStory("story-1");
    const state = agg.getQueryState({ feed: "top", limit: 10 });

    expect(detail?.items?.map((item) => item.id)).toEqual(["item-2", "item-1"]);
    expect(state.articles[0]?.items?.map((item) => item.id)).toEqual(["item-2", "item-1"]);
  });

  it("keeps story detail identity when a duplicate feed item wins ranking", async () => {
    const url = "https://detail.example.com/duplicate-story";
    const cloudArticle = makeItem({
      id: "story-1",
      url,
      importance: 60,
      publishedAt: new Date("2026-04-01T10:00:00.000Z"),
      items: [],
    });
    const feedDuplicate = makeItem({
      id: "rss-1",
      url,
      importance: 95,
      publishedAt: new Date("2026-04-01T10:05:00.000Z"),
    });
    const detailArticle = makeItem({
      ...cloudArticle,
      items: [{
        id: "item-1",
        sourceKey: "wire-a",
        sourceName: "Wire A",
        title: "Original",
        url: "https://detail.example.com/original",
        publishedAt: new Date("2026-04-01T10:00:00.000Z"),
      }],
    });

    agg.register({ ...makeStorySource("cloud", [cloudArticle], detailArticle), priority: 10 });
    agg.register({ ...makeSource("rss", [feedDuplicate]), priority: 2000 });

    const initial = await agg.load({ feed: "top", limit: 10 });

    expect(initial.articles[0]?.id).toBe("story-1");
    expect(initial.articles[0]?.importance).toBe(95);

    await agg.loadStory(initial.articles[0]!.id);
    const state = agg.getQueryState({ feed: "top", limit: 10 });

    expect(state.articles[0]?.items?.map((item) => item.id)).toEqual(["item-1"]);
  });

  it("publishes fast sources before a slower source finishes", async () => {
    let releaseSlow: ((items: MarketNewsItem[]) => void) | undefined;
    const slow = newsProvider({
      id: "rss",
      name: "rss",
      provider: {
        fetchNews: () => new Promise<MarketNewsItem[]>((resolve) => {
          releaseSlow = resolve;
        }),
      },
    });
    const fastItem = makeItem({ url: "https://fast.example/1" });
    agg.register(makeSource("substack-news", [fastItem]));
    agg.register(slow);

    const seen: string[][] = [];
    const dispose = agg.watchQuery({ feed: "latest", limit: 20 }, (state) => {
      seen.push(state.articles.map((article) => article.url));
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.some((urls) => urls.includes(fastItem.url))).toBe(true);
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url)).toEqual([fastItem.url]);

    const slowItem = makeItem({ url: "https://slow.example/1" });
    releaseSlow?.([slowItem]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url).sort()).toEqual(
      [fastItem.url, slowItem.url].sort(),
    );
    dispose();
  });

  it("applies partial articles from one source before that source finishes", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const early = makeItem({ url: "https://rss.example/early" });
    const late = makeItem({ url: "https://rss.example/late" });
    agg.register(newsProvider({
      id: "rss",
      name: "rss",
      provider: {
        async fetchNews(_query, options) {
          options?.onPartial?.([early]);
          await slowGate;
          return [early, late];
        },
      },
    }));

    const dispose = agg.watchQuery({ feed: "latest", limit: 20 }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url)).toEqual([early.url]);

    releaseSlow?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url).sort()).toEqual(
      [early.url, late.url].sort(),
    );
    dispose();
  });

  it("ingests a source that registers while a refresh is in flight, without a pane remount", async () => {
    let releaseRss: ((items: MarketNewsItem[]) => void) | undefined;
    const rss = newsProvider({
      id: "rss",
      name: "rss",
      provider: {
        fetchNews: () => new Promise<MarketNewsItem[]>((resolve) => {
          releaseRss = resolve;
        }),
      },
    });
    agg.register(rss);
    const dispose = agg.watchQuery({ feed: "latest", limit: 20 }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const xItem = makeItem({ url: "https://x.example/1" });
    let xFetches = 0;
    agg.register(newsProvider({
      id: "x-feed",
      name: "X",
      provider: {
        fetchNews: async () => {
          xFetches += 1;
          return [xItem];
        },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(xFetches).toBeGreaterThanOrEqual(1);
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url)).toContain(xItem.url);

    releaseRss?.([makeItem({ url: "https://rss.example/1" })]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const urls = agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url);
    expect(urls).toContain(xItem.url);
    expect(urls).toContain("https://rss.example/1");
    dispose();
  });

  it("poll starts a latest-feed fetch without a mounted pane", async () => {
    let fetches = 0;
    agg.register(newsProvider({
      id: "rss",
      name: "rss",
      provider: {
        fetchNews: async () => {
          fetches += 1;
          return [makeItem({ url: "https://rss.example/warm" })];
        },
      },
    }));
    await agg.poll({ feed: "latest", limit: 200 });
    expect(fetches).toBe(1);
    expect(agg.getQueryState({ feed: "latest", limit: 200 }).articles).toHaveLength(1);
  });

  it("appends paged news instead of replacing the first page", async () => {
    const first = makeItem({ url: "https://example.com/a", title: "First" });
    const second = makeItem({ url: "https://example.com/b", title: "Second" });
    const fetchNewsPage = mock(async (query: { cursor?: string }) => (
      query.cursor === "page-2"
        ? { articles: [second], nextCursor: null }
        : { articles: [first], nextCursor: "page-2" }
    ));
    agg.register(newsProvider({
      id: "cloud",
      name: "cloud",
      provider: {
        fetchNews: async (query) => (await fetchNewsPage(query)).articles,
        fetchNewsPage,
      },
    }));

    const initial = await agg.load({ feed: "latest", limit: 50 });
    expect(initial.articles.map((article) => article.url)).toEqual(["https://example.com/a"]);
    expect(initial.nextCursor).toBe("page-2");

    await agg.loadMore({ feed: "latest", limit: 50 });
    const state = agg.getQueryState({ feed: "latest", limit: 50 });
    expect(state.articles.map((article) => article.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(state.nextCursor).toBeNull();
  });

  it("keeps paged news past the query page size", async () => {
    const first = makeItem({ url: "https://example.com/a", title: "First" });
    const second = makeItem({ url: "https://example.com/b", title: "Second" });
    const fetchNewsPage = mock(async (query: { cursor?: string }) => (
      query.cursor === "page-2"
        ? { articles: [second], nextCursor: "page-3" }
        : { articles: [first], nextCursor: "page-2" }
    ));
    agg.register(newsProvider({
      id: "cloud",
      name: "cloud",
      provider: {
        fetchNews: async (query) => (await fetchNewsPage(query)).articles,
        fetchNewsPage,
      },
    }));

    await agg.load({ feed: "latest", limit: 1 });
    await agg.loadMore({ feed: "latest", limit: 1 });
    const state = agg.getQueryState({ feed: "latest", limit: 1 });
    expect(state.articles.map((article) => article.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(state.nextCursor).toBe("page-3");
  });

  it("refresh keeps already paged news", async () => {
    const first = makeItem({ url: "https://example.com/a", title: "First", publishedAt: new Date("2026-01-02") });
    const second = makeItem({ url: "https://example.com/b", title: "Second", publishedAt: new Date("2026-01-01") });
    const newer = makeItem({ url: "https://example.com/c", title: "Newer", publishedAt: new Date("2026-01-03") });
    let head: "initial" | "refresh" = "initial";
    const fetchNewsPage = mock(async (query: { cursor?: string }) => {
      if (query.cursor === "page-2") return { articles: [second], nextCursor: "page-3" };
      if (head === "refresh") return { articles: [newer, first], nextCursor: "page-2" };
      head = "refresh";
      return { articles: [first], nextCursor: "page-2" };
    });
    agg.register(newsProvider({
      id: "cloud",
      name: "cloud",
      provider: {
        fetchNews: async (query) => (await fetchNewsPage(query)).articles,
        fetchNewsPage,
      },
    }));

    await agg.load({ feed: "latest", limit: 1 });
    await agg.loadMore({ feed: "latest", limit: 1 });
    await agg.poll({ feed: "latest", limit: 1 });
    const state = agg.getQueryState({ feed: "latest", limit: 1 });
    expect(state.articles.map((article) => article.url)).toEqual([
      "https://example.com/c",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(state.nextCursor).toBe("page-3");
  });

  it("defers listener notify while the UI is yielding", async () => {
    const item = makeItem({ url: "https://example.com/yield" });
    agg.register(makeSource("rss", [item]));

    const seen: number[] = [];
    const dispose = agg.subscribe(() => {
      seen.push(agg.getVersion());
    });
    setUiYieldReason("input", true);
    const loading = agg.load({ feed: "latest", limit: 20 });
    await Bun.sleep(20);
    expect(seen).toEqual([]);
    expect(agg.getQueryState({ feed: "latest", limit: 20 }).articles.map((article) => article.url))
      .toEqual([item.url]);

    setUiYieldReason("input", false);
    await loading;
    await Bun.sleep(UI_YIELD_QUIET_MS + 20);
    expect(seen.length).toBeGreaterThan(0);
    dispose();
    resetUiYieldForTests();
  });
});
