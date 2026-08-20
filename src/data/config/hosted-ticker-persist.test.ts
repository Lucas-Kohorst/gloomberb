import { afterEach, describe, expect, test } from "bun:test";
import type { TickerRecord } from "../../types/ticker";
import {
  mergeHostedTickers,
  parseIncomingTickerRecords,
  readHostedTickers,
  writeHostedTickers,
} from "./hosted-ticker-persist";
import {
  rememberHostedUserId,
  setHostedConfigUserId,
} from "./hosted-user-persist";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
}

function record(symbol: string, portfolios = ["main"]): TickerRecord {
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
      portfolios,
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      broker_contracts: [],
    },
  };
}

describe("hosted ticker persist", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    rememberHostedUserId(null);
    globalThis.localStorage?.clear();
  });

  test("keeps ticker books isolated per Gloom Cloud account", () => {
    setHostedConfigUserId("user-1");
    writeHostedTickers([record("AAPL")]);

    setHostedConfigUserId("user-2");
    expect(readHostedTickers()).toEqual([]);

    setHostedConfigUserId("user-1");
    expect(readHostedTickers().map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
  });

  test("does not copy a legacy unscoped book onto a different account", () => {
    rememberHostedUserId("user-1");
    globalThis.localStorage.setItem("gloomberb:hosted-tickers", JSON.stringify([record("MSFT")]));

    setHostedConfigUserId("user-2");
    expect(readHostedTickers()).toEqual([]);
    expect(globalThis.localStorage.getItem("gloomberb:hosted-tickers")).not.toBeNull();
  });

  test("migrates a legacy unscoped book only for the last signed-in user", () => {
    rememberHostedUserId("user-1");
    globalThis.localStorage.setItem("gloomberb:hosted-tickers", JSON.stringify([record("NVDA")]));

    setHostedConfigUserId("user-1");
    expect(readHostedTickers().map((ticker) => ticker.metadata.ticker)).toEqual(["NVDA"]);
    expect(globalThis.localStorage.getItem("gloomberb:hosted-tickers")).toBeNull();
  });

  test("hydrates nested snapshot ticker records the UI would otherwise ignore", () => {
    const parsed = parseIncomingTickerRecords({
      tickers: [
        { metadata: { ticker: "AAPL", portfolios: ["trading"] } },
        { symbol: "MSFT", watchlists: ["watchlist"] },
      ],
    });
    expect(parsed.map((ticker) => ticker.metadata.ticker).sort()).toEqual(["AAPL", "MSFT"]);
    expect(parsed[0]?.metadata.portfolios).toEqual(["trading"]);
  });

  test("merges snapshot tickers into the signed-in user's book", () => {
    setHostedConfigUserId("user-1");
    writeHostedTickers([record("AAPL")]);
    mergeHostedTickers([record("MSFT")]);
    expect(readHostedTickers().map((ticker) => ticker.metadata.ticker).sort()).toEqual(["AAPL", "MSFT"]);
  });
});
