import { describe, expect, test } from "bun:test";
import { articleShareNeedsReader, preferredArticleBody } from "./article-view";

describe("preferredArticleBody", () => {
  test("uses the extracted article when it adds text", () => {
    expect(preferredArticleBody("Short summary.", "A much longer extracted article body."))
      .toBe("A much longer extracted article body.");
  });

  test("keeps the payload summary when extraction came back thinner", () => {
    // Regression: a dead link returned a landing page, and the share replaced a
    // full Reuters summary with "This domain is for use in examples".
    const summary = "Betting on the midterms has already hit $133 million, surpassing 2024.";
    expect(preferredArticleBody(summary, "Example Domain. More information...")).toBe(summary);
  });

  test("falls back either way when one side is missing", () => {
    expect(preferredArticleBody("summary", null)).toBe("summary");
    expect(preferredArticleBody("", "extracted")).toBe("extracted");
    expect(preferredArticleBody("", null)).toBe("");
  });

  test("keeps the summary when cleaning left nothing to show", () => {
    expect(preferredArticleBody("The fund declared a $0.055 dividend.", "")).toBe(
      "The fund declared a $0.055 dividend.",
    );
  });
});

describe("articleShareNeedsReader", () => {
  test("loads the full Substack post when the share only stored a teaser", () => {
    expect(articleShareNeedsReader({
      type: "substack",
      id: "1",
      title: "Could Prediction Markets Start Having A Republican Problem",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      previewText: "There's a lot of noise about elections.",
    })).toBe(true);
  });

  test("does not refetch when the share already embedded HTML", () => {
    expect(articleShareNeedsReader({
      type: "substack",
      id: "1",
      title: "t",
      url: "https://eventhorizon.substack.com/p/example",
      source: "The Event Horizon",
      bodyHtml: "<p>full post</p>",
    })).toBe(false);
  });

  test("still loads a bare news article and skips clustered wire stories", () => {
    expect(articleShareNeedsReader({
      type: "news",
      id: "n",
      title: "t",
      url: "https://reuters.com/x",
      source: "Reuters",
      summary: "short",
    })).toBe(true);
    expect(articleShareNeedsReader({
      type: "news",
      id: "n",
      title: "t",
      url: "https://reuters.com/x",
      source: "Reuters",
      items: [{
        id: "i",
        sourceKey: "reuters",
        sourceName: "Reuters",
        title: "related",
        url: "https://reuters.com/y",
        publishedAt: "2026-08-20T00:00:00.000Z",
      }],
    })).toBe(false);
  });
});
