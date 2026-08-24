/**
 * Hosted Kalshi market detail, sourced from Adjacent.
 *
 * The hosted client cannot reach Kalshi's own API: `/api/proxy/kalshi/*` runs
 * from Cloudflare egress IPs that Kalshi rate-limits, so every detail endpoint
 * (market, orderbook, trades, candlesticks, event) answers 429 more or less
 * permanently. Adjacent covers all of it except the order book, which has no
 * equivalent endpoint at any depth — hosted therefore shows an empty book.
 */
import type {
  PredictionHistoryPoint,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionSiblingMarket,
  PredictionTrade,
} from "../../types";
import {
  loadCachedPredictionResource,
  PREDICTION_CACHE_POLICIES,
  parseFloatSafe,
} from "../fetch";
import {
  adjacentKalshiId,
  fetchHostedAdjacentJson,
  mapAdjacentKalshiMarket,
  type AdjacentKalshiCatalogRow,
} from "./adjacent-catalog";

const ADJACENT_TRADE_LIMIT = 30;
const ADJACENT_HISTORY_PER_PAGE = 500;

/** Adjacent quotes prediction prices in cents; our model is 0–1 dollars. */
function centsToPrice(value: unknown): number | null {
  const parsed = parseFloatSafe(value);
  return parsed == null ? null : parsed / 100;
}

interface AdjacentPriceRow {
  timestamp?: string;
  price?: number | null;
  ohlc?: {
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
  } | null;
  volume?: number | null;
}

interface AdjacentTradeRow {
  trade_id?: string;
  timestamp?: string;
  price?: number | null;
  count?: number | null;
  side?: string;
}

interface AdjacentEventResponse {
  event_id?: string;
  name?: string;
  category?: string;
  description?: string;
  markets?: AdjacentKalshiCatalogRow[];
}

