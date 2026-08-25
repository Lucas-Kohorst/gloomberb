import { describe, expect, mock, test } from "bun:test";
import { MemoryPluginPersistence as MemoryPersistence } from "../../../../../test-support/plugin-persistence";
import { createRssNewsCapability, RSS_FEED_CACHE_POLICY, RSS_FETCH_CONCURRENCY } from "./source";
import type { RssFeedConfig } from "./parser";
import { buildArticleTickerUniverse } from "../../../../../news/article-tickers";

const FEED: RssFeedConfig = {
  id: "example-feed",
  url: "https://example.com/rss.xml",
  name: "Example",
  category: "general",
  authority: 80,
  enabled: true,
};

const RSS_FIXTURE = `<rss version="2.0"><channel><item>
  <title>Breaking: NVIDIA rallies on AI demand</title>
  <link>https://example.com/nvda</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <description>NVIDIA shares moved higher.</description>
</item></channel></rss>`;

describe("createRssNewsCapability", () => {
  test("caches fetched feed items with feed authority scoring", async () => {
    const persistence = new MemoryPersistence();
    const fetchText = mock(async () => ({
      ok: true,
      text: async () => RSS_FIXTURE,
    }));
    const source = createRssNewsCapability([FEED], { persistence, fetchText });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.importance).toBeGreaterThanOrEqual(FEED.authority);
    expect(items[0]!.isBreaking).toBe(true);
    expect(items[0]!.tickers).toContain("NVDA");
    expect(source.provider.getCachedNews?.({ scope: "global" })).toHaveLength(1);
  });

  test("uses fresh plugin cache without refetching", async () => {
    const persistence = new MemoryPersistence();
    const source = createRssNewsCapability([FEED], {
      persistence,
      fetchText: async () => {
        throw new Error("should not fetch");
      },
    });

    persistence.setResource("rss-feed", FEED.id, {
      items: [{
        id: "cached",
        title: "Cached headline",
        url: "https://example.com/cached",
        source: FEED.name,
        publishedAt: new Date().toISOString(),
        categories: ["general"],
        tickers: [],
        importance: 60,
        isBreaking: false,
      }],
    }, {
      sourceKey: FEED.url,
      cachePolicy: RSS_FEED_CACHE_POLICY,
    });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Cached headline");
  });

  test("falls back to stale plugin cache when refresh fails", async () => {
    const persistence = new MemoryPersistence();
    const stalePolicy = { staleMs: -1, expireMs: 60_000 };
    persistence.setResource("rss-feed", FEED.id, {
      items: [{
        id: "stale",
        title: "Stale headline",
        url: "https://example.com/stale",
        source: FEED.name,
        publishedAt: new Date().toISOString(),
        categories: ["general"],
        tickers: [],
        importance: 50,
        isBreaking: false,
      }],
    }, {
      sourceKey: FEED.url,
      cachePolicy: stalePolicy,
    });

    const source = createRssNewsCapability([FEED], {
      persistence,
      fetchText: async () => {
        throw new Error("network down");
      },
    });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Stale headline");
  });

  test("builds the ticker universe once per fetch across feeds", async () => {
    const other: RssFeedConfig = { ...FEED, id: "other-feed", url: "https://example.com/other.xml" };
    let universeCalls = 0;
    const tickerUniverse = async () => {
      universeCalls += 1;
      await Bun.sleep(5);
      return buildArticleTickerUniverse({ book: ["NVDA"] });
    };
    const source = createRssNewsCapability([FEED, other], {
      tickerUniverse,
      fetchText: async () => ({
        ok: true,
        text: async () => RSS_FIXTURE,
      }),
    });

    await source.provider.fetchNews({ scope: "global" });
    expect(universeCalls).toBe(1);

    await source.provider.fetchNews({ scope: "global" });
    expect(universeCalls).toBe(2);
  });

  test("emits partial articles before every feed has finished", async () => {
    const slow: RssFeedConfig = { ...FEED, id: "slow-feed", url: "https://example.com/slow.xml", authority: 50 };
    const fast: RssFeedConfig = { ...FEED, id: "fast-feed", url: "https://example.com/fast.xml", authority: 90 };
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const partials: number[] = [];
    const source = createRssNewsCapability([slow, fast], {
      fetchText: async (url) => {
        if (url.includes("slow")) await slowGate;
        const headline = url.includes("slow") ? "Slow feed NVIDIA rallies" : "Fast feed NVIDIA rallies";
        const link = url.includes("slow") ? "https://example.com/nvda-slow" : "https://example.com/nvda-fast";
        return {
          ok: true,
          text: async () => `<rss version="2.0"><channel><item>
  <title>${headline}</title>
  <link>${link}</link>
  <guid isPermaLink="true">${link}</guid>
  <pubDate>${new Date().toUTCString()}</pubDate>
</item></channel></rss>`,
        };
      },
    });

    const done = source.provider.fetchNews({ scope: "global" }, {
      onPartial: (articles) => {
        partials.push(articles.length);
      },
    });
    await Bun.sleep(20);
    expect(partials.some((count) => count > 0)).toBe(true);
    releaseSlow?.();
    const items = await done;
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test("does not start every feed at once", async () => {
    const feeds: RssFeedConfig[] = Array.from({ length: RSS_FETCH_CONCURRENCY + 4 }, (_, index) => ({
      ...FEED,
      id: `feed-${index}`,
      url: `https://example.com/${index}.xml`,
      authority: 50 - index,
    }));
    let inflight = 0;
    let peak = 0;
    const source = createRssNewsCapability(feeds, {
      fetchText: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await Bun.sleep(25);
        inflight -= 1;
        return { ok: true, text: async () => RSS_FIXTURE };
      },
    });

    await source.provider.fetchNews({ scope: "global" });
    expect(peak).toBeLessThanOrEqual(RSS_FETCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(feeds.length);
  });

  test("treats RSS as fresh for 15 minutes so default wires are not refetched constantly", () => {
    expect(RSS_FEED_CACHE_POLICY.staleMs).toBe(15 * 60 * 1000);
  });

  test("does not ingest the same guid twice in one fetch", async () => {
    const xml = `<rss version="2.0"><channel>
      <item>
        <title>Lego has launched 330 new products</title>
        <link>https://www.fastcompany.com/91595567/lego-has-launched-330-new-products</link>
        <guid isPermaLink="false">https://www.fastcompany.com/91595567/lego</guid>
        <pubDate>2026-08-25T13:04:00</pubDate>
      </item>
      <item>
        <title>Lego has launched 330 new products so far this year</title>
        <link>https://www.fastcompany.com/91595567/lego-has-released-330-new-products</link>
        <guid isPermaLink="false">https://www.fastcompany.com/91595567/lego</guid>
        <pubDate>2026-08-25T16:12:54</pubDate>
      </item>
    </channel></rss>`;
    const source = createRssNewsCapability([FEED], {
      fetchText: async () => ({ ok: true, text: async () => xml }),
    });

    const items = await source.provider.fetchNews({ scope: "global" });
    expect(items).toHaveLength(1);
    expect(items[0]!.guid).toBe("https://www.fastcompany.com/91595567/lego");
    expect(items[0]!.publishedAt.toISOString()).toBe("2026-08-25T13:04:00.000Z");
  });
});
