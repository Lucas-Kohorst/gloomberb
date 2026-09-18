import { afterEach, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { overlayVenueStatsOnSummaries } from "./watchlist-hydrate";
import type { PredictionMarketSummary } from "../types";

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stub(partial: Partial<PredictionMarketSummary> & Pick<PredictionMarketSummary, "key" | "venue" | "marketId">): PredictionMarketSummary {
  return {
    title: partial.title ?? partial.marketId,
    marketLabel: partial.marketLabel ?? partial.marketId,
    eventLabel: partial.eventLabel ?? partial.marketId,
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
    ...partial,
  };
}

afterEach(() => {
  setHttpFetchTransport(null);
});

test("watchlist stubs pick up Kalshi last price and 24h volume from the venue", async () => {
  setHttpFetchTransport(async (url) => {
    expect(url).toContain("/trade-api/v2/markets/KXELONMARS-99");
    return json({
      market: {
        ticker: "KXELONMARS-99",
        title: "Will Elon Musk visit Mars in his lifetime?",
        status: "active",
        market_type: "binary",
        last_price_dollars: "0.10",
        yes_bid_dollars: "0.10",
        yes_ask_dollars: "0.12",
        volume_24h_fp: "2500",
        volume_fp: "118844.56",
      },
    });
  });

  const [hydrated] = await overlayVenueStatsOnSummaries([
    stub({ key: "kalshi:KXELONMARS-99", venue: "kalshi", marketId: "KXELONMARS-99" }),
  ]);
  expect(hydrated?.yesPrice).toBe(0.1);
  expect(hydrated?.volume24h).toBe(2500);
  expect(hydrated?.spread).toBeCloseTo(0.02);
});
