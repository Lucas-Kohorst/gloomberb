import { describe, expect, test } from "bun:test";
import type { PredictionListRow, PredictionMarketSummary } from "../types";
import {
  collectPredictionCatalogLiveTargets,
  MAX_PREDICTION_CATALOG_LIVE_MARKETS,
} from "./catalog-live";

function summary(
  overrides: Partial<PredictionMarketSummary> & Pick<PredictionMarketSummary, "key" | "venue" | "marketId">,
): PredictionMarketSummary {
  return {
    title: overrides.marketId,
    marketLabel: overrides.marketId,
    eventLabel: overrides.marketId,
    status: "open",
    url: "",
    description: "",
    endsAt: null,
    updatedAt: null,
    createdAt: null,
    yesPrice: 0.5,
    noPrice: 0.5,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: 0.5,
    volume24h: null,
    volume24hUnit: "usd",
    totalVolume: null,
    totalVolumeUnit: "usd",
    openInterest: null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
    ...overrides,
  };
}

function row(market: PredictionMarketSummary): PredictionListRow {
  return {
    kind: "market",
    key: market.key,
    venue: market.venue,
    representative: market,
    focusMarketKey: market.key,
    focusMarketLabel: market.marketLabel,
    focusYesPrice: market.yesPrice,
    markets: [market],
    title: market.title,
    marketId: market.marketId,
    marketLabel: market.marketLabel,
    eventLabel: market.eventLabel,
    status: market.status,
    url: market.url,
    description: market.description,
    endsAt: market.endsAt,
    updatedAt: market.updatedAt,
    createdAt: market.createdAt,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    spread: market.spread,
    lastTradePrice: market.lastTradePrice,
    volume24h: market.volume24h,
    volume24hUnit: market.volume24hUnit,
    totalVolume: market.totalVolume,
    totalVolumeUnit: market.totalVolumeUnit,
    openInterest: market.openInterest,
    openInterestUnit: market.openInterestUnit,
    liquidity: market.liquidity,
    liquidityUnit: market.liquidityUnit,
    searchText: market.title,
    watchMarketKeys: [market.key],
  };
}

describe("collectPredictionCatalogLiveTargets", () => {
  test("collects unique Polymarket yes tokens and skips Kalshi", () => {
    const poly = summary({
      key: "polymarket:a",
      venue: "polymarket",
      marketId: "a",
      yesTokenId: "yes-a",
      noTokenId: "no-a",
    });
    const kalshi = summary({
      key: "kalshi:b",
      venue: "kalshi",
      marketId: "KX-B",
    });
    const targets = collectPredictionCatalogLiveTargets([row(poly), row(kalshi), row(poly)]);
    expect(targets).toEqual([
      { key: "polymarket:a", yesTokenId: "yes-a", noTokenId: "no-a" },
    ]);
  });

  test("caps live subscriptions", () => {
    const rows = Array.from({ length: MAX_PREDICTION_CATALOG_LIVE_MARKETS + 5 }, (_, index) => (
      row(summary({
        key: `polymarket:${index}`,
        venue: "polymarket",
        marketId: String(index),
        yesTokenId: `yes-${index}`,
      }))
    ));
    expect(collectPredictionCatalogLiveTargets(rows)).toHaveLength(MAX_PREDICTION_CATALOG_LIVE_MARKETS);
  });
});
