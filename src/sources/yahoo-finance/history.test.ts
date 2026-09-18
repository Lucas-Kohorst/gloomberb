import { describe, expect, test } from "bun:test";
import { TIME_RANGES } from "../../time-series/range";
import { getPresetResolution } from "../../time-series/resolution";
import {
  getYahooChartRangeParams,
  loadYahooPriceHistory,
  loadYahooPriceHistoryForResolution,
} from "./history";

describe("Yahoo chart history", () => {
  test("derives four-hour bars from hourly history", async () => {
    let requestedResolution = "";
    const history = await loadYahooPriceHistoryForResolution({
      ticker: "AMD",
      exchange: "NASDAQ",
      bufferRange: "3M",
      resolution: "4h",
      fetchChart: async (_symbol, _range, resolution) => {
        requestedResolution = resolution;
        return {
          meta: { currency: "USD" },
          history: [
            { date: new Date("2026-07-06T00:00:00.000Z"), open: 100, high: 102, low: 99, close: 101, volume: 10 },
            { date: new Date("2026-07-06T01:00:00.000Z"), open: 101, high: 104, low: 100, close: 103, volume: 20 },
            { date: new Date("2026-07-06T04:00:00.000Z"), open: 103, high: 105, low: 102, close: 104, volume: 30 },
          ],
        };
      },
    });

    expect(requestedResolution).toBe("1h");
    expect(history).toEqual([
      { date: new Date("2026-07-06T00:00:00.000Z"), open: 100, high: 104, low: 99, close: 103, volume: 30 },
      { date: new Date("2026-07-06T04:00:00.000Z"), open: 103, high: 105, low: 102, close: 104, volume: 30 },
    ]);
  });

  test("repairs an isolated intraday wick without dropping the bar", async () => {
    const history = await loadYahooPriceHistoryForResolution({
      ticker: "AMD",
      exchange: "NASDAQ",
      bufferRange: "1M",
      resolution: "15m",
      fetchChart: async () => ({
        meta: { currency: "USD" },
        history: [
          {
            date: new Date("2026-07-06T14:00:00.000Z"),
            open: 99.5,
            high: 101,
            low: 99,
            close: 100,
          },
          {
            date: new Date("2026-07-06T14:15:00.000Z"),
            open: 100,
            high: 150,
            low: 99,
            close: 100.5,
          },
          {
            date: new Date("2026-07-06T14:30:00.000Z"),
            open: 100.5,
            high: 101,
            low: 100,
            close: 100.7,
          },
        ],
      }),
    });

    expect(history).toHaveLength(3);
    expect(history[1]).toMatchObject({
      open: 100,
      high: 100.5,
      low: 99,
      close: 100.5,
    });
  });

  test("AUTO range history uses the same intervals as RANGE_PRESET_RESOLUTION", async () => {
    for (const range of TIME_RANGES) {
      expect(getYahooChartRangeParams(range).interval).toBe(getPresetResolution(range));
    }
    expect(getYahooChartRangeParams("5Y")).toEqual({ range: "5y", interval: "1wk" });
    expect(getYahooChartRangeParams("ALL")).toEqual({ range: "max", interval: "1mo" });
  });

  test("5Y history requests weekly bars, not a daily dump", async () => {
    let requested: { range: string; interval: string } | null = null;
    await loadYahooPriceHistory({
      ticker: "AMD",
      exchange: "NASDAQ",
      range: "5Y",
      fetchChart: async (_symbol, range, interval) => {
        requested = { range, interval };
        return {
          meta: { currency: "USD" },
          history: [{ date: new Date("2026-01-01T00:00:00.000Z"), close: 100 }],
        };
      },
    });
    expect(requested).toEqual({ range: "5y", interval: "1wk" });
  });
});
