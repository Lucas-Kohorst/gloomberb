import { describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../../../src/test-support/plugin-persistence";
import { setHttpFetchTransport } from "../../../../../src/utils/http-transport";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../../../../../src/plugins/prediction-markets/services/fetch";
import { candleYesPrice, loadKalshiStrikeBookSeries, resetKalshiStrikeBookCache } from "./kalshi";
import { favoriteStrikeAtCutoff } from "./strikes";

const EVENT = {
  event: {
    title: "Highest temperature in Los Angeles on Aug 31, 2026?",
    series_ticker: "KXHIGHLAX",
    event_ticker: "KXHIGHLAX-26AUG31",
    markets: [
      {
        ticker: "KXHIGHLAX-26AUG31-B78.5",
        strike_type: "between",
        floor_strike: 78,
        cap_strike: 79,
        result: "yes",
        expiration_value: "79.00",
      },
      {
        ticker: "KXHIGHLAX-26AUG31-T79",
        strike_type: "greater",
        floor_strike: 79,
        result: "no",
        expiration_value: "79.00",
      },
    ],
  },
};

describe("kalshi weather book loader", () => {
  test("parses live close_dollars and historical close as yes", () => {
    expect(candleYesPrice({
      end_period_ts: 10,
      yes_bid: { close_dollars: "0.5700" },
      yes_ask: { close_dollars: "0.5900" },
      price: { close_dollars: "0.5800" },
    })).toEqual({ t: 10, yes: 0.58 });
    expect(candleYesPrice({
      end_period_ts: 11,
      price: { close: "0.0400", previous: "0.0400" },
    })).toEqual({ t: 11, yes: 0.04 });
  });

  test("loads nested markets and 1-minute candles through the shared Kalshi fetch path", async () => {
    attachPredictionMarketsPersistence(new MemoryPluginPersistence());
    resetKalshiStrikeBookCache();
    setHttpFetchTransport(async (url) => {
      const href = String(url);
      if (href.includes("/historical/cutoff")) {
        return new Response(JSON.stringify({ market_settled_ts: "2026-07-03T00:00:00Z" }), { status: 200 });
      }
      if (href.includes("/events/KXHIGHLAX-26AUG31")) {
        return new Response(JSON.stringify(EVENT), { status: 200 });
      }
      if (href.includes("/markets/KXHIGHLAX-26AUG31-B78.5/candlesticks")) {
        return new Response(JSON.stringify({
          candlesticks: [{
            end_period_ts: 1788199200,
            yes_bid: { close_dollars: "0.5700" },
            yes_ask: { close_dollars: "0.5900" },
            price: { close_dollars: "0.5800" },
          }],
        }), { status: 200 });
      }
      if (href.includes("/markets/KXHIGHLAX-26AUG31-T79/candlesticks")) {
        return new Response(JSON.stringify({
          candlesticks: [{
            end_period_ts: 1788199200,
            yes_bid: { close_dollars: "0.2500" },
            yes_ask: { close_dollars: "0.2700" },
            price: { close_dollars: "0.2600" },
          }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    try {
      const book = await loadKalshiStrikeBookSeries("LAX", "2026-08-31", Date.parse("2026-09-01T00:00:00Z"));
      expect(book?.eventTicker).toBe("KXHIGHLAX-26AUG31");
      expect(book?.settlementF).toBe(79);
      expect(book?.strikes.map((strike) => strike.label)).toEqual(["78–79", ">79"]);
      const favorite = favoriteStrikeAtCutoff(book!.strikes, book!.paths, 1788199200);
      expect(favorite?.bucket.ticker).toBe("KXHIGHLAX-26AUG31-B78.5");
      expect(favorite?.yesPrice).toBeCloseTo(0.58, 5);
    } finally {
      setHttpFetchTransport(null);
      resetPredictionMarketsPersistence();
      resetKalshiStrikeBookCache();
    }
  });
});
