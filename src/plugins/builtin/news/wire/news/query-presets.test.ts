import { describe, expect, test } from "bun:test";
import { NEWS_QUERY_PRESETS } from "./query-presets";

describe("NEWS_QUERY_PRESETS", () => {
  test("TOP is the first 10 wire stories", () => {
    expect(NEWS_QUERY_PRESETS.top).toEqual({ feed: "latest", limit: 10 });
    expect(NEWS_QUERY_PRESETS.feed).toEqual({ feed: "latest", limit: 200 });
  });
});
