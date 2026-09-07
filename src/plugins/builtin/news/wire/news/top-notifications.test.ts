import { describe, expect, test } from "bun:test";
import type { AppNotificationRequest, GloomPluginContext } from "../../../../../types/plugin";
import type { MarketNewsItem, NewsQueryState } from "../../../../../types/news-source";
import { getStashedNewsArticle } from "./article-stash";
import { setupTopNewsNotifications } from "./top-notifications";

function article(
  id: string,
  title = id,
  overrides: Partial<MarketNewsItem> = {},
): MarketNewsItem {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    source: "Test Wire",
    publishedAt: new Date(),
    topic: "general",
    topics: ["general"],
    sectors: [],
    categories: ["general"],
    tickers: ["SPX"],
    scores: { importance: 80, urgency: 50, marketImpact: 50, novelty: 50, confidence: 80 },
    importance: 80,
    isBreaking: false,
    isDeveloping: false,
    ...overrides,
  };
}

function ready(articles: MarketNewsItem[], updatedAt = Date.now()): NewsQueryState {
  return {
    phase: "ready",
    articles,
    error: null,
    updatedAt,
    sourceIds: ["test"],
    nextCursor: null,
    loadingMore: false,
  };
}

function harness(): {
  ctx: GloomPluginContext;
  notifications: AppNotificationRequest[];
  openedTemplates: Array<{ templateId: string; arg?: string }>;
  emit: (articles: MarketNewsItem[], updatedAt?: number) => void;
  isWatching: () => boolean;
} {
  let listener: ((state: NewsQueryState) => void) | null = null;
  const notifications: AppNotificationRequest[] = [];
  const openedTemplates: Array<{ templateId: string; arg?: string }> = [];

  const ctx = {
    watchNewsQuery: (_query: unknown, next: (state: NewsQueryState) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    notify: (notification: AppNotificationRequest) => void notifications.push(notification),
    createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => {
      openedTemplates.push({ templateId, arg: options?.arg });
    },
    getConfig: () => ({ refreshIntervalMinutes: 15 }),
    log: { warn: () => {} },
  } as unknown as GloomPluginContext;

  return {
    ctx,
    notifications,
    openedTemplates,
    emit: (articles, updatedAt = Date.now()) => listener?.(ready(articles, updatedAt)),
    isWatching: () => listener !== null,
  };
}

describe("top news notifications", () => {
  test("primes on the first ready batch and toasts later unseen headlines", () => {
    const h = harness();
    const dispose = setupTopNewsNotifications(h.ctx);

    const seed = article("seed", "Existing top story");
    const fresh = article("fresh", "New top story", { importance: 95 });
    h.emit([seed]);
    expect(h.notifications).toHaveLength(0);

    h.emit([fresh, seed]);
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toMatchObject({
      title: "Top News",
      body: "New top story",
      desktop: "always",
    });
    expect(h.notifications[0]?.duration).toBeGreaterThan(0);

    h.notifications[0]!.action?.onClick();
    expect(h.openedTemplates).toEqual([{ templateId: "news-article-pane", arg: "fresh" }]);
    expect(getStashedNewsArticle("fresh")?.title).toBe("New top story");

    dispose();
    expect(h.isWatching()).toBe(false);
  });

  test("toasts the highest-importance new story and notes extras", () => {
    const h = harness();
    setupTopNewsNotifications(h.ctx);

    h.emit([article("seed")]);
    h.emit([
      article("low", "Lesser story", { importance: 40 }),
      article("high", "Lead story", { importance: 99 }),
      article("seed"),
    ]);

    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]?.body).toBe("Lead story (+1 more)");
  });

  test("does not replay a headline that was already seen", () => {
    const h = harness();
    setupTopNewsNotifications(h.ctx);

    const story = article("same", "Same story");
    h.emit([story]);
    h.emit([story]);
    expect(h.notifications).toHaveLength(0);
  });

  test("does not toast an old headline that appears for the first time", () => {
    const h = harness();
    setupTopNewsNotifications(h.ctx);

    const pollAt = Date.parse("2026-09-05T12:00:00.000Z");
    const seed = article("seed", "Existing top story", {
      publishedAt: new Date("2026-09-05T11:55:00.000Z"),
    });
    const old = article("old", "Old story", {
      publishedAt: new Date("2026-09-05T11:44:59.999Z"),
    });

    h.emit([seed], pollAt);
    h.emit([old, seed], pollAt);

    expect(h.notifications).toHaveLength(0);
  });

  test("toasts only unseen headlines published within the poll window", () => {
    const h = harness();
    setupTopNewsNotifications(h.ctx);

    const pollAt = Date.parse("2026-09-05T12:00:00.000Z");
    const seed = article("seed", "Existing top story", {
      publishedAt: new Date("2026-09-05T11:55:00.000Z"),
    });
    const old = article("old", "Old story", {
      publishedAt: new Date("2026-09-05T11:44:59.999Z"),
      importance: 100,
    });
    const recent = article("recent", "Recent story", {
      publishedAt: new Date("2026-09-05T11:50:00.000Z"),
      importance: 95,
    });

    h.emit([seed], pollAt);
    h.emit([old, recent, seed], pollAt);

    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]?.body).toBe("Recent story");
  });
});
