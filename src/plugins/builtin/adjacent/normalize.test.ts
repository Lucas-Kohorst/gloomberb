import { describe, expect, test } from "bun:test";
import {
  adjacentRateSortValue,
  compareAdjacentIndexRows,
  normalizeAdjacentIndex,
  normalizeAdjacentIndexPrices,
  normalizeAdjacentNewsArticle,
  normalizeAdjacentRate,
  unwrapAdjacentMarketIds,
  unwrapAdjacentNewsArticles,
  unwrapAdjacentSimilarMarkets,
  formatYesOddsPercent,
  constituentImpliedPercent,
  constituentChartExpression,
  constituentOpenSymbol,
  formatImpliedPercent,
  mergeIndexConstituents,
  unwrapAdjacentPriceSamples,
} from "./normalize";
import { applySortPreference } from "../../../utils/sort-values";

describe("adjacent normalize", () => {
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
      price_change_1d: 1.25,
    });
    expect(row.id).toBe("adj_bluh");
    expect(row.value).toBe(85.5);
    expect(row.spread).toBe(0);
    expect(row.change1d).toBe(1.25);
  });

  test("sorts rates by 1d change descending", () => {
    const house = normalizeAdjacentRate({
      rate_id: "house",
      name: "House",
      latest_price: 85.5,
      price_change_1d: 1.25,
    });
    const senate = normalizeAdjacentRate({
      rate_id: "senate",
      name: "Senate",
      latest_price: 52,
      price_change_1d: -0.4,
    });
    const sorted = applySortPreference(
      [house, senate],
      { columnId: "chg1d", direction: "desc" },
      adjacentRateSortValue,
    );
    expect(sorted.map((row) => row.id)).toEqual(["house", "senate"]);
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

  test("scales NTI rate prices to percent and leaves Kalshi cents alone", () => {
    expect(constituentImpliedPercent({
      market_id: "nti_hou_conf_27",
      platform: "nti_hou_conf_27",
      price: 0.105,
    })).toBeCloseTo(10.5);
    expect(constituentImpliedPercent({
      market_id: "kalshi:HOUSEPA7-26-R",
      platform: "kalshi",
      price: 22,
    })).toBe(22);
    expect(constituentImpliedPercent({
      market_id: "kalshi:HOUSEPA7-26-R",
      platform: "kalshi",
      price: 1,
    })).toBe(1);
    expect(constituentImpliedPercent({
      market_id: "nti_hou_wins_27_1",
      platform: "nti_hou_wins_27_1",
    })).toBeNull();
  });

  test("formats implied percents without rounding 10.5 down to 0", () => {
    expect(formatImpliedPercent(10.5)).toBe("10.5%");
    expect(formatImpliedPercent(22)).toBe("22%");
    expect(formatImpliedPercent(0.105 * 100)).toBe("10.5%");
  });

  test("replaces a stale unpriced NTI sleeve with live members", () => {
    const merged = mergeIndexConstituents(
      [
        { market_id: "nti_hou_conf_27", platform: "nti_hou_conf_27", name: "Conference 2027", weight: 0.25, price: 0.105 },
        { market_id: "nti_hou_wins_27_1", platform: "nti_hou_wins_27_1", name: "Win total 1+ 2027", weight: 0.25 },
      ],
      [
        {
          sleeve: "conference",
          name: "Conference 2027",
          rate_id: "nti_hou_conf_27",
          mark_price: 0.105,
          members: [{ rate_id: "nti_hou_conf_27", name: "Conference 2027", mark_price: 0.105 }],
        },
        {
          sleeve: "wins",
          name: "Win total 10+ 2027 / Win total 11+ 2027",
          rate_id: "nti_hou_wins_27_10",
          mark_price: 0.485,
          members: [
            { rate_id: "nti_hou_wins_27_10", name: "Win total 10+ 2027", mark_price: 0.635 },
            { rate_id: "nti_hou_wins_27_11", name: "Win total 11+ 2027", mark_price: 0.485 },
          ],
        },
      ],
    );
    expect(merged.map((row) => row.market_id)).toEqual([
      "nti_hou_conf_27",
      "nti_hou_wins_27_10",
      "nti_hou_wins_27_11",
    ]);
    expect(constituentImpliedPercent(merged[1]!)).toBeCloseTo(63.5);
  });

  test("ignores sleeves from another rate family", () => {
    const constituents = [
      { market_id: "nti_hou_conf_27", platform: "nti_hou_conf_27", weight: 1 },
    ];
    const merged = mergeIndexConstituents(constituents, [
      {
        sleeve: "conference",
        name: "Conference 2027",
        rate_id: "nti_hou_conf_27",
        members: [{ rate_id: "nti_hou_conf_27", name: "Conference 2027", mark_price: 0.1 }],
      },
      {
        sleeve: "wins",
        name: "Win total 2028",
        rate_id: "nti_hou_wins_28",
        members: [{ rate_id: "nti_hou_wins_28", name: "Win total 2028", mark_price: 0.2 }],
      },
    ]);
    expect(merged.map((row) => row.market_id)).toEqual(["nti_hou_conf_27"]);
  });

  test("unwraps index prices from points payloads", () => {
    const points = unwrapAdjacentPriceSamples({
      points: [
        { timestamp: "2026-09-03T20:00:00Z", price: 1000 },
        { timestamp: "2026-09-04T15:33:00Z", price: 992.9 },
      ],
    });
    expect(points).toHaveLength(2);
    expect(normalizeAdjacentIndexPrices(points)[0]?.value).toBe(1000);
  });

  test("maps constituents to chart and open symbols", () => {
    const kalshi = {
      market_id: "kalshi:KXHOUSERACE-PA15-26-R",
      platform: "kalshi",
      ticker: "KXHOUSERACE-PA15-26-R",
    };
    expect(constituentChartExpression(kalshi)).toBe("KALSHI:KXHOUSERACE-PA15-26-R");
    expect(constituentOpenSymbol(kalshi)).toBe("KALSHI:KXHOUSERACE-PA15-26-R");
    const rate = { market_id: "nti_hou_div_27", platform: "nti_hou_div_27" };
    expect(constituentChartExpression(rate)).toBe("ADJ:nti_hou_div_27");
    expect(constituentOpenSymbol(rate)).toBeNull();
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
