import { describe, expect, test } from "bun:test";
import type { TickerMetadata, TickerRecord } from "../../../types/ticker";
import {
  STARTER_SYMBOLS,
  isNewAccount,
  needsCompanyPicks,
  planCompanyPicks,
} from "./company-picker";

const SEEDED = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "BRK.B", "JPM", "V", "BTC-USD", "ETH-USD"];

function ticker(symbol: string, patch: Partial<TickerMetadata> = {}): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      name: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      portfolios: [],
      watchlists: ["watchlist"],
      positions: [],
      custom: {},
      tags: [],
      ...patch,
    },
  };
}

describe("company picks", () => {
  test("a brand-new seeded watchlist still needs companies", () => {
    expect([...STARTER_SYMBOLS]).toEqual(SEEDED);
    expect(needsCompanyPicks(SEEDED.map((symbol) => ticker(symbol)), "watchlist")).toBe(true);
    expect(needsCompanyPicks([], "watchlist")).toBe(true);
    expect(isNewAccount({ createdAt: new Date().toISOString() })).toBe(true);
    expect(isNewAccount({ createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() })).toBe(false);
    expect(isNewAccount(null)).toBe(false);
  });

  test("a portfolio holding or a short custom list does not ask again", () => {
    expect(needsCompanyPicks([
      ticker("NVDA"),
      ticker("AAPL"),
      ticker("ZZZ"),
    ], "watchlist")).toBe(false);
    expect(needsCompanyPicks(SEEDED.map((symbol) => (
      symbol === "AAPL" ? ticker(symbol, { portfolios: ["main"] }) : ticker(symbol)
    )), "watchlist")).toBe(false);
  });

  test("plans creates for new picks and drops seeded names that were not picked", () => {
    const tickers = new Map(SEEDED.map((symbol) => [symbol, ticker(symbol)] as const));
    const plan = planCompanyPicks(tickers, "watchlist", [
      { symbol: "NVDA", name: "NVIDIA", seed: { ticker: "NVDA", name: "NVIDIA", exchange: "NASDAQ", currency: "USD", assetCategory: "STK" } },
      { symbol: "AMD", name: "AMD", seed: { ticker: "AMD", name: "AMD", exchange: "NASDAQ", currency: "USD", assetCategory: "STK" } },
    ]);
    expect(plan.create.map((entry) => entry.ticker)).toEqual(["AMD"]);
    expect(plan.create[0]?.watchlists).toEqual(["watchlist"]);
    expect(plan.update.find((entry) => entry.metadata.ticker === "NVDA")).toBeUndefined();
    expect(plan.update.find((entry) => entry.metadata.ticker === "AAPL")?.metadata.watchlists).toEqual([]);
    expect(plan.update.find((entry) => entry.metadata.ticker === "BTC-USD")?.metadata.watchlists).toEqual([]);
  });
});
