import { describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { attachSubstackPersistence, resetSubstackPersistence } from "./api/store";
import { createSubstackNewsCapability, normalizeSubstackArticle } from "./news-capability";
import type { SubstackArticleSummary } from "./types";

function makeSummary(overrides: Partial<SubstackArticleSummary> = {}): SubstackArticleSummary {
  return {
    id: "1",
    title: "Open Thread 447",
    publicationId: null,
    publicationName: "Astral Codex Ten",
    publicationSubdomain: null,
    publicationBaseUrl: "https://www.astralcodexten.com",
    url: "https://www.astralcodexten.com/p/open-thread-447",
    slug: "open-thread-447",
    publishedAt: "2026-08-17T15:52:00.000Z",
    subtitle: null,
    previewText: "Post whatever you want.",
    bodyHtml: null,
    imageUrls: [],
    wordCount: 0,
    readMinutes: 1,
    ...overrides,
  };
}

describe("normalizeSubstackArticle", () => {
  test("carries extracted post text so the firehose reader has a body", () => {
    // Regression: opening a Substack post in the firehose reader showed only the
    // timestamp, category, and URL because the news article carried no body and
    // r.jina.ai cannot see a subscriber-only page.
    const article = normalizeSubstackArticle(makeSummary({
      bodyHtml: "<p>This is the weekly open thread.</p><p>Comment on anything.</p>",
    }));
    expect(article?.body).toContain("This is the weekly open thread.");
    expect(article?.body).toContain("Comment on anything.");
  });

  test("leaves body undefined when the summary has no HTML to extract", () => {
    const article = normalizeSubstackArticle(makeSummary({ bodyHtml: null }));
    expect(article?.body).toBeUndefined();
  });

  test("marks the newsletter category", () => {
    const article = normalizeSubstackArticle(makeSummary());
    expect(article?.categories).toContain("newsletter");
  });

  test("extracts tickers from title and preview with the shared matcher", () => {
    const article = normalizeSubstackArticle(makeSummary({
      title: "Semis and $NVDA",
      previewText: "NASDAQ:MSFT and (AAPL) in the same tape.",
    }));
    expect(article?.tickers).toEqual(["NVDA", "MSFT", "AAPL"]);
  });

  test("caps cached firehose seed to the query limit and reads {items} feed payloads", () => {
    const persistence = new MemoryPluginPersistence();
    attachSubstackPersistence(persistence);
    persistence.seedResource("feed", "subscribed", {
      items: [
        makeSummary({ id: "1", title: "One", url: "https://www.astralcodexten.com/p/one" }),
        makeSummary({ id: "2", title: "Two", url: "https://www.astralcodexten.com/p/two" }),
        makeSummary({ id: "3", title: "Three", url: "https://www.astralcodexten.com/p/three" }),
      ],
    }, { sourceKey: "substack", schemaVersion: 4 });

    try {
      const articles = createSubstackNewsCapability().provider.getCachedNews?.({ feed: "latest", limit: 2 }) ?? [];
      expect(articles.map((article) => article.title)).toEqual(["One", "Two"]);
    } finally {
      resetSubstackPersistence();
    }
  });
});
