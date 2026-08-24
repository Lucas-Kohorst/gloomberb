import type { AppConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import { hasPortfolioPosition } from "./metrics";

export type AnalyticsCollectionKind = "portfolio" | "watchlist";

export interface AnalyticsCollection {
  kind: AnalyticsCollectionKind;
  id: string;
  name: string;
}

export function listAnalyticsCollections(
  config: Pick<AppConfig, "portfolios" | "watchlists">,
): AnalyticsCollection[] {
  return [
    ...config.portfolios.map((portfolio) => ({
      kind: "portfolio" as const,
      id: portfolio.id,
      name: portfolio.name,
    })),
    ...config.watchlists.map((watchlist) => ({
      kind: "watchlist" as const,
      id: watchlist.id,
      name: watchlist.name,
    })),
  ];
}

export function resolveAnalyticsCollection(
  config: Pick<AppConfig, "portfolios" | "watchlists">,
  id: string | null | undefined,
): AnalyticsCollection | null {
  if (!id) return null;
  const portfolio = config.portfolios.find((entry) => entry.id === id);
  if (portfolio) {
    return { kind: "portfolio", id: portfolio.id, name: portfolio.name };
  }
  const watchlist = config.watchlists.find((entry) => entry.id === id);
  if (watchlist) {
    return { kind: "watchlist", id: watchlist.id, name: watchlist.name };
  }
  return null;
}

export function resolvePortfolioId(
  portfolios: { id: string }[],
  portfolioId: string | null | undefined,
): string | null {
  if (!portfolioId) return null;
  return portfolios.some((portfolio) => portfolio.id === portfolioId) ? portfolioId : null;
}

export function resolveTemplatePortfolioId(
  portfolios: { id: string }[],
  activeCollectionId: string | null,
): string | null {
  return resolvePortfolioId(portfolios, activeCollectionId) ?? portfolios[0]?.id ?? null;
}

export function resolveTemplateCollectionId(
  config: Pick<AppConfig, "portfolios" | "watchlists">,
  activeCollectionId: string | null,
): string | null {
  return resolveAnalyticsCollection(config, activeCollectionId)?.id
    ?? config.portfolios[0]?.id
    ?? config.watchlists[0]?.id
    ?? null;
}

export function collectionMembers(
  collection: AnalyticsCollection,
  tickersBySymbol: Map<string, TickerRecord>,
): TickerRecord[] {
  const members = [...tickersBySymbol.values()]
    .filter((ticker) => (
      collection.kind === "portfolio"
        ? ticker.metadata.portfolios.includes(collection.id)
        : ticker.metadata.watchlists.includes(collection.id)
    ))
    .sort((left, right) => left.metadata.ticker.localeCompare(right.metadata.ticker));
  if (collection.kind === "watchlist") return members;
  return members.filter((ticker) => hasPortfolioPosition(ticker, collection.id));
}

export function collectionUsesEqualWeight(collection: AnalyticsCollection): boolean {
  return collection.kind === "watchlist";
}
