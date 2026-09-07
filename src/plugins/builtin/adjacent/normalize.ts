import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type {
  AdjacentConstituent,
  AdjacentIndex,
  AdjacentIndexRow,
  AdjacentIndexPricePoint,
  AdjacentIndexSleeve,
  AdjacentNewsArticle,
  AdjacentPlatform,
  AdjacentPriceHistoryPoint,
  AdjacentPricePoint,
  AdjacentPriceSample,
  AdjacentRate,
  AdjacentRateRow,
  AdjacentSimilarMarket,
} from "./types";
import type { NewsArticle } from "../../../types/news-source";
import { extractArticleTickersFromParts } from "../../../news/article-tickers";
import type { PricePoint } from "../../../types/financials";
import type { PredictionHistoryPoint } from "../../prediction-markets/types";

export type AdjacentIndexSortColumnId = "ticker" | "name" | "value" | "prob" | "chg1d" | "chg7d";

export function adjacentIndexSortValue(
  row: AdjacentIndexRow,
  columnId: AdjacentIndexSortColumnId,
): string | number | null {
  switch (columnId) {
    case "ticker":
      return row.ticker;
    case "name":
      return row.name;
    case "value":
      return row.value;
    case "prob":
      return row.probabilityPct;
    case "chg1d":
      return row.change1d;
    case "chg7d":
      return row.change7d;
  }
}

export function compareAdjacentIndexRows(
  left: AdjacentIndexRow,
  right: AdjacentIndexRow,
  columnId: AdjacentIndexSortColumnId,
  direction: SortDirection = "asc",
): number {
  return compareSortValues(
    adjacentIndexSortValue(left, columnId),
    adjacentIndexSortValue(right, columnId),
    direction,
  );
}

export function normalizeAdjacentIndex(index: AdjacentIndex): AdjacentIndexRow {
  const value = index.latest_price;
  const probabilityPct = value != null ? value - 50 : null;
  return {
    id: index.index_id,
    ticker: index.ticker?.trim() || index.index_id.toUpperCase(),
    name: index.name,
    value,
    probabilityPct,
    change1d: index.change_1d ?? null,
    change7d: index.change_7d ?? null,
    category: index.office_category ?? undefined,
  };
}

export type AdjacentRateSortColumnId = "name" | "value" | "spread" | "chg1d";

export function adjacentRateSortValue(
  row: AdjacentRateRow,
  columnId: AdjacentRateSortColumnId,
): string | number | null {
  switch (columnId) {
    case "name":
      return row.name;
    case "value":
      return row.value;
    case "spread":
      return row.spread;
    case "chg1d":
      return row.change1d;
  }
}

export function normalizeAdjacentRate(rate: AdjacentRate): AdjacentRateRow {
  return {
    id: rate.rate_id,
    name: rate.name,
    value: rate.latest_price ?? null,
    spread: rate.spread ?? null,
    change1d: rate.price_change_1d ?? null,
    category: undefined,
  };
}

export function normalizeAdjacentPriceHistory(
  prices: AdjacentPricePoint[],
): AdjacentPriceHistoryPoint[] {
  return prices.flatMap((point) => {
    const date = new Date(point.timestamp);
    if (!Number.isFinite(date.getTime())) return [];
    return [{
      date,
      close: point.close,
      open: point.open,
      high: point.high,
      low: point.low,
      volume: point.volume,
    }];
  });
}

export function adjacentPriceHistoryToPricePoints(
  points: AdjacentPriceHistoryPoint[],
): PricePoint[] {
  return points.map((point) => ({
    date: point.date,
    close: point.close,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
  }));
}

export function adjacentPriceHistoryToPredictionPoints(
  points: AdjacentPriceHistoryPoint[],
): PredictionHistoryPoint[] {
  return points.map((point) => ({
    date: point.date,
    close: point.close,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
  }));
}

export function unwrapAdjacentPriceSamples(raw: unknown): AdjacentPriceSample[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : Array.isArray((raw as { points?: unknown }).points)
          ? (raw as { points: unknown[] }).points
          : []
      : [];
  const samples: AdjacentPriceSample[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const timestamp = stringField(item, "timestamp", "time", "date");
    const price = numberField(item, "price", "close", "value");
    if (!timestamp || price == null) continue;
    samples.push({ timestamp, price });
  }
  return samples;
}

