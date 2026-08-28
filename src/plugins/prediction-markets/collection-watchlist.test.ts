import { afterEach, describe, expect, test } from "bun:test";
import {
  hydrateHostedUserConfig,
  setHostedConfigUserId,
} from "../../data/config/hosted-user-persist";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../builtin/byok/types";
import { createDefaultConfig } from "../../types/config";
import type { TickerRecord } from "../../types/ticker";
import {
  applyPredictionStarMemberships,
  applyWatchlistSnapshots,
  ensureDefaultWatchlist,
  hydrateWatchlistSnapshots,
  persistPredictionStarsToDefaultWatchlist,
  predictionCollectionSymbol,
  resolveWatchlistMarkets,
} from "./collection-watchlist";
import { normalizeKalshiMarket } from "./services/kalshi/normalize";
import { normalizePolymarketMarket } from "./services/polymarket/normalize";

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

const kalshi = normalizeKalshiMarket({
  ticker: "KXPRESPERSON",
  title: "Will the Fed cut rates?",
  yes_sub_title: "Yes",
  event_ticker: "FED-1",
  status: "open",
  market_type: "binary",
  last_price_dollars: "0.48",
  volume_24h_fp: "15000",
} as any)!;

const polymarket = normalizePolymarketMarket({
  id: "pm-1",
  question: "Will inflation fall?",
  slug: "inflation-fall",
  conditionId: "cond-1",
  outcomes: '["Yes","No"]',
  outcomePrices: '["0.62","0.38"]',
  clobTokenIds: '["yes-1","no-1"]',
  events: [{ id: "event-1", title: "US inflation" }],
} as any)!;

describe("prediction market PF watchlist membership", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("maps Kalshi tickers and Polymarket slugs onto collection symbols", () => {
    expect(predictionCollectionSymbol(kalshi)).toBe("KALSHI:KXPRESPERSON");
    expect(predictionCollectionSymbol(polymarket)).toBe("POLY:inflation-fall");
  });

  test("stars and unstars into the default watchlist without inventing lots", () => {
    const config = createDefaultConfig("/tmp/gloomberb-pm-watchlist");
    const { watchlistId } = ensureDefaultWatchlist(config);
    expect(watchlistId).toBe("watchlist");

    const starred = applyPredictionStarMemberships([kalshi, polymarket], new Map(), watchlistId, true);
    expect(starred.map((ticker) => ticker.metadata.ticker)).toEqual([
      "KALSHI:KXPRESPERSON",
      "POLY:inflation-fall",
    ]);
    for (const ticker of starred) {
      expect(ticker.metadata.watchlists).toEqual(["watchlist"]);
      expect(ticker.metadata.positions).toEqual([]);
      expect(JSON.stringify(ticker)).not.toMatch(/sk-|api[_-]?key/i);
    }

    const tickers = new Map(starred.map((ticker) => [ticker.metadata.ticker, ticker]));
    const unstarred = applyPredictionStarMemberships([kalshi], tickers, watchlistId, false);
    expect(unstarred[0]?.metadata.watchlists).toEqual([]);
    expect(tickers.get("POLY:inflation-fall")?.metadata.watchlists).toEqual(["watchlist"]);
  });

  test("persists starred membership through hosted user config without keys", async () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("cloud://users/user-1");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: {
        [BYOK_API_KEYS_CONFIG_KEY]: {
          keys: [{
            id: "byok-1",
            serviceId: "adjacent",
            name: "Adjacent",
            apiKey: "sk-live-secret-123",
            createdAt: 1,
            lastValidationStatus: "untested",
          }],
        },
      },
    };
    const dispatched: Array<{ type: string; ticker?: TickerRecord }> = [];

    const tickers = await persistPredictionStarsToDefaultWatchlist({
      summaries: [kalshi],
      starred: true,
      config,
      tickers: new Map(),
      dispatch: (action) => {
        dispatched.push(action);
      },
    });

    expect(tickers[0]?.metadata.watchlists).toEqual(["watchlist"]);
    expect(dispatched.some((action) => action.type === "UPDATE_TICKER")).toBe(true);

    const stored = globalThis.localStorage.getItem("gloomberb:hosted-user-config:user-1") ?? "";
    expect(stored).toContain("watchlist");
    expect(stored).not.toContain("sk-live-secret-123");

    const hydrated = createDefaultConfig("cloud://users/user-1");
    hydrateHostedUserConfig(hydrated);
    expect(hydrated.watchlists.some((watchlist) => watchlist.id === "watchlist")).toBe(true);
  });

  test("keeps a starred market that is missing from the live catalog", () => {
    const snapshots = applyWatchlistSnapshots([], [kalshi, polymarket], true);
    const liveCatalog = [polymarket];
    const watchlist = new Set([kalshi.key, polymarket.key]);

    const resolved = resolveWatchlistMarkets(liveCatalog, snapshots, watchlist);
    expect(resolved.map((market) => market.key).sort()).toEqual([
      kalshi.key,
      polymarket.key,
    ].sort());
    expect(resolved.find((market) => market.key === kalshi.key)?.title).toBe(kalshi.title);
  });

  test("prefers live catalog quotes over the starred snapshot", () => {
    const stale = { ...kalshi, yesPrice: 0.11, title: "Stale Fed cut" };
    const live = { ...kalshi, yesPrice: 0.72, title: "Live Fed cut" };
    const resolved = resolveWatchlistMarkets(
      [live],
      applyWatchlistSnapshots([], [stale], true),
      new Set([kalshi.key]),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.yesPrice).toBe(0.72);
    expect(resolved[0]?.title).toBe("Live Fed cut");
  });

  test("resolves a starred market with no snapshot and no live catalog entry via a key stub", () => {
    const key = "kalshi:KXPRESPERSON";
    const resolved = resolveWatchlistMarkets([], [], new Set([key]));
    expect(resolved.map((market) => market.key)).toEqual([key]);
    expect(resolved[0]?.marketId).toBe("KXPRESPERSON");
    expect(resolved[0]?.title).toBe("KXPRESPERSON");
  });

  test("hydrates missing watchlist snapshots from ticker custom metadata", () => {
    const key = "kalshi:KXPRESPERSON";
    const ticker: TickerRecord = {
      metadata: {
        ticker: "KALSHI:KXPRESPERSON",
        exchange: "KALSHI",
        currency: "USD",
        name: "Will the Fed cut rates?",
        assetCategory: "KALSHI",
        portfolios: [],
        watchlists: ["watchlist"],
        positions: [],
        custom: {
          predictionMarketKey: key,
          predictionVenue: "kalshi",
          predictionMarketId: "KXPRESPERSON",
        },
        tags: ["prediction"],
      },
    };
    const tickers = new Map([[ticker.metadata.ticker, ticker]]);
    const hydrated = hydrateWatchlistSnapshots([], [key], tickers);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.key).toBe(key);
    expect(hydrated[0]?.title).toBe("Will the Fed cut rates?");

    const unchanged = hydrateWatchlistSnapshots(hydrated, [key], tickers);
    expect(unchanged).toBe(hydrated);
  });
});
