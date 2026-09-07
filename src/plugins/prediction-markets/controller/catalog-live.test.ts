import { describe, expect, test } from "bun:test";
import type { PredictionListRow, PredictionMarketSummary } from "../types";
import {
  collectPredictionCatalogLiveTargets,
  liveTargetSignature,
  MAX_PREDICTION_CATALOG_LIVE_MARKETS,
  quoteFromBbo,
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

  test("live target signature ignores visual order of the same markets", () => {
    const first = summary({
      key: "polymarket:a",
      venue: "polymarket",
      marketId: "a",
      yesTokenId: "yes-a",
    });
    const second = summary({
      key: "polymarket:b",
      venue: "polymarket",
      marketId: "b",
      yesTokenId: "yes-b",
    });
    expect(liveTargetSignature(collectPredictionCatalogLiveTargets([row(first), row(second)]))).toBe(
      liveTargetSignature(collectPredictionCatalogLiveTargets([row(second), row(first)])),
    );
  });

  test("subscribes to a group's displayed outcome, then the other members", () => {
    const leader = summary({
      key: "polymarket:no-change",
      venue: "polymarket",
      marketId: "no-change",
      yesTokenId: "yes-leader",
      marketLabel: "No change",
      yesPrice: 0.69,
    });
    const other = summary({
      key: "polymarket:hike",
      venue: "polymarket",
      marketId: "hike",
      yesTokenId: "yes-other",
      marketLabel: "25 bps increase",
      yesPrice: 0.28,
    });
    const grouped: PredictionListRow = {
      ...row(other),
      kind: "group",
      key: "group:polymarket:event:fed",
      representative: other,
      focusMarketKey: leader.key,
      focusMarketLabel: leader.marketLabel,
      focusYesPrice: leader.yesPrice,
      markets: [other, leader],
    };
    expect(collectPredictionCatalogLiveTargets([grouped]).map((target) => target.yesTokenId)).toEqual([
      "yes-leader",
      "yes-other",
    ]);
  });
});

describe("quoteFromBbo", () => {
  test("moves displayed yes odds to the bid/ask mid so the list can flash", () => {
    const quote = quoteFromBbo(true, 0.54, 0.56, 0.02);
    expect(quote.yesBid).toBe(0.54);
    expect(quote.yesAsk).toBe(0.56);
    expect(quote.spread).toBe(0.02);
    expect(quote.yesPrice).toBeCloseTo(0.55);
    expect(quote.lastTradePrice).toBeUndefined();
  });
});
