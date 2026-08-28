import type {
  PredictionCategoryId,
  PredictionHistoryRange,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionVenue,
} from "./types";

export function buildPredictionCatalogCacheKey(
  venue: PredictionVenue,
  categoryId: PredictionCategoryId,
  searchQuery: string,
  browseTab: string = "top",
): string {
  const base = `${venue}|${categoryId}|${searchQuery.trim().toLowerCase()}`;
  return browseTab === "top" ? base : `${base}|${browseTab}`;
}

export function buildPredictionCatalogResourceKey(
  venue: PredictionVenue,
  categoryId: PredictionCategoryId,
  searchQuery: string,
  browseTab: string = "top",
): string {
  const base = `${venue}:${categoryId}:${searchQuery.trim().toLowerCase() || "all"}`;
  return browseTab === "top" ? base : `${base}:${browseTab}`;
}

export function buildPredictionDetailCacheKey(
  marketKey: string,
  historyRange: PredictionHistoryRange,
): string {
  return `${marketKey}|${historyRange}`;
}

export function buildPredictionDetailResourceKey(
  marketKey: string,
  historyRange: PredictionHistoryRange,
): string {
  return `${marketKey}:${historyRange}`;
}

export function updatePredictionCatalogCacheEntries(
  current: Record<string, PredictionMarketSummary[]>,
  marketKey: string,
  updater: (summary: PredictionMarketSummary) => PredictionMarketSummary,
): Record<string, PredictionMarketSummary[]> {
  let changed = false;
  const next: Record<string, PredictionMarketSummary[]> = {};

  for (const [cacheKey, markets] of Object.entries(current)) {
    let cacheChanged = false;
    next[cacheKey] = markets.map((market) => {
      if (market.key !== marketKey) return market;
      const nextMarket = updater(market);
      if (nextMarket !== market) cacheChanged = true;
      return nextMarket;
    });
    changed = changed || cacheChanged;
  }

  return changed ? next : current;
}

export function updatePredictionDetailCacheEntries(
  current: Record<string, PredictionMarketDetail>,
  marketKey: string,
  updater: (detail: PredictionMarketDetail) => PredictionMarketDetail,
): Record<string, PredictionMarketDetail> {
  let changed = false;
  const next: Record<string, PredictionMarketDetail> = {};
  const prefix = `${marketKey}|`;

  for (const [cacheKey, detail] of Object.entries(current)) {
    if (!cacheKey.startsWith(prefix)) {
      next[cacheKey] = detail;
      continue;
    }
    changed = true;
    next[cacheKey] = updater(detail);
  }

  return changed ? next : current;
}

export function updatePredictionPendingCounts(
  current: Record<string, number>,
  key: string,
  delta: number,
): Record<string, number> {
  const nextValue = Math.max(0, (current[key] ?? 0) + delta);
  if ((current[key] ?? 0) === nextValue) {
    return current;
  }

  if (nextValue === 0) {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  }

  return {
    ...current,
    [key]: nextValue,
  };
}

export function updatePredictionErrorState(
  current: Record<string, string | null>,
  key: string,
  value: string | null,
): Record<string, string | null> {
  if ((current[key] ?? null) === value) return current;
  return {
    ...current,
    [key]: value,
  };
}

function sameNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function sameSummaryForCatalog(
  left: PredictionMarketSummary,
  right: PredictionMarketSummary,
): boolean {
  return (
    left.key === right.key &&
    left.title === right.title &&
    left.marketLabel === right.marketLabel &&
    left.eventLabel === right.eventLabel &&
    left.category === right.category &&
    left.status === right.status &&
    left.endsAt === right.endsAt &&
    left.updatedAt === right.updatedAt &&
    sameNullableNumber(left.yesPrice, right.yesPrice) &&
    sameNullableNumber(left.noPrice, right.noPrice) &&
    sameNullableNumber(left.yesBid, right.yesBid) &&
    sameNullableNumber(left.yesAsk, right.yesAsk) &&
    sameNullableNumber(left.noBid, right.noBid) &&
    sameNullableNumber(left.noAsk, right.noAsk) &&
    sameNullableNumber(left.spread, right.spread) &&
    sameNullableNumber(left.lastTradePrice, right.lastTradePrice) &&
    sameNullableNumber(left.volume24h, right.volume24h) &&
    sameNullableNumber(left.totalVolume, right.totalVolume) &&
    sameNullableNumber(left.openInterest, right.openInterest) &&
    sameNullableNumber(left.liquidity, right.liquidity)
  );
}

