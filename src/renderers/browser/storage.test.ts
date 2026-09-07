import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import { getHostedConfigSnapshotPusher } from "../../data/config/hosted-config-snapshot";
import {
  rememberHostedUserId,
  setHostedConfigUserId,
  writeHostedUserConfig,
} from "../../data/config/hosted-user-persist";
import { createDefaultConfig } from "../../types/config";
import { createBrowserConfigStore, BROWSER_DATA_DIR } from "./config-host";
import { BrowserPersistence } from "./persistence";
import {
  BROWSER_STORAGE_KEYS,
  initializeBrowserPersistenceIdentity,
  type StorageLike,
} from "./storage";
import { BrowserTickerRepository } from "./ticker-repository";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("Storage full", "QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function installMemoryStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

const session: AppSessionSnapshot = {
  paneState: { "portfolio-list:main": { cursorSymbol: "AAPL" } },
  focusedPaneId: "portfolio-list:main",
  activePanel: "left",
  statusBarVisible: true,
  openPaneIds: ["portfolio-list:main"],
  hydrationTargets: [],
  exchangeCurrencies: ["USD"],
  savedAt: 1,
};

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

describe("browser local persistence", () => {
  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  afterEach(() => {
    getHostedConfigSnapshotPusher().cancel();
    setHostedConfigUserId(null);
    rememberHostedUserId(null);
    globalThis.localStorage?.clear();
  });

  test("saves, reloads, and switches complete browser workspaces by account", async () => {
    const storage = installMemoryStorage();
    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    const configStore = createBrowserConfigStore();
    const firstConfig = await configStore.loadConfig(BROWSER_DATA_DIR);
    firstConfig.baseCurrency = "EUR";
    await configStore.saveConfig(firstConfig);

    const tickers = new BrowserTickerRepository();
    await tickers.createTicker(tickerMetadata("AAPL"));
    const persistence = new BrowserPersistence();
    persistence.pluginState.set("alerts", "draft", { enabled: true }, 2);
    persistence.sessions.set("app", session, 1);

    initializeBrowserPersistenceIdentity(storage, "user-2", BROWSER_DATA_DIR);
    expect((await configStore.loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("USD");
    expect(await tickers.loadAllTickers()).toEqual([]);
    expect(persistence.pluginState.get("alerts", "draft", 2)).toBeNull();
    expect(persistence.sessions.get("app", 1)).toBeNull();

    const secondConfig = await configStore.loadConfig(BROWSER_DATA_DIR);
    secondConfig.baseCurrency = "GBP";
    await configStore.saveConfig(secondConfig);
    await tickers.createTicker(tickerMetadata("MSFT"));

    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("EUR");
    expect((await new BrowserTickerRepository().loadAllTickers()).map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
    expect(new BrowserPersistence().pluginState.get("alerts", "draft", 2)?.value).toEqual({ enabled: true });
    expect(new BrowserPersistence().sessions.get("app", 1)?.value).toEqual(session);
  });

  test("migrates legacy globals only for their remembered owner and never over newer scoped config", async () => {
    const storage = installMemoryStorage();
    const legacy = createDefaultConfig(BROWSER_DATA_DIR);
    legacy.baseCurrency = "EUR";
    storage.setItem(BROWSER_STORAGE_KEYS.config, JSON.stringify(legacy));
    rememberHostedUserId("user-1");

    initializeBrowserPersistenceIdentity(storage, "user-2", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("USD");
    expect(storage.getItem(BROWSER_STORAGE_KEYS.config)).toBeNull();
    initializeBrowserPersistenceIdentity(storage, "user-2", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("USD");

    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("EUR");

    const scoped = createDefaultConfig(BROWSER_DATA_DIR);
    scoped.baseCurrency = "GBP";
    writeHostedUserConfig(scoped, "user-1");
    legacy.baseCurrency = "JPY";
    storage.setItem(BROWSER_STORAGE_KEYS.config, JSON.stringify(legacy));
    rememberHostedUserId("user-1");
    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("GBP");
    expect(storage.getItem(BROWSER_STORAGE_KEYS.config)).toBeNull();
  });

  test("does not adopt ownerless legacy globals on a later boot", async () => {
    const storage = installMemoryStorage();
    const legacy = createDefaultConfig(BROWSER_DATA_DIR);
    legacy.baseCurrency = "EUR";
    storage.setItem(BROWSER_STORAGE_KEYS.config, JSON.stringify(legacy));

    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);

    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("USD");
    expect(storage.getItem(BROWSER_STORAGE_KEYS.config)).toBe(JSON.stringify(legacy));
  });

  test("explicit sign-out cannot read or overwrite the previous account", async () => {
    const storage = installMemoryStorage();
    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    const configStore = createBrowserConfigStore();
    const signedIn = await configStore.loadConfig(BROWSER_DATA_DIR);
    signedIn.baseCurrency = "EUR";
    await configStore.saveConfig(signedIn);

    initializeBrowserPersistenceIdentity(storage, null, BROWSER_DATA_DIR);
    const signedOut = await configStore.loadConfig(BROWSER_DATA_DIR);
    expect(signedOut.baseCurrency).toBe("USD");
    signedOut.baseCurrency = "JPY";
    await configStore.saveConfig(signedOut);

    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    expect((await configStore.loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("EUR");
  });

  test("retains legacy data and its owner when storage writes fail during migration", async () => {
    const storage = installMemoryStorage();
    const legacy = createDefaultConfig(BROWSER_DATA_DIR);
    legacy.baseCurrency = "EUR";
    storage.setItem(BROWSER_STORAGE_KEYS.config, JSON.stringify(legacy));
    rememberHostedUserId("user-1");
    storage.failWrites = true;
    initializeBrowserPersistenceIdentity(storage, "user-2", BROWSER_DATA_DIR);
    expect(storage.getItem(BROWSER_STORAGE_KEYS.config)).toBe(JSON.stringify(legacy));
    storage.failWrites = false;
    initializeBrowserPersistenceIdentity(storage, "user-2", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("USD");
    initializeBrowserPersistenceIdentity(storage, "user-1", BROWSER_DATA_DIR);
    expect((await createBrowserConfigStore().loadConfig(BROWSER_DATA_DIR)).baseCurrency).toBe("EUR");
  });
});
