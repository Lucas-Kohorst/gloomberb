import type {
  PredictionGroupedListRow,
  PredictionListRow,
  PredictionMarketSummary,
  PredictionSingleListRow,
} from "./types";
import { getPredictionTopOutcome } from "./outcome-order";

function coerceTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function minDefined(values: Array<number | null | undefined>): number | null {
  const defined = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (defined.length === 0) return null;
  return Math.min(...defined);
}

function maxDefined(values: Array<number | null | undefined>): number | null {
  const defined = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (defined.length === 0) return null;
  return Math.max(...defined);
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value && value.length > 0))];
}

function buildPredictionGroupKey(summary: PredictionMarketSummary): string | null {
  if (summary.venue === "polymarket" && summary.eventId) {
    return `polymarket:event:${summary.eventId}`;
  }
  if (summary.venue === "kalshi" && summary.eventTicker) {
    return `kalshi:event:${summary.eventTicker}`;
  }
  return null;
}

function buildGroupSubtitle(
  markets: PredictionMarketSummary[],
  focusMarket: PredictionMarketSummary | null,
): string {
  const focusLabel = focusMarket?.marketLabel?.trim();
  if (focusLabel) {
    return `${markets.length} targets · top: ${focusLabel}`;
  }
  return `${markets.length} targets`;
}

