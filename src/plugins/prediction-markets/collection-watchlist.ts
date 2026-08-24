import type { Dispatch } from "react";
import type { AppAction } from "../../core/state/app/types";
import { stripByokKeysForSnapshot } from "../../data/config/hosted-config-snapshot";
import { writeHostedUserConfig } from "../../data/config/hosted-user-persist";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import { ADJACENT_WATCHLIST_ID, type AppConfig } from "../../types/config";
import type { TickerRecord } from "../../types/ticker";
import { addTickerToWatchlist, removeTickerFromWatchlist } from "../builtin/portfolio-list/mutations";
import { getSharedRegistry } from "../registry";
import { extractPolymarketSlug } from "./services/polymarket/normalize";
import type { PredictionMarketSummary } from "./types";

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
