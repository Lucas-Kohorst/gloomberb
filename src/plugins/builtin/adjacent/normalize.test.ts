import { describe, expect, test } from "bun:test";
import {
  compareAdjacentIndexRows,
  normalizeAdjacentIndex,
  normalizeAdjacentIndexPrices,
  normalizeAdjacentNewsArticle,
  normalizeAdjacentRate,
  unwrapAdjacentMarketIds,
  unwrapAdjacentNewsArticles,
  unwrapAdjacentSimilarMarkets,
  formatYesOddsPercent,
} from "./normalize";
import { createIndexColumns } from "./indices";
import { createRateColumns } from "./rates";
import { getTableWidth } from "../../../components/ui/table-layout";

describe("adjacent normalize", () => {
  test("budgets table gutters and padding before assigning the flexible column", () => {
    expect(getTableWidth(createIndexColumns(80))).toBe(80);
    expect(getTableWidth(createRateColumns(80))).toBe(80);
    expect(getTableWidth(createIndexColumns(40))).toBe(40);
    expect(getTableWidth(createRateColumns(24))).toBe(24);
  });

  test("maps index wire shape to rows", () => {
    const row = normalizeAdjacentIndex({
      index_id: "red",
      name: "Republican Political Future Index",
      latest_price: 98.5612,
      change_1d: 0.129,
      change_7d: 2.565,
      office_category: null,
    });
    expect(row.id).toBe("red");
    expect(row.ticker).toBe("RED");
    expect(row.name).toBe("Republican Political Future Index");
    expect(row.value).toBeCloseTo(98.5612);
    expect(row.probabilityPct).toBeCloseTo(48.5612);
    expect(row.change1d).toBe(0.129);
    expect(row.change7d).toBe(2.565);
  });

  test("maps rate wire shape to rows", () => {
    const row = normalizeAdjacentRate({
      rate_id: "adj_bluh",
      name: "Democrat House",
      latest_price: 85.5,
      spread: 0,
    });
    expect(row.id).toBe("adj_bluh");
    expect(row.value).toBe(85.5);
    expect(row.spread).toBe(0);
  });

  test("maps index price samples to price points, dropping invalid/null entries", () => {
    const points = normalizeAdjacentIndexPrices([
      { timestamp: "2026-08-15T20:21:00Z", price: 98.5611 },
      { timestamp: "bad", price: 5 },
      { timestamp: "2026-08-15T19:00:00Z", price: null },
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBeCloseTo(98.5611);
  });

  test("sorts indices by ticker, probability, and 1d change fields", () => {
    const red = normalizeAdjacentIndex({
      index_id: "red",
      name: "Republican",
      ticker: "RED",
      latest_price: 98,
      change_1d: 0.2,
    });
    const blue = normalizeAdjacentIndex({
      index_id: "blue",
      name: "Democrat",
      ticker: "BLUE",
      latest_price: 52,
      change_1d: -1.4,
    });
    expect(compareAdjacentIndexRows(red, blue, "ticker")).toBeGreaterThan(0);
    expect(compareAdjacentIndexRows(red, blue, "prob")).toBeGreaterThan(0);
    expect(compareAdjacentIndexRows(red, blue, "chg1d")).toBeGreaterThan(0);
    expect(compareAdjacentIndexRows(red, blue, "value")).toBeGreaterThan(0);
  });

  test("null 1d change stays last in both directions", () => {
    const filled = normalizeAdjacentIndex({
      index_id: "red",
      name: "Republican",
      ticker: "RED",
      latest_price: 98,
      change_1d: 0.2,
    });
    const empty = normalizeAdjacentIndex({
      index_id: "gap",
      name: "Unpriced",
      ticker: "GAP",
      latest_price: 50,
      change_1d: null,
    });
    expect(compareAdjacentIndexRows(empty, filled, "chg1d", "asc")).toBeGreaterThan(0);
    expect(compareAdjacentIndexRows(empty, filled, "chg1d", "desc")).toBeGreaterThan(0);
    expect(compareAdjacentIndexRows(filled, empty, "chg1d", "desc")).toBeLessThan(0);
  });

  test("unwraps public news and market list payloads", () => {
    const articles = unwrapAdjacentNewsArticles({
      data: [{
        article_id: "hormuz-1",
        title: "Iran won’t reopen Strait of Hormuz without US concessions",
        url: "https://apnews.com/hormuz",
        source: "Associated Press",
        published_date: "2026-08-10T10:58:24Z",
        image_url: "https://example.com/hormuz.jpg",
      }],
    });
    expect(articles).toHaveLength(1);
    expect(articles[0]?.id).toBe("hormuz-1");
    expect(normalizeAdjacentNewsArticle(articles[0]!).topics).toContain("adjacent");
    expect(unwrapAdjacentMarketIds({
      data: [{ market_id: "polymarket:abc" }, { id: "kalshi:def" }],
    })).toEqual(["polymarket:abc", "kalshi:def"]);
  });

  test("unwraps similar markets from data payloads onto UI fields", () => {
    const markets = unwrapAdjacentSimilarMarkets({
      data: [{
        market_id: "kalshi:KXNBA-26-NYK",
        question: "Will the New York win the 2026 Pro Basketball Finals?",
        latest_price: 37,
        similarity: 0.91,
        platform: "kalshi",
      }],
    });
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({
      id: "kalshi:KXNBA-26-NYK",
      title: "Will the New York win the 2026 Pro Basketball Finals?",
      yes_price: 37,
      similarity: 0.91,
      platform: "kalshi",
    });
    expect(formatYesOddsPercent(markets[0]!.yes_price)).toBe("37%");
    expect(formatYesOddsPercent(null)).toBeNull();
  });
});
