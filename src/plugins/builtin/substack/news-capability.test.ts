import { describe, expect, test } from "bun:test";
import { normalizeSubstackArticle } from "./news-capability";
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

  test("extracts tickers from title and body with the shared matcher", () => {
    const article = normalizeSubstackArticle(makeSummary({
      title: "Semis and $NVDA",
      bodyHtml: "<p>NASDAQ:MSFT and (AAPL) in the same tape.</p>",
    }));
    expect(article?.tickers).toEqual(["NVDA", "MSFT", "AAPL"]);
  });
});
