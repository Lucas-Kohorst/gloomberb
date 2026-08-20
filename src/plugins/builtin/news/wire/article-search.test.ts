import { afterEach, describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../../../news/types";
import { setSharedNewsService } from "../../../../news/hooks";
import { normalizeAdjacentNewsArticle, parseAdjacentNewsArticle } from "../../adjacent/normalize";
import {
  ARTICLE_SEARCH_QUERY,
  cancelRssNewsWarm,
  looksLikeArticleQuery,
  scheduleRssNewsWarm,
  searchNewsArticles,
  tokenizeArticleQuery,
} from "./article-search";

function article(overrides: Partial<NewsArticle> & Pick<NewsArticle, "id" | "title" | "source">): NewsArticle {
  return {
    url: `https://example.com/${overrides.id}`,
    publishedAt: new Date("2026-08-14T12:00:00Z"),
    topic: "general",
    topics: [],
    sectors: [],
    categories: [],
    tickers: [],
    scores: { importance: 50, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 50,
    ...overrides,
  };
}

const hormuz = article({
  id: "hormuz",
  title: "Iran Threatens to Close the Strait of Hormuz",
  source: "Adjacent Press",
  summary: "Shipping risk rises as Tehran warns it may shut the strait.",
  publishedAt: new Date("2026-08-14T18:00:00Z"),
});

const other = article({
  id: "fed",
  title: "Fed holds rates as inflation cools",
  source: "CNBC Top News",
  publishedAt: new Date("2026-08-13T12:00:00Z"),
});

describe("looksLikeArticleQuery", () => {
  test("treats article, news, and ART lookups as article searches", () => {
    expect(looksLikeArticleQuery("adjacent article on the strait")).toBe(true);
    expect(looksLikeArticleQuery("ART hormuz")).toBe(true);
    expect(looksLikeArticleQuery("open adjacent press story")).toBe(true);
    expect(looksLikeArticleQuery("ADI")).toBe(false);
    expect(looksLikeArticleQuery("nvda")).toBe(false);
  });
});

describe("searchNewsArticles", () => {
  test("matches Adjacent Press headlines after dropping filler words", () => {
    expect(tokenizeArticleQuery("adjacent article on the strait")).toEqual(["adjacent", "strait"]);
    const matches = searchNewsArticles([hormuz, other], "adjacent article on the strait");
    expect(matches.map((item) => item.id)).toEqual(["hormuz"]);
  });

  test("returns recent articles when the query is only an intent word", () => {
    const matches = searchNewsArticles([other, hormuz], "article");
    expect(matches.map((item) => item.id)).toEqual(["hormuz", "fed"]);
  });

  test("matches Adjacent related-news articles tagged from the public wire", () => {
    const parsed = parseAdjacentNewsArticle({
      article_id: "ap-hormuz",
      title: "Iran won’t reopen Strait of Hormuz without US concessions",
      url: "https://apnews.com/hormuz",
      source: "Associated Press",
      published_date: "2026-08-10T10:58:24Z",
    });
    expect(parsed).not.toBeNull();
    const matches = searchNewsArticles(
      [normalizeAdjacentNewsArticle(parsed!), other],
      "adjacent article on the strait",
    );
    expect(matches.map((item) => item.id)).toEqual(["adjacent:ap-hormuz"]);
  });
});

describe("scheduleRssNewsWarm", () => {
  afterEach(() => {
    cancelRssNewsWarm();
    setSharedNewsService(null);
  });

  test("polls ARTICLE_SEARCH_QUERY and cancel stops a pending timer", async () => {
    const polls: unknown[] = [];
    setSharedNewsService({
      poll: async (query: unknown) => {
        polls.push(query);
      },
    } as never);

    scheduleRssNewsWarm();
    cancelRssNewsWarm();
    await Bun.sleep(20);
    expect(polls).toEqual([]);

    scheduleRssNewsWarm();
    await Bun.sleep(20);
    expect(polls).toEqual([ARTICLE_SEARCH_QUERY]);
  });
});
