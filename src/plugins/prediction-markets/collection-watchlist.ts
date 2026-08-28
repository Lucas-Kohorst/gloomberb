import type { Dispatch } from "react";
import type { AppAction } from "../../core/state/app/types";
import { stripByokKeysForSnapshot } from "../../data/config/hosted-config-snapshot";
import { writeHostedUserConfig } from "../../data/config/hosted-user-persist";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import { ADJACENT_WATCHLIST_ID, type AppConfig } from "../../types/config";
import type { TickerRecord } from "../../types/ticker";
import { addTickerToWatchlist, removeTickerFromWatchlist } from "../builtin/portfolio-list/mutations";
import { getSharedRegistry } from "../registry";
import { slimPredictionCatalogSummary } from "./cache";
import { extractPolymarketSlug } from "./services/polymarket/normalize";
import type { PredictionMarketSummary, PredictionVenue } from "./types";

export const DEFAULT_WATCHLIST_ID = "watchlist";

export function predictionCollectionSymbol(
  summary: Pick<PredictionMarketSummary, "venue" | "marketId" | "url">,
): string {
  if (summary.venue === "kalshi") return `KALSHI:${summary.marketId}`;
  const slug = extractPolymarketSlug(summary.url);
  return `POLY:${slug ?? summary.marketId}`;
}

export function resolveDefaultWatchlistId(config: Pick<AppConfig, "watchlists">): string | null {
  const named = config.watchlists.find((watchlist) => watchlist.id === DEFAULT_WATCHLIST_ID);
  if (named) return named.id;
  return config.watchlists.find((watchlist) => watchlist.id !== ADJACENT_WATCHLIST_ID)?.id ?? null;
}

export function ensureDefaultWatchlist(config: AppConfig): { config: AppConfig; watchlistId: string } {
  const existing = resolveDefaultWatchlistId(config);
  if (existing) return { config, watchlistId: existing };
  return {
    config: {
      ...config,
      watchlists: [...config.watchlists, { id: DEFAULT_WATCHLIST_ID, name: "Watchlist" }],
    },
    watchlistId: DEFAULT_WATCHLIST_ID,
  };
}

export function upsertPredictionWatchlistTicker(
  summary: PredictionMarketSummary,
  existing: TickerRecord | null,
  watchlistId: string,
  starred: boolean,
): TickerRecord {
  const symbol = predictionCollectionSymbol(summary);
  const ticker = existing ?? {
    metadata: {
      ticker: symbol,
      exchange: summary.venue === "kalshi" ? "KALSHI" : "POLYMARKET",
      currency: "USD",
      name: summary.title || symbol,
      assetCategory: summary.venue === "kalshi" ? "KALSHI" : "POLYMARKET",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {
        predictionMarketKey: summary.key,
        predictionVenue: summary.venue,
        predictionMarketId: summary.marketId,
      },
      tags: ["prediction"],
    },
  };
  return starred
    ? addTickerToWatchlist(ticker, watchlistId).ticker
    : removeTickerFromWatchlist(ticker, watchlistId).ticker;
}

export function applyPredictionStarMemberships(
  summaries: PredictionMarketSummary[],
  tickers: ReadonlyMap<string, TickerRecord>,
  watchlistId: string,
  starred: boolean,
): TickerRecord[] {
  return summaries.map((summary) => (
    upsertPredictionWatchlistTicker(
      summary,
      tickers.get(predictionCollectionSymbol(summary)) ?? null,
      watchlistId,
      starred,
    )
  ));
}

export async function persistPredictionStarsToDefaultWatchlist({
  summaries,
  starred,
  config,
  tickers,
  dispatch,
}: {
  summaries: PredictionMarketSummary[];
  starred: boolean;
  config: AppConfig;
  tickers: ReadonlyMap<string, TickerRecord>;
  dispatch: Dispatch<AppAction>;
}): Promise<TickerRecord[]> {
  const ensured = ensureDefaultWatchlist(config);
  if (ensured.config !== config) {
    dispatch({ type: "SET_CONFIG", config: ensured.config });
    scheduleConfigSave(ensured.config);
  }
  writeHostedUserConfig(stripByokKeysForSnapshot(ensured.config));

  const nextTickers = applyPredictionStarMemberships(
    summaries,
    tickers,
    ensured.watchlistId,
    starred,
  );
  const registry = getSharedRegistry();
  for (const ticker of nextTickers) {
    const created = !tickers.has(ticker.metadata.ticker);
    if (registry) {
      await registry.tickerRepository.saveTicker(ticker);
      if (created) {
        registry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      }
    }
    dispatch({ type: "UPDATE_TICKER", ticker });
  }
  return nextTickers;
}

