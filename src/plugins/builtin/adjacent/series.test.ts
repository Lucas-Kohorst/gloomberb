import { describe, expect, test } from "bun:test";
import { loadAdjacentChartSeries } from "./series";

describe("loadAdjacentChartSeries", () => {
  test("uses index prices when the id is an Adjacent index", async () => {
    const result = await loadAdjacentChartSeries({
      getIndexPrices: async () => ({ data: [{ timestamp: "2024-01-02T00:00:00Z", price: 101.5 }] }),
      getRatePrices: async () => {
        throw new Error("should not load rates");
      },
    }, "red");
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.value).toBe(101.5);
  });

  test("falls back to rate prices when index history is empty or missing", async () => {
    const emptyIndex = await loadAdjacentChartSeries({
      getIndexPrices: async () => ({ data: [] }),
      getRatePrices: async () => ({ data: [{ timestamp: "2024-06-01T00:00:00Z", price: 52.4 }] }),
    }, "house");
    expect(emptyIndex.points[0]?.value).toBe(52.4);

    const missingIndex = await loadAdjacentChartSeries({
      getIndexPrices: async () => {
        throw new Error("404");
      },
      getRatePrices: async () => ({ data: [{ timestamp: "2024-06-01T00:00:00Z", price: 85.5 }] }),
    }, "adj_bluh");
    expect(missingIndex.points[0]?.value).toBe(85.5);
  });
});
