import { describe, expect, test } from "bun:test";
import { relatedNewsSearchText } from "./article-search";

describe("relatedNewsSearchText", () => {
  test("drops index tickers and generic words so ART can match a topic", () => {
    expect(relatedNewsSearchText("HOUNTI NFL Team Index: Houston")).toBe("nfl houston");
    expect(relatedNewsSearchText("RED Battleground House Index")).toBe("battleground house");
    expect(relatedNewsSearchText("Will Republican win the House race for PA-7?")).toBe(
      "republican house race pa",
    );
  });
});