export function normalizeAdjacentIndexPrices(
  prices: AdjacentPriceSample[],
): AdjacentIndexPricePoint[] {
  return prices.flatMap((point) => {
    const date = new Date(point.timestamp);
    if (!Number.isFinite(date.getTime()) || point.price == null) return [];
    return [{ date, value: point.price }];
  });
}

export function adjacentIndexPricesToPricePoints(
  points: AdjacentIndexPricePoint[],
): PricePoint[] {
  return points.map((point) => ({
    date: point.date,
    close: point.value,
  }));
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseAdjacentNewsArticle(value: unknown): AdjacentNewsArticle | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = stringField(record, "id", "article_id");
  const title = stringField(record, "title");
  const url = stringField(record, "url");
  if (!id || !title || !url) return null;
  return {
    id,
    title,
    url,
    source: stringField(record, "source") || "Adjacent Press",
    summary: stringField(record, "summary"),
    published_at: stringField(record, "published_at", "published_date") || "",
    image: stringField(record, "image", "image_url"),
    author: stringField(record, "author"),
    categories: Array.isArray(record.categories)
      ? record.categories.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    tickers: Array.isArray(record.tickers)
      ? record.tickers.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    sentiment:
      record.sentiment === "positive" || record.sentiment === "negative" || record.sentiment === "neutral"
        ? record.sentiment
        : undefined,
    importance: typeof record.importance === "number" ? record.importance : undefined,
  };
}

export function unwrapAdjacentNewsArticles(raw: unknown): AdjacentNewsArticle[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.news)
    ? record.news
    : Array.isArray(record.data)
      ? record.data
      : [];
  return rows
    .map(parseAdjacentNewsArticle)
    .filter((article): article is AdjacentNewsArticle => article !== null);
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function platformFromId(id: string): AdjacentPlatform {
  return id.toLowerCase().startsWith("kalshi:") ? "kalshi" : "polymarket";
}

export function parseAdjacentSimilarMarket(value: unknown): AdjacentSimilarMarket | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = stringField(record, "id", "market_id");
  if (!id) return null;
  const platformRaw = stringField(record, "platform");
  const platform: AdjacentPlatform = platformRaw === "kalshi" || platformRaw === "polymarket"
    ? platformRaw
    : platformFromId(id);
  return {
    id,
    platform,
    title: stringField(record, "title", "question") ?? id,
    yes_price: numberField(record, "yes_price", "latest_price", "probability"),
    volume_24h: numberField(record, "volume_24h") ?? undefined,
    similarity: numberField(record, "similarity") ?? undefined,
    url: stringField(record, "url", "link"),
    category: stringField(record, "category"),
  };
}

export function unwrapAdjacentSimilarMarkets(raw: unknown): AdjacentSimilarMarket[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.markets)
    ? record.markets
    : Array.isArray(record.data)
      ? record.data
      : [];
  return rows
    .map(parseAdjacentSimilarMarket)
    .filter((market): market is AdjacentSimilarMarket => market !== null);
}

function venueFromConstituent(row: {
  platform?: string;
  market_id: string;
}): "kalshi" | "polymarket" | null {
  const platform = (row.platform ?? "").toLowerCase();
  const id = row.market_id.toLowerCase();
  if (platform === "kalshi" || id.startsWith("kalshi:")) return "kalshi";
  if (platform === "polymarket" || id.startsWith("polymarket:") || id.startsWith("poly:")) {
    return "polymarket";
  }
  return null;
}

/** NTI/rate sleeves are 0-1; Kalshi/Polymarket constituents are 0-100 cents. */
export function constituentImpliedPercent(row: {
  price?: number | null;
  platform?: string;
  market_id: string;
}): number | null {
  if (row.price == null || !Number.isFinite(row.price) || row.price < 0) return null;
  const venue = venueFromConstituent(row);
  if (!venue && row.price <= 1) return row.price * 100;
  return row.price;
}

export function constituentChartExpression(row: {
  platform?: string;
  market_id: string;
  ticker?: string;
  display_ticker?: string;
}): string | null {
  const venue = venueFromConstituent(row);
  const raw = (row.ticker ?? row.display_ticker ?? "").trim()
    || row.market_id.replace(/^(kalshi|polymarket|poly):/i, "").trim();
  if (!raw) return null;
  if (venue === "kalshi") return `KALSHI:${raw}`;
  if (venue === "polymarket") return `POLY:${raw}`;
  return `ADJ:${row.market_id}`;
}

