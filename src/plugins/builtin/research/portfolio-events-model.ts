import type { AppConfig } from "../../../types/config";
import type { CorporateActionsData } from "../../../types/financials";
import { buildEventRows, type EventRow } from "./corporate-actions-pane";

export type PortfolioEventRow = EventRow & { symbol: string; name?: string };

type CollectionConfig = Pick<AppConfig, "portfolios" | "watchlists">;

function isKnownCollectionId(config: CollectionConfig, collectionId: string | null): boolean {
  if (!collectionId) return false;
  return config.portfolios.some((portfolio) => portfolio.id === collectionId)
    || config.watchlists.some((watchlist) => watchlist.id === collectionId);
}

/**
 * The pane is not a `portfolio-list` pane, so pane-binding resolution alone
 * returns nothing and the table would read as an empty book. Scope falls back
 * through the pane's own setting, the collection pane it follows, then the first
 * book in the config. A configured id that no longer exists falls through as
 * well, so deleting a collection does not pin the pane to it.
 */
export function resolvePortfolioEventsCollectionId(
  config: CollectionConfig,
  settings: Record<string, unknown> | undefined,
  boundCollectionId: string | null,
): string | null {
  const configured = typeof settings?.collectionId === "string" ? settings.collectionId.trim() : "";
  if (isKnownCollectionId(config, configured)) return configured;
  if (isKnownCollectionId(config, boundCollectionId)) return boundCollectionId;
  return config.portfolios[0]?.id ?? config.watchlists[0]?.id ?? null;
}

export function buildPortfolioEventRows(
  entries: Iterable<{ symbol: string; name?: string; currency: string; data: CorporateActionsData | null }>,
): PortfolioEventRow[] {
  const seen = new Set<string>();
  const rows: PortfolioEventRow[] = [];
  for (const entry of entries) {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) continue;
    for (const row of buildEventRows(entry.data, null, null, entry.currency)) {
      const id = `${symbol}:${row.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ ...row, id, symbol, name: entry.name });
    }
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol));
}
