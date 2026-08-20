import { describe, expect, test } from "bun:test";
import { DEFAULT_FEEDS } from "./default-feeds";

// The feed list is hand-maintained and large. A duplicate id silently collapses
// in the feed-config Set (dropping a source), and a non-http(s) url is rejected
// at fetch time, so both failures are invisible without this guard.
describe("default RSS feeds", () => {
  test("every id is unique", () => {
    const ids = DEFAULT_FEEDS.map((feed) => feed.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  test("every url is a unique http(s) endpoint", () => {
    const urls = DEFAULT_FEEDS.map((feed) => feed.url);
    const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
    expect(duplicates).toEqual([]);
    for (const feed of DEFAULT_FEEDS) {
      expect(feed.url, feed.id).toMatch(/^https?:\/\//);
    }
  });

  test("every feed has a name and an authority in 0-100", () => {
    for (const feed of DEFAULT_FEEDS) {
      expect(feed.name.trim().length, feed.id).toBeGreaterThan(0);
      expect(feed.authority, feed.id).toBeGreaterThanOrEqual(0);
      expect(feed.authority, feed.id).toBeLessThanOrEqual(100);
    }
  });

  test("keeps Adjacent Press as a default source", () => {
    const adjacent = DEFAULT_FEEDS.find((feed) => feed.id === "adjacent-press");
    expect(adjacent?.url).toBe("https://adjacent.markets/press/rss");
    expect(adjacent?.enabled).toBe(true);
  });
});
