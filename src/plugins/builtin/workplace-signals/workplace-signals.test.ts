import { describe, expect, test } from "bun:test";
import {
  buildSearchUrl,
  buildTrend,
  classifyThemes,
  hnDiscussionUrl,
  parseSignal,
  parseSignalsPayload,
  scoreSentiment,
} from "./client";

describe("classifyThemes", () => {
  test("clusters layoff and comp stories into themes", () => {
    expect(classifyThemes("Company X layoffs: 20% of staff cut", "")).toEqual(["layoffs"]);
    expect(classifyThemes("", "Negotiate your salary before the equity refresh")).toEqual([
      "compensation",
    ]);
    expect(classifyThemes("Return to office policy", "and the new hybrid work rules")).toEqual([
      "remote",
    ]);
  });

  test("falls back to the general culture theme", () => {
    expect(classifyThemes("An essay about semicolons", "")).toEqual(["culture"]);
  });
});

describe("scoreSentiment", () => {
  test("counts positive minus negative keyword hits", () => {
    expect(scoreSentiment("great team", "supportive managers")).toBe(2);
    expect(scoreSentiment("toxic culture", "worst year")).toBe(-2);
    expect(scoreSentiment("", "neutral text")).toBe(0);
  });
});

describe("parseSignal", () => {
  test("maps an Algolia story hit", () => {
    const signal = parseSignal({
      objectID: "41000",
      title: "Big Corp layoffs announced",
      url: "https://example.com/post",
      points: 120,
      num_comments: 88,
      author: "who",
      created_at: "2026-06-02T10:00:00Z",
      story_text: "Fear spreads as the restructuring deepens.",
    });
    expect(signal?.id).toBe("41000");
    expect(signal?.title).toBe("Big Corp layoffs announced");
    expect(signal?.points).toBe(120);
    expect(signal?.commentCount).toBe(88);
    expect(signal?.themes).toEqual(["layoffs"]);
    // "layoff" and "layoffs" both hit as substrings of the title.
    expect(signal?.sentiment).toBe(-3);
    expect(signal?.url).toBe("https://example.com/post");
    expect(signal?.createdAt.toISOString()).toBe("2026-06-02T10:00:00.000Z");
  });

  test("rejects hits without an id or any text", () => {
    expect(parseSignal({})).toBeNull();
    expect(parseSignal({ objectID: "1", title: "", story_text: "" })).toBeNull();
  });
});

describe("parseSignalsPayload", () => {
  test("parses hits and nbHits", () => {
    const page = parseSignalsPayload({
      nbHits: 42,
      hits: [
        { objectID: "1", title: "Hiring freeze at StartupCo" },
        { objectID: "2", title: "" },
        "junk",
      ],
    });
    expect(page.total).toBe(42);
    expect(page.signals).toHaveLength(1);
  });

  test("never throws on junk payloads", () => {
    expect(parseSignalsPayload(null).signals).toEqual([]);
    expect(parseSignalsPayload("nope").total).toBe(0);
  });
});

describe("buildSearchUrl", () => {
  test("searches stories with relevance by default and by date for recent", () => {
    expect(buildSearchUrl("Acme", "top")).toContain("/search?");
    expect(buildSearchUrl("Acme", "top")).toContain("tags=story");
    expect(buildSearchUrl("Acme", "recent")).toContain("/search_by_date?");
    expect(buildSearchUrl("Acme", "top")).toContain("query=Acme");
  });
});

describe("hnDiscussionUrl", () => {
  test("builds the item link", () => {
    expect(hnDiscussionUrl({ id: "41000" })).toBe("https://news.ycombinator.com/item?id=41000");
  });
});

describe("buildTrend", () => {
  test("buckets by month oldest first with averages", () => {
    const trend = buildTrend([
      { createdAt: new Date("2026-05-02"), points: 100, sentiment: 2 } as never,
      { createdAt: new Date("2026-05-20"), points: 50, sentiment: 0 } as never,
      { createdAt: new Date("2026-06-11"), points: 30, sentiment: -1 } as never,
      { createdAt: new Date(0), points: 999, sentiment: 9 } as never,
    ]);
    expect(trend).toEqual([
      { month: "2026-05", count: 2, avgPoints: 75, avgSentiment: 1 },
      { month: "2026-06", count: 1, avgPoints: 30, avgSentiment: -1 },
    ]);
  });
});
