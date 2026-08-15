import type {
  AdjacentIndex,
  AdjacentIndexRow,
  AdjacentIndexPricePoint,
  AdjacentNewsArticle,
  AdjacentPriceHistoryPoint,
  AdjacentPricePoint,
  AdjacentRate,
  AdjacentRateRow,
} from "./types";
import type { NewsArticle } from "../../../types/news-source";
import type { PricePoint } from "../../../types/financials";
import type { PredictionHistoryPoint } from "../../prediction-markets/types";

export function normalizeAdjacentIndex(index: AdjacentIndex): AdjacentIndexRow {
  const value = index.value;
  const probabilityPct = value != null ? value - 50 : null;
  return {
    id: index.id,
    name: index.name,
    value,
    probabilityPct,
    change1d: index.change_1d ?? null,
    change7d: index.change_7d ?? null,
    category: index.category,
  };
}

export function normalizeAdjacentRate(rate: AdjacentRate): AdjacentRateRow {
  return {
    id: rate.id,
    name: rate.name,
    value: rate.value ?? null,
    spread: rate.spread ?? null,
    category: rate.category,
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
  prices: Array<{ timestamp: string; value: number }>,
): AdjacentIndexPricePoint[] {
  return prices.flatMap((point) => {
    const date = new Date(point.timestamp);
    if (!Number.isFinite(date.getTime())) return [];
    return [{ date, value: point.value }];
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

export function normalizeAdjacentNewsArticle(
  article: AdjacentNewsArticle,
): NewsArticle {
  const publishedAt = new Date(article.published_at);
  const safeDate = Number.isFinite(publishedAt.getTime()) ? publishedAt : new Date();
  const importance = article.importance ?? 50;
  return {
    id: `adjacent:${article.id}`,
    title: article.title,
    url: article.url,
    source: article.source || "Adjacent",
    publishedAt: safeDate,
    summary: article.summary,
    imageUrl: article.image,
    topic: article.categories?.[0] ?? "prediction-markets",
    topics: article.categories ?? [],
    sectors: [],
    categories: article.categories ?? [],
    tickers: article.tickers ?? [],
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

export function indexValueToProbability(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value - 50;
}
