import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "./fetch";
import { loadVenuePredictionMarketSeries } from "./series";

const KALSHI_MARKET = {
  ticker: "CONTROLS-2026-R",
  title: "Which party will win the U.S. Senate?",
  yes_sub_title: "Republican Party",
  event_ticker: "CONTROLS-2026",
  status: "active",
  market_type: "binary",
  custom_strike: { politician: "rep" },
  yes_bid_dollars: "0.5200",
  yes_ask_dollars: "0.5400",
  last_price_dollars: "0.5300",
  volume_24h_fp: "5000.00",
  notional_value_dollars: "1.0000",
};

const KALSHI_QUIET_MARKET = {
  ...KALSHI_MARKET,
  ticker: "CONTROLS-2026-D",
  yes_sub_title: "Democratic Party",
  last_price_dollars: "0.4700",
  volume_24h_fp: "100.00",
};

const CANDLESTICKS = {
  candlesticks: [
    { end_period_ts: 1_760_000_000, price: { close_dollars: "0.5100" } },
    { end_period_ts: 1_760_086_400, price: { close_dollars: "0.5300" } },
  ],
};

function mockTransport(routes: Array<[string, unknown | number]>): string[] {
  const requested: string[] = [];
  setHttpFetchTransport(async (url) => {
    requested.push(url);
    for (const [fragment, payload] of routes) {
      if (!url.includes(fragment)) continue;
      if (typeof payload === "number") {
        return new Response("{}", { status: payload });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
  return requested;
}

beforeEach(() => {
  attachPredictionMarketsPersistence(new MemoryPluginPersistence());
});

afterEach(() => {
  setHttpFetchTransport(null);
  resetPredictionMarketsPersistence();
});

describe("venue-direct prediction market series", () => {
  test("charts a Kalshi market ticker by resolving its series ticker", async () => {
    const requested = mockTransport([
      ["/candlesticks", CANDLESTICKS],
      ["/markets/CONTROLS-2026-R", { market: KALSHI_MARKET }],
      [
        "/events/CONTROLS-2026",
        {
          event: {
            title: "Which party will win the U.S. Senate?",
            sub_title: "In 2026",
            series_ticker: "CONTROLS",
          },
          markets: [KALSHI_MARKET],
        },
      ],
    ]);

    const series = await loadVenuePredictionMarketSeries("kalshi", "controls-2026-r");

    expect(series?.points.map((point) => point.close)).toEqual([0.51, 0.53]);
    expect(series?.marketId).toBe("CONTROLS-2026-R");
    expect(series?.label).toContain("Republican Party");
    expect(
      requested.some((url) =>
        url.includes("/series/CONTROLS/markets/CONTROLS-2026-R/candlesticks"),
      ),
    ).toBe(true);
  });

  test("falls back to the busiest market when given a Kalshi event ticker", async () => {
    const requested = mockTransport([
      ["/candlesticks", CANDLESTICKS],
      ["/markets/CONTROLS-2026", 404],
      [
        "/events/CONTROLS-2026",
        {
          event: { title: "U.S. Senate", series_ticker: "CONTROLS" },
          markets: [KALSHI_QUIET_MARKET, KALSHI_MARKET],
        },
      ],
    ]);

    const series = await loadVenuePredictionMarketSeries("kalshi", "CONTROLS-2026");

    expect(series?.marketId).toBe("CONTROLS-2026-R");
    expect(
      requested.some((url) => url.includes("/markets/CONTROLS-2026-R/candlesticks")),
    ).toBe(true);
  });

  test("charts a Polymarket slug through Gamma and the CLOB history feed", async () => {
    mockTransport([
      [
        "prices-history",
        { history: [{ t: 1_760_000_000, p: 0.44 }, { t: 1_760_086_400, p: 0.46 }] },
      ],
      [
        "gamma-api.polymarket.com/markets?slug=xi-jinping-out-before-2027",
        [
          {
            id: "559651",
            question: "Xi Jinping out before 2027?",
            slug: "xi-jinping-out-before-2027",
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.46","0.54"]',
            clobTokenIds: '["yes-token","no-token"]',
          },
        ],
      ],
    ]);

    const series = await loadVenuePredictionMarketSeries(
      "polymarket",
      "xi-jinping-out-before-2027",
    );

    expect(series?.points.map((point) => point.close)).toEqual([0.44, 0.46]);
    expect(series?.marketId).toBe("559651");
  });

  test("revives dates from cached history so the chart can plot it", async () => {
    const persistence = new MemoryPluginPersistence();
    attachPredictionMarketsPersistence(persistence);
    // Persisted history round-trips through JSON, which turns dates into strings.
    persistence.seedResource(
      "history",
      "kalshi:CONTROLS-2026-R:ALL",
      JSON.parse(
        JSON.stringify([{ date: new Date(1_760_000_000_000), close: 0.51 }]),
      ),
      { sourceKey: "remote" },
    );
    mockTransport([
      ["/markets/CONTROLS-2026-R", { market: KALSHI_MARKET }],
      [
        "/events/CONTROLS-2026",
        {
          event: { title: "U.S. Senate", series_ticker: "CONTROLS" },
          markets: [KALSHI_MARKET],
        },
      ],
    ]);

    const series = await loadVenuePredictionMarketSeries("kalshi", "CONTROLS-2026-R");

    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]?.date).toBeInstanceOf(Date);
    expect(series?.points[0]?.date.getTime()).toBe(1_760_000_000_000);
  });

  test("returns null when the venue does not know the identifier", async () => {
    mockTransport([]);

    expect(await loadVenuePredictionMarketSeries("kalshi", "NOPE-1")).toBeNull();
  });
});
