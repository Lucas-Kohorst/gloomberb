import { describe, expect, test } from "bun:test";
import { adjacentLevelSeries, loadAdjacentChartSeries } from "./series";
import { priceColor } from "../../../theme/colors";

describe("adjacentLevelSeries", () => {
  test("draws a line on the right axis, colored by the window change", () => {
    const up = adjacentLevelSeries([
      { date: new Date("2026-09-01T00:00:00Z"), close: 390 },
      { date: new Date("2026-10-01T00:00:00Z"), close: 421.6 },
    ], { id: "ADJ:hou_nti", label: "HOUNTI" });
    expect(up.style).toBe("line");
    expect(up.axis).toBe("right");
    expect(up.color).toBe(priceColor(421.6 - 390));

    const down = adjacentLevelSeries([
      { date: new Date("2026-09-01T00:00:00Z"), close: 421.6 },
      { date: new Date("2026-10-01T00:00:00Z"), close: 390 },
    ], { id: "ADJ:hou_nti", label: "HOUNTI" });
    expect(down.color).toBe(priceColor(390 - 421.6));
  });
});

describe("loadAdjacentChartSeries", () => {
  test("uses index prices when the id is an Adjacent index", async () => {
    const result = await loadAdjacentChartSeries({
      requestApiKey: null,
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
      requestApiKey: null,
      getIndexPrices: async () => ({ data: [] }),
      getRatePrices: async () => ({ data: [{ timestamp: "2024-06-01T00:00:00Z", price: 52.4 }] }),
    }, "house");
    expect(emptyIndex.points[0]?.value).toBe(52.4);

    const missingIndex = await loadAdjacentChartSeries({
      requestApiKey: null,
      getIndexPrices: async () => {
        throw new Error("404");
      },
      getRatePrices: async () => ({ data: [{ timestamp: "2024-06-01T00:00:00Z", price: 85.5 }] }),
    }, "adj_bluh");
    expect(missingIndex.points[0]?.value).toBe(85.5);
  });

  test("only builds a price window when the resolve flow supplies a range", async () => {
    const windows: Array<{ interval?: string; perPage?: number; order?: string } | undefined> = [];
    const client = {
      requestApiKey: "ak_test" as string | null,
      getIndexPrices: async (_id: string, window?: { interval: string; perPage?: number; order?: string }) => {
        windows.push(window);
        return { data: [{ timestamp: "2024-01-02T00:00:00Z", price: 101.5 }] };
      },
      getRatePrices: async () => {
        throw new Error("should not load rates");
      },
    };

    await loadAdjacentChartSeries(client, "red", { range: "1M" });
    await loadAdjacentChartSeries(client, "red");

    expect(windows[0]).toMatchObject({ interval: "1d", perPage: 1000, order: "asc" });
    expect(windows[1]).toBeUndefined();
  });
});
