import type { TickerRecord } from "../../../../types/ticker";
import {
  createLocalTickerSearchCandidates,
  type TickerSearchCandidate,
} from "../../../../tickers/search";
import type { ResultItem } from "../../list/model";

export const QUICK_LOOK_TICKER_SEARCH_OPTIONS = { includeOptionContracts: false } as const;

export function buildTickerSearchCacheKey(
  query: string,
  brokerId?: string | null,
  brokerInstanceId?: string | null,
): string {
  return [query.trim().toUpperCase(), brokerId || "", brokerInstanceId || ""].join("|");
}

export function createQuickLookTickerCandidates(tickers: Iterable<TickerRecord>): TickerSearchCandidate[] {
  return createLocalTickerSearchCandidates(tickers, new Map(), QUICK_LOOK_TICKER_SEARCH_OPTIONS);
}

export function normalizeCommandTickerSearchText(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function isExactTickerResultMatch(item: ResultItem, query: string): boolean {
  if (item.kind !== "ticker" && item.kind !== "search") return false;
  const normalizedQuery = normalizeCommandTickerSearchText(query);
  if (!normalizedQuery) return false;
  return normalizeCommandTickerSearchText(item.label) === normalizedQuery;
}

export function mergeTickerSearchResultItems(
  query: string,
  rankedItems: ResultItem[],
  fallbackItems: ResultItem[],
): ResultItem[] {
  const merged: ResultItem[] = [];
  const seen = new Set<string>();
  const addItem = (item: ResultItem) => {
    if (item.kind === "info") return;
    const key = `${item.label.trim().toUpperCase()}:${(item.right || "").trim().toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };
  rankedItems.forEach(addItem);
  fallbackItems.forEach(addItem);
  if (merged.length === 0) return rankedItems.length > 0 ? rankedItems : fallbackItems;

  return merged.map((item) => isExactTickerResultMatch(item, query) && item.category !== "Saved"
      ? { ...item, category: "Exact Match" }
      : item);
}

/** Trailing chips on a resolved security: Details, Quote, Chart. */
export const ROOT_SECURITY_ACTION_CHIPS = "DES QQ G";

function tickerCompanyName(item: ResultItem): string {
  return item.detail.split("|")[0]?.trim() ?? "";
}

function formatRootSecurityLabel(item: ResultItem): string {
  const name = tickerCompanyName(item);
  if (!name) return item.label;
  const symbol = item.label.trim();
  if (name.toUpperCase() === symbol.toUpperCase()) return symbol;
  if (symbol.toUpperCase().includes(name.toUpperCase())) return symbol;
  return `${symbol}  ${name}`;
}

function decorateRootSecurityItem(item: ResultItem): ResultItem {
  return {
    ...item,
    category: "Exact Match",
    label: formatRootSecurityLabel(item),
    right: ROOT_SECURITY_ACTION_CHIPS,
  };
}

export function mergePlainRootTickerResults(
  query: string,
  providerItems: ResultItem[],
  rootItems: ResultItem[],
): ResultItem[] {
  const merged: ResultItem[] = [];
  const seen = new Set<string>();
  const addItem = (item: ResultItem, options?: { skipInfo?: boolean; security?: boolean }) => {
    if (options?.skipInfo && item.kind === "info") return;
    const decorated = options?.security ? decorateRootSecurityItem(item) : item;
    const key = (decorated.kind === "ticker" || decorated.kind === "search")
      ? `${decorated.kind}:${decorated.label.trim().toUpperCase()}:${(decorated.right || "").trim().toUpperCase()}`
      : `${decorated.kind}:${decorated.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(decorated);
  };

  providerItems
    .filter((item) => item.category === "Exact Match" || isExactTickerResultMatch(item, query))
    .forEach((item) => addItem(item, { skipInfo: true, security: true }));
  rootItems.forEach((item) => addItem(item, {
    security: item.category === "Exact Match" || isExactTickerResultMatch(item, query),
  }));
  providerItems
    .filter((item) => item.category !== "Exact Match" && !isExactTickerResultMatch(item, query))
    .forEach((item) => addItem(item, { skipInfo: true }));
  return merged.length > 0 ? merged : rootItems;
}
