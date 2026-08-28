import { useEffect, useMemo, useRef } from "react";
import { updatePredictionCatalogCacheEntries } from "../cache";
import { subscribePolymarketMarket } from "../services/polymarket/ws";
import type { PredictionListRow } from "../types";
import type { PredictionCatalogCacheSetter } from "./catalog";
import {
  POLYMARKET_LIVE_FLUSH_MS,
  applyPredictionSummaryQuote,
  type PredictionCatalogQuote,
} from "./live-updates";

export const MAX_PREDICTION_CATALOG_LIVE_MARKETS = 48;

export interface PredictionCatalogLiveTarget {
  key: string;
  yesTokenId: string;
  noTokenId?: string;
}

export function collectPredictionCatalogLiveTargets(
  rows: readonly PredictionListRow[],
  limit = MAX_PREDICTION_CATALOG_LIVE_MARKETS,
): PredictionCatalogLiveTarget[] {
  const targets: PredictionCatalogLiveTarget[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const summary = row.representative;
    if (summary.venue !== "polymarket" || !summary.yesTokenId) continue;
    if (seen.has(summary.key)) continue;
    seen.add(summary.key);
    targets.push({
      key: summary.key,
      yesTokenId: summary.yesTokenId,
      noTokenId: summary.noTokenId,
    });
    if (targets.length >= limit) break;
  }
  return targets;
}

export function liveTargetSignature(targets: readonly PredictionCatalogLiveTarget[]): string {
  return targets
    .map((target) => `${target.key}:${target.yesTokenId}`)
    .sort()
    .join("|");
}

function quoteFromLastTrade(isYes: boolean, price: number): PredictionCatalogQuote {
  const yesPrice = isYes ? price : Math.max(0, 1 - price);
  return { yesPrice, lastTradePrice: yesPrice };
}

export function quoteFromBbo(
  isYes: boolean,
  bestBid: number | null,
  bestAsk: number | null,
  spread: number | null,
): PredictionCatalogQuote {
  const yesBid = isYes ? bestBid : (bestAsk == null ? null : Math.max(0, 1 - bestAsk));
  const yesAsk = isYes ? bestAsk : (bestBid == null ? null : Math.max(0, 1 - bestBid));
  return {
    yesBid,
    yesAsk,
    spread: spread ?? (yesBid != null && yesAsk != null ? yesAsk - yesBid : null),
  };
}

export function usePredictionCatalogLiveQuotes({
  enabled,
  rows,
  setCatalogCache,
}: {
  enabled: boolean;
  rows: readonly PredictionListRow[];
  setCatalogCache: PredictionCatalogCacheSetter;
}): boolean {
  const targets = useMemo(
    () => enabled ? collectPredictionCatalogLiveTargets(rows) : [],
    [enabled, rows],
  );
  const pendingRef = useRef(new Map<string, PredictionCatalogQuote>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushAtRef = useRef(0);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const signature = liveTargetSignature(targets);

  useEffect(() => {
    const liveTargets = targetsRef.current;
    if (liveTargets.length === 0) return;

    const byToken = new Map<string, { key: string; isYes: boolean }>();
    const assetIds: string[] = [];
    for (const target of liveTargets) {
      byToken.set(target.yesTokenId, { key: target.key, isYes: true });
      assetIds.push(target.yesTokenId);
      if (target.noTokenId) {
        byToken.set(target.noTokenId, { key: target.key, isYes: false });
        assetIds.push(target.noTokenId);
      }
    }

    const flush = () => {
      flushTimerRef.current = null;
      lastFlushAtRef.current = Date.now();
      const pending = pendingRef.current;
      if (pending.size === 0) return;
      pendingRef.current = new Map();
      setCatalogCache((current) => {
        let next = current;
        for (const [marketKey, quote] of pending) {
          next = updatePredictionCatalogCacheEntries(next, marketKey, (summary) => (
            applyPredictionSummaryQuote(summary, quote)
          ));
        }
        return next;
      });
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current != null) return;
      const elapsed = lastFlushAtRef.current === 0
        ? Number.POSITIVE_INFINITY
        : Date.now() - lastFlushAtRef.current;
      const delay = elapsed >= POLYMARKET_LIVE_FLUSH_MS
        ? 0
        : POLYMARKET_LIVE_FLUSH_MS - elapsed;
      flushTimerRef.current = setTimeout(flush, delay);
    };

    const queueQuote = (assetId: string, quote: PredictionCatalogQuote) => {
      const target = byToken.get(assetId);
      if (!target) return;
      const current = pendingRef.current.get(target.key) ?? {};
      pendingRef.current.set(target.key, { ...current, ...quote });
      scheduleFlush();
    };

    const unsubscribe = subscribePolymarketMarket(assetIds, {
      onBestBidAsk: (assetId, bestBid, bestAsk, spread) => {
        const target = byToken.get(assetId);
        if (!target) return;
        queueQuote(assetId, quoteFromBbo(target.isYes, bestBid, bestAsk, spread));
      },
      onTrade: (assetId, trade) => {
        const target = byToken.get(assetId);
        if (!target) return;
        queueQuote(assetId, quoteFromLastTrade(target.isYes, trade.price));
      },
    });

    return () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingRef.current = new Map();
      unsubscribe();
    };
  }, [setCatalogCache, signature]);

  return targets.length > 0;
}
