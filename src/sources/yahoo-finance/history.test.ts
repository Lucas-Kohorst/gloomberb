import { describe, expect, test } from "bun:test";
import { TIME_RANGES } from "../../time-series/range";
import { getPresetResolution } from "../../time-series/resolution";
import { YahooFinanceClient } from "../yahoo-finance";
import type { YahooHttpClient } from "./http";
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

  test("keeps winter four-hour equity bars inside the extended session without shifting futures", async () => {
    const start = Date.parse("2026-01-12T09:00:00Z"); // 04:00 New York, not 03:00.
    const fetchChart = async () => ({
      meta: { currency: "USD" },
      history: Array.from({ length: 5 }, (_, hour) => ({
        date: new Date(start + hour * 3_600_000),
        open: 100 + hour, high: 102 + hour, low: 99 + hour, close: 101 + hour, volume: 10,
      })),
    });
    const equity = await loadYahooPriceHistoryForResolution({
      ticker: "NVDA", exchange: "NASDAQ", resolution: "4h", fetchChart,
    });
    expect(equity.map((bar) => bar.date.toISOString())).toEqual([
      "2026-01-12T09:00:00.000Z", "2026-01-12T13:00:00.000Z",
    ]);
    expect(equity[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 104, volume: 40 });
    const futures = await loadYahooPriceHistoryForResolution({
      ticker: "ES=F", exchange: "NASDAQ", resolution: "4h", fetchChart,
    });
    expect(futures[0]!.date.toISOString()).toBe("2026-01-12T08:00:00.000Z");
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

  test("asks Yahoo for pre and post prints on intraday history only", async () => {
    const urls: string[] = [];
    const http = {
      fetchJson: async (url: string) => {
        urls.push(url);
        return {
          chart: {
            result: [{
              meta: { currency: "USD" },
              timestamp: [1_781_000_000],
              indicators: { quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [100] }] },
            }],
          },
        };
      },
    } as YahooHttpClient;
    const client = new YahooFinanceClient(http);
    await client.getPriceHistoryForResolution("HOOD", "NASDAQ", "1D", "1m");
    await client.getPriceHistoryForResolution("HOOD", "NASDAQ", "1Y", "1d");
    expect(urls[0]).toContain("interval=1m");
    expect(urls[0]).toContain("includePrePost=true");
    expect(urls[1]).toContain("interval=1d");
    expect(urls[1]).toContain("includePrePost=false");
  });
});
