import { describe, expect, test } from "bun:test";
import { preferredArticleBody } from "./article-view";

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
});