function sumGroupedMetric(
  markets: PredictionMarketSummary[],
  field: "volume24h" | "totalVolume" | "openInterest",
): number | null {
  let total = 0;
  let seen = false;
  for (const market of markets) {
    const value = market[field];
    if (value == null || !Number.isFinite(value)) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function sortGroupMembers(
  markets: PredictionMarketSummary[],
): PredictionMarketSummary[] {
  return [...markets].sort((left, right) => {
    const volumeDelta = (right.volume24h ?? 0) - (left.volume24h ?? 0);
    if (volumeDelta !== 0) return volumeDelta;
    const updatedDelta =
      (coerceTimestamp(right.updatedAt) ?? 0) - (coerceTimestamp(left.updatedAt) ?? 0);
    if (updatedDelta !== 0) return updatedDelta;
    return left.marketLabel.localeCompare(right.marketLabel);
  });
}

function buildChildRow(
  summary: PredictionMarketSummary,
  parentKey: string,
): PredictionSingleListRow {
  return {
    ...buildSingleRow(summary),
    title: summary.marketLabel || summary.title,
    parentKey,
  };
}

export function resolvePredictionListActivation(
  row: Pick<PredictionListRow, "kind">,
): "toggle-group" | "open-detail" {
  return row.kind === "group" ? "toggle-group" : "open-detail";
}

export function togglePredictionGroupExpanded(
  expandedKeys: ReadonlySet<string>,
  groupKey: string,
): Set<string> {
  const next = new Set(expandedKeys);
  if (next.has(groupKey)) {
    next.delete(groupKey);
  } else {
    next.add(groupKey);
  }
  return next;
}

export function flattenPredictionListRows(
  rows: PredictionListRow[],
  expandedKeys: ReadonlySet<string>,
): PredictionListRow[] {
  const flattened: PredictionListRow[] = [];
  for (const row of rows) {
    if (row.kind !== "group") {
      flattened.push(row);
      continue;
    }
    const expanded = expandedKeys.has(row.key);
    flattened.push({ ...row, expanded });
    if (!expanded) continue;
    for (const market of row.markets) {
      flattened.push(buildChildRow(market, row.key));
    }
  }
  return flattened;
}

function buildSingleRow(summary: PredictionMarketSummary): PredictionSingleListRow {
  return {
    key: summary.key,
    kind: "market",
    venue: summary.venue,
    representative: summary,
    focusMarketKey: summary.key,
    focusMarketLabel: summary.marketLabel,
    focusYesPrice: summary.yesPrice,
    markets: [summary],
    title: summary.title,
    marketId: summary.marketId,
    marketLabel: summary.marketLabel,
    eventLabel: summary.eventLabel,
    category: summary.category,
    tags: summary.tags,
    status: summary.status,
    url: summary.url,
    description: summary.description,
    endsAt: summary.endsAt,
    updatedAt: summary.updatedAt,
    createdAt: summary.createdAt,
    yesPrice: summary.yesPrice,
    noPrice: summary.noPrice,
    spread: summary.spread,
    lastTradePrice: summary.lastTradePrice,
    volume24h: summary.volume24h,
    volume24hUnit: summary.volume24hUnit,
    totalVolume: summary.totalVolume,
    totalVolumeUnit: summary.totalVolumeUnit,
    openInterest: summary.openInterest,
    openInterestUnit: summary.openInterestUnit,
    liquidity: summary.liquidity,
    liquidityUnit: summary.liquidityUnit,
    searchText: [
      summary.title,
      summary.marketLabel,
      summary.eventLabel,
      summary.category ?? "",
      summary.marketId,
      ...(summary.tags ?? []),
    ]
      .join(" ")
      .toLowerCase(),
    watchMarketKeys: [summary.key],
  };
}

function buildGroupedRow(markets: PredictionMarketSummary[]): PredictionGroupedListRow {
  const sortedMarkets = sortGroupMembers(markets);
  const representative = sortedMarkets[0]!;
  const focusMarket = getPredictionTopOutcome(sortedMarkets) ?? representative;
  const yesValues = sortedMarkets.map((market) => market.yesPrice);
  const spreadValues = sortedMarkets.map((market) => market.spread);
  const tags = dedupeStrings(
    sortedMarkets.flatMap((market) => market.tags ?? []).concat(representative.category ?? []),
  );
  const latestUpdatedAt = sortedMarkets.reduce<string | null>((latest, market) => {
    const latestTs = coerceTimestamp(latest);
    const marketTs = coerceTimestamp(market.updatedAt);
    if (marketTs == null) return latest;
    if (latestTs == null || marketTs > latestTs) return market.updatedAt;
    return latest;
  }, representative.updatedAt);
  const earliestEndsAt = sortedMarkets.reduce<string | null>((earliest, market) => {
    const earliestTs = coerceTimestamp(earliest);
    const marketTs = coerceTimestamp(market.endsAt);
    if (marketTs == null) return earliest;
    if (earliestTs == null || marketTs < earliestTs) return market.endsAt;
    return earliest;
  }, representative.endsAt);
  const latestCreatedAt = sortedMarkets.reduce<string | null>((latest, market) => {
    const latestTs = coerceTimestamp(latest);
    const marketTs = coerceTimestamp(market.createdAt);
    if (marketTs == null) return latest;
    if (latestTs == null || marketTs > latestTs) return market.createdAt;
    return latest;
  }, representative.createdAt);

  return {
    key: `group:${buildPredictionGroupKey(representative) ?? representative.key}`,
    kind: "group",
    venue: representative.venue,
    representative,
    focusMarketKey: focusMarket.key,
    focusMarketLabel: focusMarket.marketLabel,
    focusYesPrice: focusMarket.yesPrice,
    markets: sortedMarkets,
    title: representative.eventLabel,
    marketId:
      representative.venue === "polymarket"
        ? representative.eventId ?? representative.marketId
        : representative.eventTicker ?? representative.marketId,
    marketLabel: representative.eventLabel,
    eventLabel: buildGroupSubtitle(sortedMarkets, focusMarket),
    category: representative.category,
    tags,
    status: representative.status,
    url: representative.url,
    description: representative.description,
    endsAt: earliestEndsAt,
    updatedAt: latestUpdatedAt,
    createdAt: latestCreatedAt,
    yesPrice: representative.yesPrice,
    noPrice: representative.noPrice,
    spread: representative.spread,
    lastTradePrice: representative.lastTradePrice,
    volume24h: sumGroupedMetric(sortedMarkets, "volume24h"),
    volume24hUnit: representative.volume24hUnit,
    totalVolume: sumGroupedMetric(sortedMarkets, "totalVolume"),
    totalVolumeUnit: representative.totalVolumeUnit,
    openInterest: sumGroupedMetric(sortedMarkets, "openInterest"),
    openInterestUnit: representative.openInterestUnit,
    liquidity: representative.liquidity,
    liquidityUnit: representative.liquidityUnit,
    searchText: [
      representative.eventLabel,
      buildGroupSubtitle(sortedMarkets, focusMarket),
      ...sortedMarkets.flatMap((market) => [
        market.title,
        market.marketLabel,
        market.eventLabel,
        market.marketId,
      ]),
      ...tags,
    ]
      .join(" ")
      .toLowerCase(),
    watchMarketKeys: sortedMarkets.map((market) => market.key),
    marketCount: sortedMarkets.length,
    yesPriceLow: minDefined(yesValues),
    yesPriceHigh: maxDefined(yesValues),
    spreadLow: minDefined(spreadValues),
    spreadHigh: maxDefined(spreadValues),
  };
}

export function buildPredictionListRows(
  markets: PredictionMarketSummary[],
): PredictionListRow[] {
  const groupedMarkets = new Map<string, PredictionMarketSummary[]>();
  const standaloneMarkets: PredictionMarketSummary[] = [];

  for (const market of markets) {
    const groupKey = buildPredictionGroupKey(market);
    if (!groupKey) {
      standaloneMarkets.push(market);
      continue;
    }
    if (!groupedMarkets.has(groupKey)) {
      groupedMarkets.set(groupKey, []);
    }
    groupedMarkets.get(groupKey)!.push(market);
  }

  const rows: PredictionListRow[] = [];
  for (const market of standaloneMarkets) {
    rows.push(buildSingleRow(market));
  }

  for (const marketsForGroup of groupedMarkets.values()) {
    if (marketsForGroup.length <= 1) {
      rows.push(buildSingleRow(marketsForGroup[0]!));
      continue;
    }
    rows.push(buildGroupedRow(marketsForGroup));
  }

  return rows;
}
