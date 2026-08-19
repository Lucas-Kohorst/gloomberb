import { describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../../prediction-markets/services/fetch";
import { loadKalshiImpliedHigh, resetKalshiImpliedCache } from "./kalshi-forecast";

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
});
