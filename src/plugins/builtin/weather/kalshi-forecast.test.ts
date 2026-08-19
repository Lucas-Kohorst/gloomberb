import { describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../../prediction-markets/services/fetch";
import {
  candlePriceAtFreeze,
  loadKalshiImpliedHigh,
  loadKalshiImpliedHighAtLocalMidnight,
  resetKalshiImpliedCache,
} from "./kalshi-forecast";

const EVENT = {
  event: {
    title: "Highest temperature in Los Angeles on Aug 19, 2026?",
    series_ticker: "KXHIGHLAX",
    event_ticker: "KXHIGHLAX-26AUG19",
    markets: [
      {
        ticker: "KXHIGHLAX-26AUG19-B82.5",
        event_ticker: "KXHIGHLAX-26AUG19",
        status: "active",
        market_type: "binary",
        last_price_dollars: "0.6300",
        strike_type: "between",
        floor_strike: 82,
        cap_strike: 83,
      },
      {
        ticker: "KXHIGHLAX-26AUG19-T83",
        event_ticker: "KXHIGHLAX-26AUG19",
        status: "active",
        market_type: "binary",
        last_price_dollars: "0.3700",
        strike_type: "greater",
        floor_strike: 83,
      },
    ],
  },
};

describe("kalshi implied high fetch", () => {
  test("loads nested event markets and returns a weighted high", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    resetKalshiImpliedCache();
    setHttpFetchTransport(async (url) => {
      if (url.includes("/events/KXHIGHLAX-26AUG19")) {
        return new Response(JSON.stringify(EVENT), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    try {
      const implied = await loadKalshiImpliedHigh("LAX", "2026-08-19");
      expect(implied).toMatchObject({
        stationId: "LAX",
        date: "2026-08-19",
        eventOpen: true,
      });
      expect(implied!.impliedHigh).toBeCloseTo(83.055, 2);
    } finally {
      setHttpFetchTransport(null);
      resetPredictionMarketsPersistence();
      resetKalshiImpliedCache();
    }
  });

  test("samples the last candle at or before freeze rather than a later settled print", () => {
    const freeze = Math.floor(Date.parse("2026-08-18T07:00:00Z") / 1000);
    expect(candlePriceAtFreeze([
      { end_period_ts: freeze - 3600, price: { close_dollars: "0.2200" } },
      { end_period_ts: freeze, price: { close_dollars: "0.2200" } },
      { end_period_ts: freeze + 3600, price: { close_dollars: "0.9900" } },
    ], freeze)).toBeCloseTo(0.22, 5);
  });

  test("reconstructs local-midnight implied from candlesticks and ignores settled last prices", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    resetKalshiImpliedCache();
    const freeze = Math.floor(Date.parse("2026-08-18T07:00:00Z") / 1000);
    setHttpFetchTransport(async (url) => {
      if (url.includes("/events/KXHIGHLAX-26AUG18")) {
        return new Response(JSON.stringify({
          event: {
            title: "Highest temperature in Los Angeles on Aug 18, 2026?",
            series_ticker: "KXHIGHLAX",
            event_ticker: "KXHIGHLAX-26AUG18",
            markets: [
              {
                ticker: "KXHIGHLAX-26AUG18-B79.5",
                status: "finalized",
                last_price_dollars: "0.0100",
                strike_type: "between",
                floor_strike: 79,
                cap_strike: 80,
              },
              {
                ticker: "KXHIGHLAX-26AUG18-B81.5",
                status: "finalized",
                last_price_dollars: "0.9900",
                strike_type: "between",
                floor_strike: 81,
                cap_strike: 82,
              },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("/markets/KXHIGHLAX-26AUG18-B79.5/candlesticks")) {
        return new Response(JSON.stringify({
          candlesticks: [{ end_period_ts: freeze, price: { close_dollars: "0.6500" } }],
        }), { status: 200 });
      }
      if (url.includes("/markets/KXHIGHLAX-26AUG18-B81.5/candlesticks")) {
        return new Response(JSON.stringify({
          candlesticks: [{ end_period_ts: freeze, price: { close_dollars: "0.2200" } }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    try {
      const implied = await loadKalshiImpliedHighAtLocalMidnight("LAX", "2026-08-18", "America/Los_Angeles");
      expect(implied).toMatchObject({
        stationId: "LAX",
        date: "2026-08-18",
        eventOpen: true,
      });
      expect(implied!.impliedHigh).toBeCloseTo((0.65 * 79.5 + 0.22 * 81.5) / 0.87, 2);
    } finally {
      setHttpFetchTransport(null);
      resetPredictionMarketsPersistence();
      resetKalshiImpliedCache();
    }
  });

  test("refuses a candle book that has already collapsed to 0/1", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    resetKalshiImpliedCache();
    const freeze = Math.floor(Date.parse("2026-08-18T07:00:00Z") / 1000);
    setHttpFetchTransport(async (url) => {
      if (url.includes("/events/KXHIGHLAX-26AUG18")) {
        return new Response(JSON.stringify({
          event: {
            series_ticker: "KXHIGHLAX",
            event_ticker: "KXHIGHLAX-26AUG18",
            markets: [
              {
                ticker: "KXHIGHLAX-26AUG18-B81.5",
                status: "finalized",
                last_price_dollars: "0.9900",
                strike_type: "between",
                floor_strike: 81,
                cap_strike: 82,
              },
              {
                ticker: "KXHIGHLAX-26AUG18-T82",
                status: "finalized",
                last_price_dollars: "0.0100",
                strike_type: "greater",
                floor_strike: 82,
              },
            ],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candlesticks: [{ end_period_ts: freeze, price: { close_dollars: url.includes("B81.5") ? "0.9900" : "0.0100" } }],
      }), { status: 200 });
    });
    try {
      const implied = await loadKalshiImpliedHighAtLocalMidnight("LAX", "2026-08-18", "America/Los_Angeles");
      expect(implied).toBeNull();
    } finally {
      setHttpFetchTransport(null);
      resetPredictionMarketsPersistence();
      resetKalshiImpliedCache();
    }
  });
});
