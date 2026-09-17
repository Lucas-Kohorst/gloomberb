import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../../utils/http-transport";
import {
  buildPredictionMarketResultItems,
  looksLikePredictionInstrumentQuery,
  openCommandBarPredictionInstrument,
  searchPredictionInstruments,
} from "./prediction-results";
import type { PredictionMarketSummary } from "../../../../plugins/prediction-markets/types";

function summary(
  venue: "kalshi" | "polymarket",
  marketId: string,
  title: string,
): PredictionMarketSummary {
  return {
    key: `${venue}:${marketId}`,
    venue,
    marketId,
    title,
    marketLabel: title,
    eventLabel: title,
    status: "open",
    url: "",
    description: "",
    endsAt: null,
    updatedAt: null,
    createdAt: null,
    yesPrice: null,
    noPrice: null,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: null,
    volume24h: null,
    volume24hUnit: "usd",
    totalVolume: null,
    totalVolumeUnit: "usd",
    openInterest: null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
  };
}

describe("looksLikePredictionInstrumentQuery", () => {
  test("accepts topic text and prefixed ids, skips short equity tickers", () => {
    expect(looksLikePredictionInstrumentQuery("clancy")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("trump")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("fed")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("oscar")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("KXFED")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("KALSHI:KXCLANCY")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("AAPL")).toBe(false);
    expect(looksLikePredictionInstrumentQuery("MSFT")).toBe(false);
    expect(looksLikePredictionInstrumentQuery("ab")).toBe(false);
  });
});

describe("openCommandBarPredictionInstrument", () => {
  test("pins a floating ticker pane instead of docking via navigateTicker", async () => {
    const pinTicker = (symbol: string, options?: { floating?: boolean }) => {
      calls.push({ symbol, options });
    };
    const calls: Array<{ symbol: string; options?: { floating?: boolean } }> = [];
    const dispatched: unknown[] = [];

    openCommandBarPredictionInstrument({
      summary: summary("kalshi", "KXDIESELW-26SEP21-T6.38", "Diesel < $6.38"),
      tickerRepository: { saveTicker: () => {} },
      dispatch: (action) => dispatched.push(action),
      pluginRegistry: {
        events: { emit() {} },
        pinTicker,
      },
    });
    await Promise.resolve();

    expect(calls).toEqual([{
      symbol: "KALSHI:KXDIESELW-26SEP21-T6.38",
      options: { floating: true },
    }]);
    expect(dispatched).toEqual([expect.objectContaining({
      type: "UPDATE_TICKER",
      ticker: expect.objectContaining({
        metadata: expect.objectContaining({ ticker: "KALSHI:KXDIESELW-26SEP21-T6.38" }),
      }),
    })]);
  });
});

describe("buildPredictionMarketResultItems", () => {
  test("labels Kalshi and Polymarket rows as instruments", () => {
    const opened: string[] = [];
    const items = buildPredictionMarketResultItems({
      markets: [
        summary("kalshi", "KXCLANCY-YES", "Will Lindsay Clancy be convicted?"),
        summary("polymarket", "lindsay-clancy-convicted-of-murder", "Lindsay Clancy convicted of murder?"),
      ],
      onOpen: (market) => opened.push(market.marketId),
    });
    expect(items.map((item) => [item.label, item.badge, item.right])).toEqual([
      ["KALSHI:KXCLANCY-YES", "PM", undefined],
      ["POLY:lindsay-clancy-convicted-of-murder", "PM", undefined],
    ]);
    items[0]?.action();
    expect(opened).toEqual(["KXCLANCY-YES"]);
  });
});

describe("searchPredictionInstruments", () => {
  afterEach(() => {
    setHttpFetchTransport(null);
  });

  test("issues separate Kalshi and Polymarket Adjacent searches", async () => {
    const requested: string[] = [];
    setHttpFetchTransport(async (url) => {
      requested.push(url);
      return new Response(JSON.stringify({ data: [], meta: { has_next: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await searchPredictionInstruments("fed decision");

    const kalshi = requested.find((url) => url.includes("platform=kalshi") && !url.includes("platform=kalshi,"));
    const poly = requested.find((url) => url.includes("platform=polymarket"));
    expect(kalshi).toContain("search=fed");
    expect(poly).toContain("search=fed");
    expect(requested.some((url) => url.includes("platform=kalshi,polymarket"))).toBe(false);
  });

  test("keeps Kalshi rows when Adjacent returns the live list shape", async () => {
    setHttpFetchTransport(async (url) => {
      const kalshi = url.includes("platform=kalshi") && !url.includes("platform=kalshi,");
      const body = kalshi
        ? {
          data: [{
            market_id: "kalshi:KXRECOGROC-29",
            ticker: "KXRECOGROC-29",
            platform: "kalshi",
            question: "Will Trump recognize Somaliland?",
            status: "active",
            probability: 15,
            volume_24h: 0,
          }],
          meta: { has_next: false },
        }
        : {
          data: [{
            market_id: "polymarket:0x501986de68bd14841c835ec33df35e3cb5355ecff2ace13c0b31d8b907f7f018",
            ticker: "0x501986de68bd14841c835ec33df35e3cb5355ecff2ace13c0b31d8b907f7f018",
            display_ticker: "trump-renames-strait-of-hormuz",
            platform: "polymarket",
            question: "Trump renames Strait of Hormuz to Strait of Trump?",
            link: "https://polymarket.com/event/trump-renames-strait-of-hormuz",
            status: "active",
            probability: 10,
          }],
          meta: { has_next: false },
        };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const markets = await searchPredictionInstruments("trump");
    expect(markets.some((market) => market.venue === "kalshi" && market.marketId === "KXRECOGROC-29")).toBe(true);
    expect(markets.some((market) => market.venue === "polymarket")).toBe(true);
  });
});
