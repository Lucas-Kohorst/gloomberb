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

function installMemoryStorage(): void {
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
}

describe("HostedTickerRepository", () => {
  test("saves and reloads tickers from localStorage", async () => {
    installMemoryStorage();
    setHostedConfigUserId("user-1");

    const first = new HostedTickerRepository([]);
    await first.saveTicker(record("AAPL"));
    const second = new HostedTickerRepository();
    const loaded = await second.loadAllTickers();
    expect(loaded.map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
  });

  test("keeps in-memory tickers when storage is empty on reload", async () => {
    installMemoryStorage();
    setHostedConfigUserId(null);
    const repo = new HostedTickerRepository([]);
    await repo.saveTicker(record("NVDA"));
    await repo.saveTicker(record("TSLA"));
    setHostedConfigUserId("user-1");
    const loaded = await repo.loadAllTickers();
    expect(loaded.map((ticker) => ticker.metadata.ticker).sort()).toEqual(["NVDA", "TSLA"]);
    const next = new HostedTickerRepository();
    expect((await next.loadAllTickers()).map((ticker) => ticker.metadata.ticker).sort()).toEqual(["NVDA", "TSLA"]);
  });

  test("does not drop the rest of the book when saving one ticker", async () => {
    installMemoryStorage();
    setHostedConfigUserId("user-1");
    const repo = new HostedTickerRepository([record("AAPL"), record("MSFT")]);
    await repo.saveTicker(record("NVDA"));
    const loaded = await repo.loadAllTickers();
    expect(loaded.map((ticker) => ticker.metadata.ticker).sort()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });
});
