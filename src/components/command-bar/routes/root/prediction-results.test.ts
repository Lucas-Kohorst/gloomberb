import { describe, expect, test } from "bun:test";
import {
  buildPredictionMarketResultItems,
  looksLikePredictionInstrumentQuery,
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
    expect(looksLikePredictionInstrumentQuery("KALSHI:KXCLANCY")).toBe(true);
    expect(looksLikePredictionInstrumentQuery("AAPL")).toBe(false);
    expect(looksLikePredictionInstrumentQuery("ab")).toBe(false);
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
