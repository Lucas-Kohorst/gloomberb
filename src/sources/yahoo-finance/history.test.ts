import { describe, expect, test } from "bun:test";
import { loadYahooPriceHistoryForResolution } from "./history";

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
});
