import { describe, expect, test } from "bun:test";
import type { PredictionMarketDetail, PredictionTrade } from "../types";
import {
  applyPendingPredictionLiveUpdates,
  applyPredictionSummaryQuote,
  createPendingPredictionLiveUpdates,
} from "./live-updates";

function detail(): PredictionMarketDetail {
  return {
    summary: {
      key: "polymarket:m",
      venue: "polymarket",
      marketId: "m",
      title: "Test",
      marketLabel: "Test",
      eventLabel: "Test",
      status: "open",
      url: "https://example.com",
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
      lastTradePrice: null,
      volume24h: null,
      volume24hUnit: "usd",
      totalVolume: null,
      totalVolumeUnit: "usd",
      openInterest: null,
      openInterestUnit: "usd",
      liquidity: null,
      liquidityUnit: "usd",
      yesTokenId: "yes",
      noTokenId: "no",
    },
    siblings: [],
    rules: [],
    history: [],
    book: {
      yesBids: [],
      yesAsks: [],
      noBids: [],
      noAsks: [],
      lastTradePrice: null,
    },
    trades: [],
  };
}

function trade(index: number): PredictionTrade {
  return {
    id: `t-${index}`,
    timestamp: index,
    side: "buy",
    outcome: "yes",
    price: 0.4 + index / 100,
    size: 1,
  };
}

describe("prediction catalog quote apply", () => {
  test("patches yes odds and keeps the same object when nothing changed", () => {
    const current = detail().summary;
    const unchanged = applyPredictionSummaryQuote(current, {});
    expect(unchanged).toBe(current);
    const next = applyPredictionSummaryQuote(current, { yesPrice: 0.61, lastTradePrice: 0.61 });
    expect(next).not.toBe(current);
    expect(next.yesPrice).toBe(0.61);
    expect(next.noPrice).toBeCloseTo(0.39);
    expect(next.lastTradePrice).toBe(0.61);
  });

  test("book quotes do not move last-trade yes odds", () => {
    const current = detail().summary;
    const next = applyPredictionSummaryQuote(current, {
      yesBid: 0.54,
      yesAsk: 0.56,
      spread: 0.02,
    });
    expect(next.yesPrice).toBe(current.yesPrice);
    expect(next.lastTradePrice).toBe(current.lastTradePrice);
    expect(next.yesBid).toBe(0.54);
    expect(next.yesAsk).toBe(0.56);
  });
});

describe("prediction live updates", () => {
  test("batched trades prepend in order and keep 40", () => {
    const pending = createPendingPredictionLiveUpdates();
    for (let index = 0; index < 45; index += 1) {
      pending.trades.push({ assetId: "yes", trade: trade(index) });
    }

    const next = applyPendingPredictionLiveUpdates(detail(), pending);
    expect(next.trades).toHaveLength(40);
    expect(next.trades.map((item) => item.id)).toEqual(
      Array.from({ length: 40 }, (_, index) => `t-${44 - index}`),
    );
    expect(next.summary.lastTradePrice).toBe(trade(44).price);
  });
});
