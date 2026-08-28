import { describe, expect, test } from "bun:test";
import { NEWS_QUERY_PRESETS } from "./query-presets";

describe("NEWS_QUERY_PRESETS", () => {
  test("TOP is the last 24 hours of scored wire stories", () => {
    expect(NEWS_QUERY_PRESETS.top).toEqual({ feed: "top", limit: 10 });
    expect(NEWS_QUERY_PRESETS.feed).toEqual({ feed: "latest", limit: 200 });
  });
});
