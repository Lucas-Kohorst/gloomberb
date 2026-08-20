import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { hydrateHostedWorkspaceFromCloud } from "./hosted-sync-hydrate";
import { readHostedTickers } from "./hosted-ticker-persist";
import { setHostedConfigUserId, writeHostedUserConfig } from "./hosted-user-persist";
import type { SyncSnapshot } from "../../sync/types";

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

function snapshot(payload: unknown, collections?: unknown): SyncSnapshot {
  return {
    schemaVersion: 1,
    appId: "gloomberb",
    clientId: "client",
    createdAt: "2026-01-01T00:00:00.000Z",
    contributors: {
      "core.config": {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        payload,
      },
      ...(collections
        ? {
          "core.collections": {
            schemaVersion: 1,
            updatedAt: "2026-01-01T00:00:00.000Z",
            payload: collections,
          },
        }
        : {}),
    },
  };
}

describe("hosted workspace hydrate", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("overlays layouts and tickers from the cloud snapshot onto the boot default", async () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("cloud://users/user-1");
    const remoteConfig = createDefaultConfig("cloud://users/user-1");
    remoteConfig.layouts[0] = { ...remoteConfig.layouts[0]!, name: "Trading" };
    remoteConfig.activeLayoutIndex = 0;

    const result = await hydrateHostedWorkspaceFromCloud(config, {
      pullConfig: async () => ({ config: null, updatedAt: null }),
      pullSync: async () => ({
        snapshot: snapshot(
          {
            layouts: remoteConfig.layouts,
            layout: remoteConfig.layouts[0]!.layout,
            activeLayoutIndex: 0,
          },
          {
            portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
            tickers: [{ ticker: "AAPL", portfolios: ["main"] }],
          },
        ),
      }),
    });

    expect(result.config.layouts[0]?.name).toBe("Trading");
    expect(result.tickers.map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
    expect(readHostedTickers().map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
  });

  test("leaves a second account empty when the snapshot has no book", async () => {
    setHostedConfigUserId("user-1");
    writeHostedUserConfig(createDefaultConfig("cloud://users/user-1"));

    setHostedConfigUserId("user-2");
    const config = createDefaultConfig("cloud://users/user-2");
    const result = await hydrateHostedWorkspaceFromCloud(config, {
      pullConfig: async () => ({ config: null, updatedAt: null }),
      pullSync: async () => ({ snapshot: snapshot({ theme: "amber" }, { tickers: [] }) }),
    });

    expect(result.tickers).toEqual([]);
    expect(readHostedTickers()).toEqual([]);
  });

  test("merges Worker snapshot tickers even when Gloom Cloud collections are empty", async () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("cloud://users/user-1");
    const result = await hydrateHostedWorkspaceFromCloud(config, {
      pullConfig: async () => ({
        config: { theme: "amber" } as Record<string, unknown>,
        updatedAt: "2026-08-20T00:00:00.000Z",
        tickers: [{ ticker: "ETH-USD", portfolios: ["main"] }],
      }),
      pullSync: async () => ({ snapshot: snapshot({ theme: "amber" }, { tickers: [] }) }),
    });
    expect(result.tickers.map((ticker) => ticker.metadata.ticker)).toEqual(["ETH-USD"]);
    expect(readHostedTickers().map((ticker) => ticker.metadata.ticker)).toEqual(["ETH-USD"]);
  });
});