export function samePredictionCatalogSummaries(
  left: readonly PredictionMarketSummary[] | undefined,
  right: readonly PredictionMarketSummary[],
): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftSummary = left[index];
    const rightSummary = right[index];
    if (!leftSummary || !rightSummary) return false;
    if (!sameSummaryForCatalog(leftSummary, rightSummary)) return false;
  }
  return true;
}

export function mergePredictionCatalogPage(
  current: readonly PredictionMarketSummary[] | undefined,
  page: readonly PredictionMarketSummary[],
): PredictionMarketSummary[] {
  if (!current || current.length === 0) return [...page];
  if (page.length === 0) return [...current];
  const byKey = new Map<string, PredictionMarketSummary>();
  for (const market of page) {
    byKey.set(market.key, market);
  }
  const used = new Set<string>();
  const merged: PredictionMarketSummary[] = [];
  for (const market of current) {
    const fresh = byKey.get(market.key);
    if (fresh) {
      used.add(market.key);
      merged.push(fresh);
    } else {
      merged.push(market);
    }
  }
  for (const market of page) {
    if (used.has(market.key)) continue;
    used.add(market.key);
    merged.push(market);
  }
  return merged;
}

/** Persist/seed this many events so a cached catalog cannot freeze first paint. */
export const PREDICTION_CATALOG_EVENT_HEAD = 400;
/** Sorted groups handed to the table. Load-more can fill up to this. */
export const PREDICTION_CATALOG_PAINT_HEAD = 400;
/** Nested CLOB/event markets kept per event while flattening a catalog page. */
export const PREDICTION_CATALOG_MAX_EVENT_MARKETS = 24;

export function catalogEventKey(summary: PredictionMarketSummary): string {
  if (summary.venue === "polymarket" && summary.eventId) {
    return `polymarket:event:${summary.eventId}`;
  }
  if (summary.venue === "kalshi" && summary.eventTicker) {
    return `kalshi:event:${summary.eventTicker}`;
  }
  return summary.key;
}

export function slimPredictionCatalogSummary(
  summary: PredictionMarketSummary,
): PredictionMarketSummary {
  if (!summary.description && summary.rulesPrimary == null && summary.rulesSecondary == null) {
    return summary;
  }
  return {
    ...summary,
    description: "",
    rulesPrimary: undefined,
    rulesSecondary: undefined,
  };
}

export function takeTopByMetric<T>(
  items: readonly T[],
  limit: number,
  metric: (item: T) => number,
): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return items as T[];
  return items
    .map((item, index) => ({ item, index, metric: metric(item) }))
    .sort((left, right) => right.metric - left.metric || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function capPredictionCatalogByEvent(
  markets: readonly PredictionMarketSummary[],
  eventLimit = PREDICTION_CATALOG_EVENT_HEAD,
): PredictionMarketSummary[] {
  if (markets.length === 0) return [];
  const events = new Map<string, PredictionMarketSummary[]>();
  const order: string[] = [];
  let needsSlim = false;
  for (const market of markets) {
    const key = catalogEventKey(market);
    let group = events.get(key);
    if (!group) {
      group = [];
      events.set(key, group);
      order.push(key);
    }
    group.push(market);
    if (market.description || market.rulesPrimary || market.rulesSecondary) {
      needsSlim = true;
    }
  }
  let needsCap = needsSlim || order.length > eventLimit;
  if (!needsCap) {
    for (const group of events.values()) {
      if (group.length > PREDICTION_CATALOG_MAX_EVENT_MARKETS) {
        needsCap = true;
        break;
      }
    }
  }
  if (!needsCap) {
    return markets as PredictionMarketSummary[];
  }
  const limitedOrder = order.length > eventLimit ? order.slice(0, eventLimit) : order;
  const next: PredictionMarketSummary[] = [];
  for (const key of limitedOrder) {
    const group = events.get(key);
    if (!group) continue;
    const limitedGroup = takeTopByMetric(
      group,
      PREDICTION_CATALOG_MAX_EVENT_MARKETS,
      (market) => market.volume24h ?? 0,
    );
    for (const market of limitedGroup) {
      next.push(slimPredictionCatalogSummary(market));
    }
  }
  return next;
}
