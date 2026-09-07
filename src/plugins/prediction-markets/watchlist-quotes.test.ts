import { afterAll, describe, expect, it, mock } from "bun:test";
import type { PredictionMarketSummary } from "./types";

const realDetail = { ...((await import("./services/polymarket/detail")) as Record<string, unknown>) };

afterAll(() => {
  mock.module("./services/polymarket/detail", () => realDetail);
});

const resolvedSummary = {
  key: "second",
  venue: "polymarket",
  marketId: "second",
  title: "Second market",
  yesTokenId: "yes-second",
} as PredictionMarketSummary;

mock.module("./services/polymarket/detail", () => ({
  ...realDetail,
  resolvePolymarketMarketById: (marketId: string) => {
    if (marketId === "slow") return new Promise<PredictionMarketSummary>(() => {});
    if (marketId === "throws") return Promise.reject(new Error("upstream failure"));
    return Promise.resolve(resolvedSummary);
  },
}));

const { resolvePolymarketSummaries } = await import("./watchlist-quotes");

describe("resolvePolymarketSummaries", () => {
  it("gives later markets an independent timeout after an earlier market hangs", async () => {
    const result = await resolvePolymarketSummaries([
      {
        symbol: "POLY:slow",
        exchange: "POLYMARKET",
        marketKey: "custom:slow",
        venue: "polymarket",
        marketId: "slow",
      },
      {
        symbol: "POLY:second",
        exchange: "POLYMARKET",
        marketKey: "custom:second",
        venue: "polymarket",
        marketId: "second",
      },
    ], 20);

    expect(result.get("custom:slow")).toBeUndefined();
    expect(result.get("custom:second")).toBe(resolvedSummary);
    expect(result.get("polymarket:second")).toBe(resolvedSummary);
  });

  it("skips a failed fetch without aborting the remaining markets", async () => {
    const result = await resolvePolymarketSummaries([
      {
        symbol: "POLY:throws",
        exchange: "POLYMARKET",
        marketKey: "custom:throws",
        venue: "polymarket",
        marketId: "throws",
      },
      {
        symbol: "POLY:second",
        exchange: "POLYMARKET",
        marketKey: "custom:second",
        venue: "polymarket",
        marketId: "second",
      },
    ], 20);

    expect(result.has("custom:throws")).toBe(false);
    expect(result.get("custom:second")).toBe(resolvedSummary);
  });
});