export function constituentOpenSymbol(row: {
  platform?: string;
  market_id: string;
  ticker?: string;
  display_ticker?: string;
}): string | null {
  const expression = constituentChartExpression(row);
  if (!expression || expression.startsWith("ADJ:")) return null;
  return expression;
}

export function formatImpliedPercent(prob: number): string {
  const rounded = Math.round(prob * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function rateFamily(value: string): string {
  return value.trim().toLowerCase().replace(/_\d+$/, "");
}

/** Prefer live NTI sleeves when the constituents list still has a stale unpriced row. */
export function mergeIndexConstituents(
  constituents: AdjacentConstituent[],
  sleeves: AdjacentIndexSleeve[] | null | undefined,
): AdjacentConstituent[] {
  if (!sleeves?.length) return constituents;
  const weightByRate = new Map(constituents.map((row) => [row.market_id, row.weight]));
  const constituentFamilies = new Set(
    constituents.flatMap((row) => {
      const family = rateFamily(row.market_id);
      return family ? [family] : [];
    }),
  );
  const relevantSleeves = sleeves.filter((sleeve) => {
    const members = sleeve.members?.length
      ? sleeve.members
      : sleeve.rate_id
        ? [{ rate_id: sleeve.rate_id, name: sleeve.name, mark_price: sleeve.mark_price }]
        : [];
    return members.some((member) => (
      weightByRate.has(member.rate_id) || constituentFamilies.has(rateFamily(member.rate_id))
    ));
  });
  if (relevantSleeves.length === 0) return constituents;
  const rows: AdjacentConstituent[] = [];
  const seen = new Set<string>();
  for (const sleeve of relevantSleeves) {
    const members = sleeve.members?.length
      ? sleeve.members
      : sleeve.rate_id
        ? [{ rate_id: sleeve.rate_id, name: sleeve.name, mark_price: sleeve.mark_price }]
        : [];
    if (members.length === 0) continue;
    const sleeveWeight = members.reduce((sum, member) => (
      sum + (weightByRate.get(member.rate_id) ?? 0)
    ), 0) || (weightByRate.get(sleeve.rate_id ?? "") ?? (1 / relevantSleeves.length));
    const share = sleeveWeight / members.length;
    for (const member of members) {
      if (!member.rate_id || seen.has(member.rate_id)) continue;
      seen.add(member.rate_id);
      rows.push({
        kind: "market",
        market_id: member.rate_id,
        platform: member.rate_id,
        name: member.name,
        weight: share,
        price: member.mark_price ?? null,
      });
    }
  }
  for (const row of constituents) {
    if (seen.has(row.market_id)) continue;
    if (!venueFromConstituent(row)) continue;
    seen.add(row.market_id);
    rows.push(row);
  }
  return rows.length > 0 ? rows : constituents;
}

export function unwrapAdjacentMarketIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.markets)
      ? record.markets
      : [];
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = stringField(item, "market_id", "id");
    if (id) ids.push(id);
  }
  return ids;
}

export function normalizeAdjacentNewsArticle(
  article: AdjacentNewsArticle,
): NewsArticle {
  const publishedAt = new Date(article.published_at);
  const safeDate = Number.isFinite(publishedAt.getTime()) ? publishedAt : new Date();
  const importance = article.importance ?? 50;
  const categories = [...new Set([...(article.categories ?? []), "adjacent", "press"])];
  return {
    id: `adjacent:${article.id}`,
    title: article.title,
    url: article.url,
    source: article.source || "Adjacent Press",
    publishedAt: safeDate,
    summary: article.summary,
    imageUrl: article.image,
    topic: categories[0] ?? "prediction-markets",
    topics: categories,
    sectors: [],
    categories,
    tickers: [...new Set([
      ...(article.tickers ?? []),
      ...extractArticleTickersFromParts([article.title, article.summary]),
    ])],
    sentiment: article.sentiment,
    scores: {
      importance,
      urgency: importance,
      marketImpact: importance,
      novelty: 0,
      confidence: 0,
    },
    isBreaking: importance >= 80,
    isDeveloping: false,
    importance,
  };
}

export function centsToProbability(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return cents / 100;
}

/** Adjacent list prices are 0–100. Display after converting through 0–1. */
export function formatYesOddsPercent(cents: number | null | undefined): string | null {
  const probability = centsToProbability(cents);
  if (probability == null) return null;
  return `${Math.round(probability * 100)}%`;
}

export function indexValueToProbability(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value - 50;
}
