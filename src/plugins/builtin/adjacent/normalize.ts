import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type {
  AdjacentIndex,
  AdjacentIndexRow,
  AdjacentIndexPricePoint,
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

export function normalizeAdjacentRate(rate: AdjacentRate): AdjacentRateRow {
  return {
    id: rate.rate_id,
    name: rate.name,
    value: rate.latest_price ?? null,
    spread: rate.spread ?? null,
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
