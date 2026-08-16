import { describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../../news/types";
import type { SubstackArticleSummary } from "../substack/types";
import {
  buildShareUrl,
  decodeArticleSharePayload,
  encodeNewsArticleForShare,
  encodeSubstackArticleForShare,
  payloadToNewsArticle,
  payloadToSubstackArticle,
  SHARE_HOSTED_ORIGIN,
} from "./article-share";

function makeNewsArticle(overrides: Partial<NewsArticle> & Pick<NewsArticle, "id" | "title">): NewsArticle {
  return {
    url: `https://example.com/${overrides.id}`,
    source: "Reuters",
    publishedAt: new Date("2026-08-16T12:00:00Z"),
    topic: "general",
    topics: ["markets"],
    sectors: ["tech"],
    categories: ["earnings"],
    tickers: ["AAPL", "MSFT"],
    scores: { importance: 80, urgency: 10, marketImpact: 20, novelty: 5, confidence: 90 },
    isBreaking: false,
    isDeveloping: false,
    importance: 80,
    ...overrides,
  };
}

function makeSubstackArticle(overrides: Partial<SubstackArticleSummary> & Pick<SubstackArticleSummary, "id" | "title">): SubstackArticleSummary {
  return {
    publicationId: "pub-1",
    publicationName: "Alpha Research",
    publicationSubdomain: "alpha",
    publicationBaseUrl: "https://alpha.substack.com",
    url: "https://alpha.substack.com/p/test",
    slug: "test",
    publishedAt: "2026-08-15T10:00:00Z",
    subtitle: "A subtitle",
    previewText: "Preview text here",
    bodyHtml: null,
    imageUrls: ["https://img.example.com/1.png"],
    wordCount: 1200,
    readMinutes: 6,
    ...overrides,
  };
}

describe("article-share encode/decode", () => {
  test("news article round-trips through encode → decode → reconstruct", () => {
    const original = makeNewsArticle({
      id: "hormuz",
      title: "Iran Threatens to Close the Strait of Hormuz",
      summary: "Shipping risk rises.",
    });
    const encoded = encodeNewsArticleForShare(original);
    const decoded = decodeArticleSharePayload(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("news");
    expect(decoded!.id).toBe("hormuz");
    expect(decoded!.title).toBe("Iran Threatens to Close the Strait of Hormuz");
    expect(decoded!.summary).toBe("Shipping risk rises.");
    expect(decoded!.tickers).toEqual(["AAPL", "MSFT"]);
    expect(decoded!.publishedAt).toBe("2026-08-16T12:00:00.000Z");

    const reconstructed = payloadToNewsArticle(decoded!);
    expect(reconstructed.id).toBe(original.id);
    expect(reconstructed.title).toBe(original.title);
    expect(reconstructed.url).toBe(original.url);
    expect(reconstructed.source).toBe(original.source);
    expect(reconstructed.tickers).toEqual(original.tickers);
    expect(reconstructed.publishedAt.toISOString()).toBe(original.publishedAt.toISOString());
    expect(reconstructed.importance).toBe(original.importance);
  });

  test("substack article round-trips through encode → decode → reconstruct", () => {
    const original = makeSubstackArticle({
      id: "post-123",
      title: "The Fed Pivot",
    });
    const encoded = encodeSubstackArticleForShare(original);
    const decoded = decodeArticleSharePayload(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("substack");
    expect(decoded!.id).toBe("post-123");
    expect(decoded!.title).toBe("The Fed Pivot");
    expect(decoded!.publicationName).toBe("Alpha Research");
    expect(decoded!.url).toBe("https://alpha.substack.com/p/test");
    expect(decoded!.previewText).toBe("Preview text here");
    expect(decoded!.readMinutes).toBe(6);

    const reconstructed = payloadToSubstackArticle(decoded!);
    expect(reconstructed.id).toBe(original.id);
    expect(reconstructed.title).toBe(original.title);
    expect(reconstructed.url).toBe(original.url);
    expect(reconstructed.publicationName).toBe(original.publicationName);
    expect(reconstructed.previewText).toBe(original.previewText);
  });

  test("buildShareUrl produces a public /article URL with the encoded payload", () => {
    const article = makeNewsArticle({ id: "abc", title: "Test" });
    const encoded = encodeNewsArticleForShare(article);
    const url = buildShareUrl(encoded);
    expect(url).toBe(`${SHARE_HOSTED_ORIGIN}/article?a=${encoded}`);
    expect(url).toContain("terminal.kohor.st/article?a=");
  });

  test("decodeArticleSharePayload returns null for invalid input", () => {
    expect(decodeArticleSharePayload("")).toBeNull();
    expect(decodeArticleSharePayload("!!!not-base64!!!")).toBeNull();
    // Valid base64 but not valid JSON
    const badJson = btoa("not json");
    expect(decodeArticleSharePayload(badJson)).toBeNull();
    // Valid JSON but missing required fields
    const missingFields = btoa(JSON.stringify({ type: "news" }));
    expect(decodeArticleSharePayload(missingFields)).toBeNull();
    // Valid JSON but wrong type
    const wrongType = btoa(JSON.stringify({ type: "blog", id: "x", title: "t", url: "u" }));
    expect(decodeArticleSharePayload(wrongType)).toBeNull();
  });

  test("news article with story items preserves timeline items", () => {
    const original = makeNewsArticle({
      id: "developing",
      title: "Breaking story",
      items: [
        {
          id: "item-1",
          sourceKey: "reuters",
          sourceName: "Reuters",
          title: "First report",
          summary: "Initial summary",
          url: "https://reuters.com/1",
          publishedAt: new Date("2026-08-16T10:00:00Z"),
        },
      ],
    });
    const encoded = encodeNewsArticleForShare(original);
    const decoded = decodeArticleSharePayload(encoded);
    expect(decoded!.items).toHaveLength(1);
    expect(decoded!.items![0]!.title).toBe("First report");

    const reconstructed = payloadToNewsArticle(decoded!);
    expect(reconstructed.items).toHaveLength(1);
    expect(reconstructed.items![0]!.url).toBe("https://reuters.com/1");
  });
});
