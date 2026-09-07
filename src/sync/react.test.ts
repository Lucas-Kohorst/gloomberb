import { afterEach, describe, expect, test } from "bun:test";
import type { AppAction, AppState } from "../core/state/app/state";
import { readHostedNotes, writeHostedNotes } from "../data/config/hosted-notes-persist";
import { readHostedTickers, writeHostedTickers } from "../data/config/hosted-ticker-persist";
import {
  hydrateHostedUserConfig,
  rememberHostedUserId,
  setHostedConfigUserId,
  writeHostedUserConfig,
} from "../data/config/hosted-user-persist";
import { createDefaultConfig } from "../types/config";
import { applyHostedCloudOverlay } from "./react";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } satisfies Storage,
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function tickerMetadata(symbol: string) {
  return {
    ticker: symbol,
    exchange: "NASDAQ",
    currency: "USD",
    name: symbol,
    portfolios: [],
    watchlists: [],
    positions: [],
    custom: {},
    tags: [],
  };
}

describe("hosted cloud overlay acceptance", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    rememberHostedUserId(null);
    globalThis.localStorage.clear();
  });

  test("rejects a delayed completion after a rapid A to B to A account switch", async () => {
    setHostedConfigUserId("user-a");
    const config = createDefaultConfig("cloud://users/user-a");
    writeHostedUserConfig(config, "user-a");
    const gate = deferred();
    const actions: AppAction[] = [];
    let savedTickers = 0;

    const applying = applyHostedCloudOverlay({
      capturedConfig: config,
      getState: () => ({ config } as AppState),
      dispatch: (action) => { actions.push(action); },
      tickerRepository: {
        loadAllTickers: async () => [],
        loadTicker: async () => null,
        saveTicker: async () => { savedTickers += 1; },
        createTicker: async (metadata) => ({ metadata }),
        deleteTicker: async () => {},
      },
      pullConfig: async () => ({
        config: { theme: "amber" },
        updatedAt: "2099-01-01T00:00:00.000Z",
        tickers: [{ ticker: "STALE" }],
        notes: { tickerNotes: { STALE: "old account" } },
      }),
      pullSync: async () => ({ snapshot: null }),
      beforeApply: gate.promise,
    });

    await Promise.resolve();
    setHostedConfigUserId("user-b");
    setHostedConfigUserId("user-a");
    gate.resolve();

    expect(await applying).toBe(false);
    expect(actions).toEqual([]);
    expect(savedTickers).toBe(0);
    expect(readHostedTickers("user-a")).toEqual([]);
    expect(readHostedNotes("user-a").tickerNotes).toEqual({});
  });

  test("rejects a delayed completion when local config was saved during the pull", async () => {
    setHostedConfigUserId("user-a");
    const config = createDefaultConfig("cloud://users/user-a");
    config.baseCurrency = "EUR";
    writeHostedUserConfig(config, "user-a");
    const gate = deferred();
    const actions: AppAction[] = [];

    const applying = applyHostedCloudOverlay({
      capturedConfig: config,
      getState: () => ({ config } as AppState),
      dispatch: (action) => { actions.push(action); },
      tickerRepository: {
        loadAllTickers: async () => [],
        loadTicker: async () => null,
        saveTicker: async () => {},
        createTicker: async (metadata) => ({ metadata }),
        deleteTicker: async () => {},
      },
      pullConfig: async () => ({
        config: { baseCurrency: "JPY" },
        updatedAt: "2099-01-01T00:00:00.000Z",
      }),
      pullSync: async () => ({ snapshot: null }),
      beforeApply: gate.promise,
    });

    await Promise.resolve();
    const newer = { ...config, baseCurrency: "GBP" };
    writeHostedUserConfig(newer, "user-a");
    gate.resolve();

    expect(await applying).toBe(false);
    expect(actions).toEqual([]);
    const restored = createDefaultConfig("cloud://users/user-a");
    hydrateHostedUserConfig(restored, "user-a");
    expect(restored.baseCurrency).toBe("GBP");
  });

  test("preserves ticker and note edits made while a remote workspace is loading", async () => {
    setHostedConfigUserId("user-a");
    const config = createDefaultConfig("cloud://users/user-a");
    writeHostedUserConfig(config, "user-a");
    const gate = deferred();

    const applying = applyHostedCloudOverlay({
      capturedConfig: config,
      getState: () => ({ config } as AppState),
      dispatch: () => {},
      tickerRepository: {
        loadAllTickers: async () => [],
        loadTicker: async () => null,
        saveTicker: async () => {},
        createTicker: async (metadata) => ({ metadata }),
        deleteTicker: async () => {},
      },
      pullConfig: async () => ({
        config: null,
        updatedAt: null,
        tickers: [{ ticker: "REMOTE" }],
        notes: { tickerNotes: { REMOTE: "remote" } },
      }),
      pullSync: async () => ({ snapshot: null }),
      beforeApply: gate.promise,
    });

    await Promise.resolve();
    writeHostedTickers([
      {
        metadata: {
          ...tickerMetadata("LOCAL"),
          sector: "",
          industry: "",
          assetCategory: "equity",
          isin: "",
          cusip: "",
          broker_contracts: [],
        },
      },
    ], "user-a");
    writeHostedNotes({
      quickNotesIndex: [],
      quickNotes: {},
      tickerNotes: { LOCAL: "local" },
    }, "user-a");
    gate.resolve();

    expect(await applying).toBe(false);
    expect(readHostedTickers("user-a").map((ticker) => ticker.metadata.ticker)).toEqual(["LOCAL"]);
    expect(readHostedNotes("user-a").tickerNotes).toEqual({ LOCAL: "local" });
  });
});
