import type { Dispatch } from "react";
import type { AppAction } from "../../../state/app/context";
import type { AppConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import { addTickerToWatchlist } from "./mutations";

export type WatchlistAssetKind = "equity" | "adjacent-index" | "adjacent-market";

export function adjacentIndexTickerRecord(
  index: { index_id: string; ticker?: string; name: string },
  existing?: TickerRecord | null,
): TickerRecord {
  const symbol = (index.ticker?.trim() || index.index_id).toUpperCase();
  const custom = {
    ...(existing?.metadata.custom ?? {}),
    adjacentIndexId: index.index_id,
  };
  if (existing) {
    return { ...existing, metadata: { ...existing.metadata, name: index.name || existing.metadata.name, custom } };
  }
  return {
    metadata: {
      ticker: symbol,
      exchange: "ADJACENT",
      currency: "USD",
      name: index.name || symbol,
      assetCategory: "ADJACENT_INDEX",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom,
      tags: ["adjacent", "index"],
    },
  };
}

export function adjacentMarketTickerRecord(
  market: { id: string; ticker?: string; title: string; platform?: string },
  existing?: TickerRecord | null,
): TickerRecord {
  const symbol = (market.ticker?.trim() || market.id).toUpperCase();
  const custom = {
    ...(existing?.metadata.custom ?? {}),
    adjacentMarketId: market.id,
    adjacentPlatform: market.platform ?? "",
  };
  if (existing) {
    return {
      ...existing,
      metadata: {
        ...existing.metadata,
        name: market.title || existing.metadata.name,
        custom,
      },
    };
  }
  return {
    metadata: {
      ticker: symbol,
      exchange: "ADJACENT",
      currency: "USD",
      name: market.title || symbol,
      assetCategory: "ADJACENT_MARKET",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom,
      tags: ["adjacent", "market"],
    },
  };
}

export async function persistWatchlistMembership(options: {
  ticker: TickerRecord;
  watchlistId: string;
  tickerRepository: { saveTicker(ticker: TickerRecord): Promise<void> };
  dispatch: (action: { type: "UPDATE_TICKER"; ticker: TickerRecord }) => void;
}): Promise<{ changed: boolean; ticker: TickerRecord }> {
  const result = addTickerToWatchlist(options.ticker, options.watchlistId);
  if (!result.changed) return result;
  await options.tickerRepository.saveTicker(result.ticker);
  options.dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
  return result;
}

export function dispatchEnsuredWatchlistConfig(
  config: AppConfig,
  nextConfig: AppConfig,
  dispatch: Dispatch<AppAction>,
  scheduleConfigSave: (config: AppConfig) => void,
): void {
  if (nextConfig === config) return;
  dispatch({ type: "SET_CONFIG", config: nextConfig });
  scheduleConfigSave(nextConfig);
}
