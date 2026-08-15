import { describe, expect, test } from "bun:test";
import {
  normalizeAdjacentIndex,
  normalizeAdjacentIndexPrices,
  normalizeAdjacentRate,
} from "./normalize";

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
});