function unwrapRows<T>(raw: unknown): T[] {
  if (!raw || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}

const HISTORY_WINDOWS: Record<
  "1D" | "1W" | "1M" | "ALL",
  { interval: string; lookbackMs: number }
> = {
  "1D": { interval: "5min", lookbackMs: 24 * 60 * 60_000 },
  "1W": { interval: "1hour", lookbackMs: 7 * 24 * 60 * 60_000 },
  "1M": { interval: "1d", lookbackMs: 30 * 24 * 60 * 60_000 },
  ALL: { interval: "1d", lookbackMs: 365 * 24 * 60 * 60_000 },
};

export async function fetchHostedAdjacentKalshiMarket(
  ticker: string,
): Promise<PredictionMarketSummary | null> {
  const row = await fetchHostedAdjacentJson<AdjacentKalshiCatalogRow>(
    `markets/${adjacentKalshiId(ticker)}`,
  );
  return mapAdjacentKalshiMarket(row);
}

async function fetchHostedAdjacentKalshiEvent(
  eventTicker: string | undefined,
): Promise<AdjacentEventResponse | null> {
  if (!eventTicker) return null;
  return await loadCachedPredictionResource(
    "rules",
    `adjacent:kalshi:event:${eventTicker}`,
    async () =>
      await fetchHostedAdjacentJson<AdjacentEventResponse>(
        `events/${adjacentKalshiId(eventTicker)}`,
      ),
    PREDICTION_CACHE_POLICIES.rules,
  );
}

export async function loadHostedAdjacentKalshiHistory(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionHistoryPoint[]> {
  const window = HISTORY_WINDOWS[range];
  const rows = await loadCachedPredictionResource(
    "history",
    `adjacent:${summary.key}:${range}`,
    async () =>
      unwrapRows<AdjacentPriceRow>(
        await fetchHostedAdjacentJson<unknown>(
          `markets/${adjacentKalshiId(summary.marketId)}/prices`,
          {
            interval: window.interval,
            per_page: ADJACENT_HISTORY_PER_PAGE,
            start: new Date(Date.now() - window.lookbackMs).toISOString(),
          },
        ),
      ),
    PREDICTION_CACHE_POLICIES.history,
  );

  const points = rows
    .map((row): PredictionHistoryPoint | null => {
      const date = new Date(row.timestamp ?? "");
      const close = centsToPrice(row.ohlc?.close ?? row.price);
      if (!Number.isFinite(date.getTime()) || close == null) return null;
      return {
        date,
        close,
        open: centsToPrice(row.ohlc?.open) ?? undefined,
        high: centsToPrice(row.ohlc?.high) ?? undefined,
        low: centsToPrice(row.ohlc?.low) ?? undefined,
        volume: parseFloatSafe(row.volume) ?? undefined,
      };
    })
    .filter((point): point is PredictionHistoryPoint => point != null);

  // Adjacent returns newest-first; charts read oldest-first.
  return points.sort((left, right) => left.date.getTime() - right.date.getTime());
}

export async function loadHostedAdjacentKalshiTrades(
  summary: PredictionMarketSummary,
): Promise<PredictionTrade[]> {
  const rows = await loadCachedPredictionResource(
    "trades",
    `adjacent:${summary.key}`,
    async () =>
      unwrapRows<AdjacentTradeRow>(
        await fetchHostedAdjacentJson<unknown>(
          `markets/${adjacentKalshiId(summary.marketId)}/trades`,
          { per_page: ADJACENT_TRADE_LIMIT },
        ),
      ),
    PREDICTION_CACHE_POLICIES.trades,
  );

  return rows
    .map((row, index): PredictionTrade | null => {
      const price = centsToPrice(row.price);
      const timestamp = new Date(row.timestamp ?? "").getTime();
      if (price == null || !Number.isFinite(timestamp)) return null;
      const takerNo = row.side?.trim().toLowerCase() === "no";
      return {
        id: row.trade_id ?? `${summary.key}:${timestamp}:${index}`,
        timestamp,
        side: takerNo ? "sell" : "buy",
        outcome: takerNo ? "no" : "yes",
        price,
        size: parseFloatSafe(row.count) ?? 0,
      };
    })
    .filter((trade): trade is PredictionTrade => trade != null);
}

function buildSiblings(event: AdjacentEventResponse | null): PredictionSiblingMarket[] {
  return (event?.markets ?? [])
    .map((row) => mapAdjacentKalshiMarket(row))
    .filter((market): market is PredictionMarketSummary => market != null)
    .map((market) => ({
      key: market.key,
      marketId: market.marketId,
      label: market.marketLabel,
      yesPrice: market.yesPrice,
      // Event rows carry lifetime volume only; 24h is absent.
      volume24h: market.volume24h ?? market.totalVolume,
    }));
}

export async function loadHostedAdjacentKalshiDetail(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionMarketDetail> {
  const [detail, event, history, trades] = await Promise.all([
    fetchHostedAdjacentKalshiMarket(summary.marketId).catch(() => null),
    fetchHostedAdjacentKalshiEvent(summary.eventTicker).catch(() => null),
    loadHostedAdjacentKalshiHistory(summary, range).catch(() => []),
    loadHostedAdjacentKalshiTrades(summary).catch(() => []),
  ]);

  const merged: PredictionMarketSummary = {
    ...summary,
    ...(detail ?? {}),
    eventLabel: event?.name ?? detail?.eventLabel ?? summary.eventLabel,
    category: event?.category ?? detail?.category ?? summary.category,
    tags: summary.tags?.length
      ? summary.tags
      : event?.category
        ? [event.category]
        : [],
  };

  return {
    summary: merged,
    siblings: buildSiblings(event),
    rules: [merged.rulesPrimary ?? "", merged.rulesSecondary ?? ""].filter(
      (value) => value.trim().length > 0,
    ),
    history,
    // Adjacent exposes no order book, and Kalshi's own is unreachable from the
    // hosted Worker. An empty book renders as "no depth" rather than failing.
    book: {
      yesBids: [],
      yesAsks: [],
      noBids: [],
      noAsks: [],
      lastTradePrice: merged.lastTradePrice,
    },
    trades,
  };
}
