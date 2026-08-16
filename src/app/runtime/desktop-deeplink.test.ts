import { describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../news/types";
import { encodeNewsArticleForShare } from "../../plugins/builtin/shared/article-share";
import { resolveDesktopDeepLinkAction } from "./desktop-deeplink";

describe("desktop deeplinks", () => {
  test("routes cloud roundup links to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/roundup?week=2026-07-03")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-roundup", week: "2026-07-03" },
      message: "Opened weekly roundup settings for 2026-07-03.",
    });
  });

  test("routes cloud alert links to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/alerts")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-alerts", week: null },
      message: "Opened portfolio alert settings.",
    });
  });

  test("routes the post-checkout success link to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/success")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-success", week: null },
      message: "Pro is active.",
    });
  });

  test("routes ticker links with arbitrary registered tab ids", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://ticker/NVDA?tab=analyst-research")).toEqual({
      type: "open-ticker",
      symbol: "NVDA",
      tabId: "analyst-research",
      message: "Opened NVDA analyst-research tab.",
    });
  });

  test("routes portfolio and watchlist links", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://portfolio/main")).toEqual({
      type: "open-collection",
      kind: "portfolio",
      collectionId: "main",
      message: "Opened portfolio main.",
    });
    expect(resolveDesktopDeepLinkAction("gloomberb://watchlist/favorites")).toEqual({
      type: "open-collection",
      kind: "watchlist",
      collectionId: "favorites",
      message: "Opened watchlist favorites.",
    });
  });

  test("routes alert links with structured values", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://alert/new?symbol=nvda&side=above&price=$200")).toEqual({
      type: "create-alert",
      values: { symbol: "NVDA", condition: "above", price: "200" },
      message: "Created NVDA above 200 alert.",
    });
  });

  test("routes chat links", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://chat/channel/everyone")).toEqual({
      type: "open-chat-channel",
      channelId: "everyone",
      messageId: null,
      message: "Opened chat everyone.",
    });
    expect(resolveDesktopDeepLinkAction("gloomberb://chat/channel/dm%3Aabc?message=m%3A2")).toEqual({
      type: "open-chat-channel",
      channelId: "dm:abc",
      messageId: "m:2",
      message: "Opened chat dm:abc.",
    });
    expect(resolveDesktopDeepLinkAction("gloomberb://chat/dm?users=@vince,@alex")).toEqual({
      type: "open-chat-dm",
      participants: "@vince,@alex",
      message: "Opened DM.",
    });
  });

  test("routes email preference links to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/emails")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-emails", week: null },
      message: "Opened email settings.",
    });
  });

  test("routes news links", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://news?ticker=7203.T")).toEqual({
      type: "open-news",
      kind: "ticker",
      symbol: "7203.T",
      message: "Opened 7203.T news.",
    });
    expect(resolveDesktopDeepLinkAction("gloomberb://news/breaking")).toEqual({
      type: "open-news",
      kind: "breaking",
      symbol: null,
      message: "Opened breaking news.",
    });
  });

  test("rejects command-bar, non-gloomberb, and malformed links", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://command?query=profile").type).toBe("unsupported");
    expect(resolveDesktopDeepLinkAction("gloomberb://search/NVDA").type).toBe("unsupported");
    expect(resolveDesktopDeepLinkAction("https://gloom.sh/cloud").type).toBe("unsupported");
    expect(resolveDesktopDeepLinkAction("not a url").type).toBe("unsupported");
  });

  test("routes article share links to the article reader", () => {
    const article: NewsArticle = {
      id: "test-article",
      title: "Test Article",
      url: "https://example.com/test",
      source: "Reuters",
      publishedAt: new Date("2026-08-16T12:00:00Z"),
      topic: "general",
      topics: [],
      sectors: [],
      categories: [],
      tickers: [],
      scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
      isBreaking: false,
      isDeveloping: false,
      importance: 0,
    };
    const payload = encodeNewsArticleForShare(article);
    const action = resolveDesktopDeepLinkAction(`gloomberb://article?a=${payload}`);
    expect(action.type).toBe("open-article-reader");
    if (action.type !== "open-article-reader") return;
    expect(action.articleType).toBe("news");
    expect(action.encodedPayload).toBe(payload);
    expect(action.message).toContain("Test Article");
  });

  test("rejects article links without a payload", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://article").type).toBe("unsupported");
  });

  test("routes short-ID share links to the share resolver", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://share?s=abc123")).toEqual({
      type: "open-share",
      shortId: "abc123",
      message: "Opening shared view...",
    });
  });

  test("rejects share links without a short ID", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://share").type).toBe("unsupported");
  });
});
