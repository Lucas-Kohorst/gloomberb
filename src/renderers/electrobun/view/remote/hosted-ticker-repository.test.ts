import { describe, expect, test } from "bun:test";
import { HostedTickerRepository } from "./hosted-ticker-repository";
import type { TickerRecord } from "../../../../types/ticker";
import { setHostedConfigUserId } from "../../../../data/config/hosted-user-persist";

function record(symbol: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      sector: "",
      industry: "",
      assetCategory: "equity",
      isin: "",
      cusip: "",
      portfolios: [],
      watchlists: ["watchlist"],
      positions: [],
      custom: {},
      tags: [],
      broker_contracts: [],
    },
  };
}

describe("HostedTickerRepository", () => {
  test("saves and reloads tickers from localStorage", async () => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    setHostedConfigUserId("user-1");

    const first = new HostedTickerRepository([]);
    await first.saveTicker(record("AAPL"));
    const second = new HostedTickerRepository();
    const loaded = await second.loadAllTickers();
    expect(loaded.map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
  });
});
