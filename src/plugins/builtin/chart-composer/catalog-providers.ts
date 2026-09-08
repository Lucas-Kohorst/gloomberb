import type {
  ChartSeriesCatalogEntry,
  ChartSeriesCatalogProvider,
} from "../../../types/plugin";
import { getSharedRegistry } from "../../registry";
import { parseSeriesExpression } from "./presets";
import {
  analyzeSeriesSearchQuery,
  buildSeriesCatalogSuggestions,
  formatParsedSeriesExpression,
  looksLikeCatalogSeriesQuery,
  type SeriesCatalogSuggestion,
} from "./series-catalog";

function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesEntry(entry: ChartSeriesCatalogEntry, tokens: readonly string[]): boolean {
  const haystack = `${entry.label} ${entry.source} ${entry.searchText}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function suggestionFromEntry(
  providerId: string,
  entry: ChartSeriesCatalogEntry,
): SeriesCatalogSuggestion | null {
  const expression = parseSeriesExpression(entry.expression);
  if (!expression) return null;
  return {
    id: `${providerId}:${entry.id}`,
    label: entry.label,
    description: entry.description ?? entry.source,
    detail: entry.detail ?? entry.source,
    expression,
    expressionText: entry.expression,
  };
}

export function localCatalogSuggestions(
  query: string,
  providers: readonly ChartSeriesCatalogProvider[],
  limit = 8,
): SeriesCatalogSuggestion[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const seen = new Set<string>();
  const suggestions: SeriesCatalogSuggestion[] = [];
  for (const provider of providers) {
    for (const entry of provider.entries ?? []) {
      if (!matchesEntry(entry, tokens) || seen.has(entry.expression)) continue;
      const suggestion = suggestionFromEntry(provider.id, entry);
      if (!suggestion) continue;
      seen.add(entry.expression);
      suggestions.push(suggestion);
      if (suggestions.length >= limit) return suggestions;
    }
  }
  return suggestions;
}

export function dedupeCatalogSuggestions(
  suggestions: readonly SeriesCatalogSuggestion[],
  limit = 8,
): SeriesCatalogSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((entry) => {
    const key = formatParsedSeriesExpression(entry.expression);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function hasLocalChartSeriesCatalogMatch(query: string): boolean {
  const providers = getSharedRegistry()?.getAvailableChartSeriesCatalogs() ?? [];
  if (localCatalogSuggestions(query, providers, 1).length > 0) return true;
  if (shouldSearchRegisteredCatalogs(query, providers)) return true;
  const analysis = analyzeSeriesSearchQuery(query);
  if (analysis.metricQuery && buildSeriesCatalogSuggestions(query, { symbol: "AAPL" }, [], 1).length > 0) {
    return true;
  }
  return looksLikeCatalogSeriesQuery(query);
}

export function shouldSearchRegisteredCatalogs(
  query: string,
  providers: readonly ChartSeriesCatalogProvider[],
): boolean {
  const trimmed = query.trim();
  return providers.some((provider) => provider.search
    && trimmed.length >= (provider.minQueryLength ?? 1)
    && (provider.shouldSearch?.(trimmed) ?? true));
}

export async function searchRegisteredCatalogs(
  query: string,
  providers: readonly ChartSeriesCatalogProvider[],
  signal: AbortSignal,
): Promise<SeriesCatalogSuggestion[]> {
  const trimmed = query.trim();
  const searchable = providers.filter((provider) => shouldSearchRegisteredCatalogs(trimmed, [provider]));
  const settled = await Promise.allSettled(searchable.map((provider) => provider.search!(trimmed, signal)));
  signal.throwIfAborted();
  const entries = settled.flatMap((result, index) => result.status === "fulfilled"
    ? result.value.map((entry) => ({ entry, providerId: searchable[index]!.id }))
    : []);
  const failure = settled.find((result) => result.status === "rejected");
  if (entries.length === 0 && failure?.status === "rejected") throw failure.reason;
  const seen = new Set<string>();
  return entries.flatMap(({ entry, providerId }) => {
    if (seen.has(entry.expression)) return [];
    const suggestion = suggestionFromEntry(providerId, entry);
    if (!suggestion) return [];
    seen.add(entry.expression);
    return [suggestion];
  });
}