export function applyWatchlistSnapshots(
  current: PredictionMarketSummary[],
  summaries: PredictionMarketSummary[],
  starred: boolean,
): PredictionMarketSummary[] {
  if (summaries.length === 0) return current;
  if (!starred) {
    const removed = new Set(summaries.map((summary) => summary.key));
    return current.filter((snapshot) => !removed.has(snapshot.key));
  }
  const next = [...current];
  const indexByKey = new Map(next.map((snapshot, index) => [snapshot.key, index]));
  for (const summary of summaries) {
    const slim = slimPredictionCatalogSummary(summary);
    const existingIndex = indexByKey.get(summary.key);
    if (existingIndex == null) {
      indexByKey.set(summary.key, next.length);
      next.push(slim);
      continue;
    }
    next[existingIndex] = slim;
  }
  return next;
}

function createStubSummary({
  key,
  venue,
  marketId,
  title,
}: {
  key: string;
  venue: PredictionVenue;
  marketId: string;
  title: string;
}): PredictionMarketSummary {
  return {
    key,
    venue,
    marketId,
    title,
    marketLabel: title,
    eventLabel: title,
    status: "open",
    url:
      venue === "kalshi"
        ? `https://kalshi.com/markets/${marketId}`
        : `https://polymarket.com/event/${marketId}`,
    description: "",
    endsAt: null,
    updatedAt: null,
    createdAt: null,
    yesPrice: null,
    noPrice: null,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    spread: null,
    lastTradePrice: null,
    volume24h: null,
    volume24hUnit: "usd",
    totalVolume: null,
    totalVolumeUnit: "usd",
    openInterest: null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
  };
}

export function stubSummaryFromWatchlistKey(key: string): PredictionMarketSummary | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const venue = key.slice(0, separator);
  const marketId = key.slice(separator + 1);
  if ((venue !== "kalshi" && venue !== "polymarket") || !marketId) return null;
  return createStubSummary({ key, venue, marketId, title: marketId });
}

export function stubSummaryFromTicker(ticker: TickerRecord): PredictionMarketSummary | null {
  const custom = ticker.metadata.custom;
  const customKey = typeof custom.predictionMarketKey === "string" ? custom.predictionMarketKey : "";
  const customMarketId = typeof custom.predictionMarketId === "string" ? custom.predictionMarketId : "";
  const fromKey = customKey ? stubSummaryFromWatchlistKey(customKey) : null;
  let venue: PredictionVenue | null =
    custom.predictionVenue === "kalshi" || custom.predictionVenue === "polymarket"
      ? custom.predictionVenue
      : (fromKey?.venue ?? null);
  let marketId = customMarketId || fromKey?.marketId || "";
  let key = customKey;

  if (!venue || !marketId) {
    const symbol = ticker.metadata.ticker;
    const separator = symbol.indexOf(":");
    if (separator > 0) {
      const prefix = symbol.slice(0, separator);
      const rest = symbol.slice(separator + 1);
      if (prefix === "KALSHI" && rest) {
        venue = venue ?? "kalshi";
        marketId = marketId || rest;
      } else if (prefix === "POLY" && rest) {
        venue = venue ?? "polymarket";
        marketId = marketId || rest;
      }
    }
  }

  if (!key && venue && marketId) key = `${venue}:${marketId}`;
  if (!venue || !key) return null;
  if (!marketId) {
    const parsed = stubSummaryFromWatchlistKey(key);
    if (!parsed) return null;
    venue = venue ?? parsed.venue;
    marketId = parsed.marketId;
  }

  const title = ticker.metadata.name.trim() || marketId;
  return createStubSummary({ key, venue, marketId, title });
}

export function hydrateWatchlistSnapshots(
  current: PredictionMarketSummary[],
  watchlistKeys: Iterable<string>,
  tickers: ReadonlyMap<string, TickerRecord>,
): PredictionMarketSummary[] {
  const present = new Set(current.map((snapshot) => snapshot.key));
  const missing: string[] = [];
  for (const key of watchlistKeys) {
    if (!present.has(key)) missing.push(key);
  }
  if (missing.length === 0) return current;

  const tickerByMarketKey = new Map<string, TickerRecord>();
  for (const ticker of tickers.values()) {
    const customKey = ticker.metadata.custom.predictionMarketKey;
    if (typeof customKey === "string" && customKey) {
      tickerByMarketKey.set(customKey, ticker);
    }
  }

  const next = [...current];
  for (const key of missing) {
    const ticker = tickerByMarketKey.get(key);
    const stub = (ticker ? stubSummaryFromTicker(ticker) : null) ?? stubSummaryFromWatchlistKey(key);
    if (stub) next.push(stub);
  }
  return next;
}

export function resolveWatchlistMarkets(
  liveCatalog: PredictionMarketSummary[],
  snapshots: PredictionMarketSummary[],
  watchlist: Set<string>,
): PredictionMarketSummary[] {
  if (watchlist.size === 0) return [];
  const liveByKey = new Map(liveCatalog.map((market) => [market.key, market]));
  const snapshotByKey = new Map(snapshots.map((market) => [market.key, market]));
  const resolved: PredictionMarketSummary[] = [];
  for (const key of watchlist) {
    const market = liveByKey.get(key) ?? snapshotByKey.get(key) ?? stubSummaryFromWatchlistKey(key);
    if (market) resolved.push(market);
  }
  return resolved;
}
