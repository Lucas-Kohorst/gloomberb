import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import type { InstrumentRef } from "../../market-data/request-types";
import type { Quote } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { withDeadline } from "../../utils/async-deadline";
import { subscribePolymarketMarket } from "./services/polymarket/ws";
import { resolvePolymarketMarketById } from "./services/polymarket/detail";
import { extractPolymarketSlug } from "./services/polymarket/normalize";
import { fetchKalshiMarketByTicker } from "./services/kalshi/adapter";
import { normalizeKalshiMarket } from "./services/kalshi/normalize";
import { quoteFromBbo, quoteFromLastTrade } from "./controller/catalog-live";
import { stubSummaryFromTicker } from "./collection-watchlist";
import type { PredictionMarketSummary, PredictionVenue } from "./types";

const KALSHI_POLL_INTERVAL_MS = 10_000;
const KALSHI_POLL_CONCURRENCY = 4;
// Each market needs its own budget; a shared deadline silently starves later
// markets of the yesTokenId required for their live subscription.
const POLYMARKET_RESOLVE_TIMEOUT_PER_MARKET_MS = 15_000;

/** Prediction-market ticker metadata stored on the watchlist TickerRecord. */
export interface PredictionTickerInfo {
  symbol: string;
  exchange: string;
  marketKey: string;
  venue: PredictionVenue;
  marketId: string;
}

function predictionTickerInfo(ticker: TickerRecord): PredictionTickerInfo | null {
  const summary = stubSummaryFromTicker(ticker);
  if (!summary) return null;
  return {
    symbol: ticker.metadata.ticker,
    exchange: summary.venue === "kalshi" ? "KALSHI" : "POLYMARKET",
    marketKey: summary.key,
    venue: summary.venue,
    marketId: summary.marketId,
  };
}

function liveTargetKey(infos: PredictionTickerInfo[]): string {
  return infos.map((info) => info.marketKey).sort().join("|");
}

function buildInstrument(info: PredictionTickerInfo): InstrumentRef {
  return {
    symbol: info.symbol,
    exchange: info.exchange,
  };
}

function quotesMatch(current: Quote | null | undefined, next: Quote): boolean {
  if (!current) return false;
  return current.price === next.price
    && current.bid === next.bid
    && current.ask === next.ask
    && current.change === next.change
    && current.changePercent === next.changePercent;
}

function buildQuote(
  info: PredictionTickerInfo,
  yesPrice: number | null,
  yesBid?: number | null,
  yesAsk?: number | null,
  previousYesPrice?: number | null,
  previousQuote?: Quote | null,
): Quote | null {
  if (yesPrice == null || !Number.isFinite(yesPrice)) return null;
  const change = previousYesPrice != null ? yesPrice - previousYesPrice : 0;
  const changePercent = previousYesPrice != null && previousYesPrice !== 0
    ? (change / previousYesPrice) * 100
    : 0;
  const bid = yesBid ?? undefined;
  const ask = yesAsk ?? undefined;
  const unchanged = previousQuote
    && previousQuote.price === yesPrice
    && previousQuote.bid === bid
    && previousQuote.ask === ask
    && previousQuote.change === change
    && previousQuote.changePercent === changePercent;
  const now = Date.now();
  return {
    symbol: info.symbol,
    providerId: info.venue,
    price: yesPrice,
    currency: "USD",
    change,
    changePercent,
    bid,
    ask,
    dataSource: "live",
    delivery: info.venue === "polymarket" ? "stream" : "poll",
    lastUpdated: unchanged ? previousQuote.lastUpdated : now,
    receivedAt: unchanged ? previousQuote.receivedAt : now,
  };
}

interface PriceTracker {
  previous: Map<string, number>;
  current: Map<string, number>;
  quotes: Map<string, Quote>;
}

function emptyPriceTracker(): PriceTracker {
  return { previous: new Map(), current: new Map(), quotes: new Map() };
}

function rollPriceTracker(tracker: PriceTracker): PriceTracker {
  return { previous: tracker.current, current: new Map(), quotes: tracker.quotes };
}

