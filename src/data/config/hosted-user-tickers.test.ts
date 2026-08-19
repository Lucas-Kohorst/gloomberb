import { afterEach, describe, expect, test } from "bun:test";
import { setHostedConfigUserId } from "./hosted-user-persist";
import {
  adoptGuestHostedTickers,
  deleteHostedUserTicker,
  hydrateHostedUserTickersFromSnapshot,
  mergeRemoteTickerSnapshot,
  peekHostedUserTickerStamp,
  readHostedUserTickers,
  upsertHostedUserTicker,
  writeHostedUserTickers,
} from "./hosted-user-tickers";
import type { TickerRecord } from "../../types/ticker";

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

function ticker(symbol: string, portfolios: string[] = ["main"]): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios,
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

describe("hosted user ticker persist", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("writes and reads portfolio memberships for the signed-in user", () => {
    setHostedConfigUserId("user-1");
    writeHostedUserTickers([ticker("AAPL"), ticker("MSFT")]);

    expect(peekHostedUserTickerStamp()?.userId).toBe("user-1");
    expect(readHostedUserTickers().map((entry) => entry.metadata.ticker)).toEqual(["AAPL", "MSFT"]);
    expect(readHostedUserTickers()[0]?.metadata.portfolios).toEqual(["main"]);
  });

  test("does not leak one user's tickers into another account", () => {
    setHostedConfigUserId("user-1");
    writeHostedUserTickers([ticker("AAPL")]);

    setHostedConfigUserId("user-2");
    expect(readHostedUserTickers()).toEqual([]);
    expect(peekHostedUserTickerStamp()).toBeNull();
  });

  test("upserts and deletes a single ticker without dropping the rest", () => {
    setHostedConfigUserId("user-1");
    writeHostedUserTickers([ticker("AAPL"), ticker("MSFT")]);
    upsertHostedUserTicker(ticker("AAPL", ["main", "ira"]));
    expect(readHostedUserTickers().find((entry) => entry.metadata.ticker === "AAPL")?.metadata.portfolios)
      .toEqual(["main", "ira"]);
    expect(readHostedUserTickers().map((entry) => entry.metadata.ticker).sort()).toEqual(["AAPL", "MSFT"]);

    deleteHostedUserTicker("msft");
    expect(readHostedUserTickers().map((entry) => entry.metadata.ticker)).toEqual(["AAPL"]);
  });

  test("keeps a newer local save instead of a stale snapshot", () => {
    setHostedConfigUserId("user-1");
    writeHostedUserTickers([ticker("AAPL")]);
    const localStamp = peekHostedUserTickerStamp();
    const merged = mergeRemoteTickerSnapshot(
      [ticker("MSFT").metadata],
      "2020-01-01T00:00:00.000Z",
      localStamp?.updatedAt ?? null,
    );
    expect(merged).toBeNull();
  });

  test("applies a newer remote snapshot when local is absent", () => {
    setHostedConfigUserId("user-1");
    const applied = hydrateHostedUserTickersFromSnapshot(
      [ticker("NVDA").metadata],
      "2026-08-17T12:00:00.000Z",
    );
    expect(applied?.map((entry) => entry.metadata.ticker)).toEqual(["NVDA"]);
    expect(readHostedUserTickers().map((entry) => entry.metadata.ticker)).toEqual(["NVDA"]);
  });

  test("adopts guest tickers onto an empty signed-in account", () => {
    writeHostedUserTickers([ticker("AAPL")], "guest");
    setHostedConfigUserId("user-1");
    adoptGuestHostedTickers("user-1");
    expect(readHostedUserTickers().map((entry) => entry.metadata.ticker)).toEqual(["AAPL"]);
  });
});
