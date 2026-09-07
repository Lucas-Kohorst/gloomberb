import { describe, expect, test } from "bun:test";
import { truncatePredictionText } from "./shared";

describe("prediction detail shared helpers", () => {
  test("renders missing summary URLs as empty text instead of throwing", () => {
    expect(truncatePredictionText(undefined, 20)).toBe("");
    expect(truncatePredictionText(null, 20)).toBe("");
  });

  test("preserves truncation semantics for valid URLs", () => {
    expect(truncatePredictionText("https://example.com", 40)).toBe("https://example.com");
    expect(truncatePredictionText("https://example.com", 12)).toBe("https://e...");
    expect(truncatePredictionText("https://example.com", 3)).toBe("htt");
  });
});
