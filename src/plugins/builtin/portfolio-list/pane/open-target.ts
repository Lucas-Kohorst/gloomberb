import type { TickerRecord } from "../../../../types/ticker";

export type WatchlistRowOpen =
  | { templateId: "adjacent-indices-pane"; arg: string }
  | { templateId: "adjacent-markets-pane"; arg: string }
  | { templateId: null; symbol: string };

export function resolveWatchlistRowOpen(ticker: TickerRecord): WatchlistRowOpen {
  if (ticker.metadata.assetCategory === "ADJACENT_INDEX") {
    return { templateId: "adjacent-indices-pane", arg: ticker.metadata.ticker };
  }
  if (ticker.metadata.assetCategory === "ADJACENT_MARKET") {
    return { templateId: "adjacent-markets-pane", arg: ticker.metadata.name || ticker.metadata.ticker };
  }
  return { templateId: null, symbol: ticker.metadata.ticker };
}