function pushWatchlistQuote(
  info: PredictionTickerInfo,
  quote: Quote,
  coordinator: NonNullable<ReturnType<typeof getSharedMarketDataCoordinator>>,
  tracker: PriceTracker,
): void {
  const previousQuote = tracker.quotes.get(info.symbol);
  if (quotesMatch(previousQuote, quote)) return;
  tracker.current.set(info.symbol, quote.price);
  tracker.quotes.set(info.symbol, quote);
  coordinator.pushQuote(buildInstrument(info), quote);
}

function midYesPrice(
  yesBid: number | null,
  yesAsk: number | null,
  fallback: number | null | undefined,
): number | null {
  if (yesBid != null && yesAsk != null) return (yesBid + yesAsk) / 2;
  return fallback ?? null;
}

/**
 * Subscribe to Polymarket CLOB WS for the given markets and push quotes
 * into the coordinator.  Returns an unsubscribe function.
 */
function subscribePolymarketWatchlistQuotes(
  infos: PredictionTickerInfo[],
  summaries: Map<string, PredictionMarketSummary>,
  coordinator: NonNullable<ReturnType<typeof getSharedMarketDataCoordinator>>,
  priceTrackerRef: MutableRefObject<PriceTracker>,
): () => void {
  const tokenToInfo = new Map<string, PredictionTickerInfo>();
  const assetIds: string[] = [];

  for (const info of infos) {
    const summary = summaries.get(info.marketKey);
    const yesTokenId = summary?.yesTokenId;
    if (!yesTokenId) continue;
    tokenToInfo.set(yesTokenId, info);
    assetIds.push(yesTokenId);
    if (summary.noTokenId) {
      tokenToInfo.set(summary.noTokenId, info);
      assetIds.push(summary.noTokenId);
    }
  }

  if (assetIds.length === 0) return () => {};

  const flush = (info: PredictionTickerInfo, quote: Quote) => {
    pushWatchlistQuote(info, quote, coordinator, priceTrackerRef.current);
  };

  return subscribePolymarketMarket(assetIds, {
    onBestBidAsk: (assetId, bestBid, bestAsk, spread) => {
      const info = tokenToInfo.get(assetId);
      if (!info) return;
      const summary = summaries.get(info.marketKey);
      if (!summary) return;
      const isYes = assetId === summary.yesTokenId;
      const quoteUpdate = quoteFromBbo(isYes, bestBid, bestAsk, spread);
      const yesBid = quoteUpdate.yesBid ?? null;
      const yesAsk = quoteUpdate.yesAsk ?? null;
      const mid = midYesPrice(yesBid, yesAsk, summary.yesPrice);
      const previous = priceTrackerRef.current.previous.get(info.symbol);
      const quote = buildQuote(
        info,
        mid,
        yesBid,
        yesAsk,
        previous,
        priceTrackerRef.current.quotes.get(info.symbol),
      );
      if (quote) flush(info, quote);
    },
    onTrade: (assetId, trade) => {
      const info = tokenToInfo.get(assetId);
      if (!info) return;
      const summary = summaries.get(info.marketKey);
      if (!summary) return;
      const isYes = assetId === summary.yesTokenId;
      const yesPrice = quoteFromLastTrade(isYes, trade.price).yesPrice ?? null;
      const previous = priceTrackerRef.current.previous.get(info.symbol);
      const quote = buildQuote(
        info,
        yesPrice,
        undefined,
        undefined,
        previous,
        priceTrackerRef.current.quotes.get(info.symbol),
      );
      if (quote) flush(info, quote);
    },
  });
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

/**
 * Poll Kalshi markets and push quotes into the coordinator.
 */
function pollKalshiWatchlistQuotes(
  infos: PredictionTickerInfo[],
  coordinator: NonNullable<ReturnType<typeof getSharedMarketDataCoordinator>>,
  priceTrackerRef: MutableRefObject<PriceTracker>,
): () => void {
  if (infos.length === 0) return () => {};

  let cancelled = false;
  // A slow pass must not overlap the next tick against Kalshi's rate-limited API.
  let inFlight = false;

  const poll = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try {
      await mapPool(infos, KALSHI_POLL_CONCURRENCY, async (info) => {
        if (cancelled) return;
        try {
          const record = await fetchKalshiMarketByTicker(info.marketId);
          if (!record || cancelled) return;
          const summary = normalizeKalshiMarket(record, undefined, { allowDormant: true });
          if (!summary) return;
          const previous = priceTrackerRef.current.previous.get(info.symbol);
          const quote = buildQuote(
            info,
            summary.lastTradePrice ?? summary.yesPrice,
            summary.yesBid,
            summary.yesAsk,
            previous,
            priceTrackerRef.current.quotes.get(info.symbol),
          );
          if (quote) pushWatchlistQuote(info, quote, coordinator, priceTrackerRef.current);
        } catch {
          // Best-effort poll; failures are silent.
        }
      });
    } finally {
      inFlight = false;
    }
  };

  void poll();
  const intervalId = setInterval(() => void poll(), KALSHI_POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}

export async function resolvePolymarketSummaries(
  infos: PredictionTickerInfo[],
  timeoutMs = POLYMARKET_RESOLVE_TIMEOUT_PER_MARKET_MS,
): Promise<Map<string, PredictionMarketSummary>> {
  const result = new Map<string, PredictionMarketSummary>();
  const polymarketInfos = infos.filter((info) => info.venue === "polymarket");
  await Promise.all(polymarketInfos.map(async (info) => {
    const slug = extractPolymarketSlug(info.marketId) ?? info.marketId;
    try {
      const summary = await withDeadline(
        resolvePolymarketMarketById(slug),
        timeoutMs,
        `Timed out resolving Polymarket market ${info.marketId}`,
      );
      if (!summary) return;
      result.set(info.marketKey, summary);
      result.set(`${info.venue}:${info.marketId}`, summary);
    } catch {
      // Best-effort resolution; skip on failure.
    }
  }));
  return result;
}

/**
 * Hook that bridges prediction-market live odds into the market-data
 * coordinator so watchlist rows with POLY:/KALSHI: tickers show live odds.
 *
 * This runs independently of the PM pane focus state — as long as the
 * portfolio-list pane is mounted and has PM tickers in the active
 * collection, the bridge keeps WS/poll subscriptions alive.
 */
export function usePredictionWatchlistQuotes(
  tickers: TickerRecord[],
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const coordinator = getSharedMarketDataCoordinator();
  const priceTrackerRef = useRef<PriceTracker>(emptyPriceTracker());

  const pmTickers = useMemo(() => {
    if (!enabled) return [];
    return tickers
      .map(predictionTickerInfo)
      .filter((info): info is PredictionTickerInfo => info != null);
  }, [tickers, enabled]);

  const polymarketInfos = useMemo(
    () => pmTickers.filter((info) => info.venue === "polymarket"),
    [pmTickers],
  );
  const kalshiInfos = useMemo(
    () => pmTickers.filter((info) => info.venue === "kalshi"),
    [pmTickers],
  );
  const polymarketKey = useMemo(() => liveTargetKey(polymarketInfos), [polymarketInfos]);
  const kalshiKey = useMemo(() => liveTargetKey(kalshiInfos), [kalshiInfos]);
  const polymarketInfosRef = useRef(polymarketInfos);
  polymarketInfosRef.current = polymarketInfos;
  const kalshiInfosRef = useRef(kalshiInfos);
  kalshiInfosRef.current = kalshiInfos;

  useEffect(() => {
    if (!coordinator || polymarketKey.length === 0) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void resolvePolymarketSummaries(polymarketInfosRef.current).then((summaries) => {
      if (cancelled) return;
      priceTrackerRef.current = rollPriceTracker(priceTrackerRef.current);
      unsubscribe = subscribePolymarketWatchlistQuotes(
        polymarketInfosRef.current,
        summaries,
        coordinator,
        priceTrackerRef,
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [coordinator, polymarketKey]);

  useEffect(() => {
    if (!coordinator || kalshiKey.length === 0) return;
    priceTrackerRef.current = rollPriceTracker(priceTrackerRef.current);
    return pollKalshiWatchlistQuotes(kalshiInfosRef.current, coordinator, priceTrackerRef);
  }, [coordinator, kalshiKey]);
}
