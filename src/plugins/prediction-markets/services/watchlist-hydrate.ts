import { useEffect, useRef, useState } from "react";
import type { PredictionMarketSummary } from "../types";
import { overlayKalshiVenueStatsOnSearch } from "./kalshi/search-hydrate";
import { overlayGammaStatsOnPolymarketSearch } from "./polymarket/search-hydrate";

const WATCHLIST_HYDRATE_POLL_MS = 10_000;

export async function overlayVenueStatsOnSummaries(
  markets: PredictionMarketSummary[],
  signal?: AbortSignal,
): Promise<PredictionMarketSummary[]> {
  const withPolymarket = await overlayGammaStatsOnPolymarketSearch(markets, signal);
  return overlayKalshiVenueStatsOnSearch(withPolymarket, signal);
}

function watchlistHydrateKey(markets: readonly PredictionMarketSummary[]): string {
  return markets.map((market) => market.key).join("|");
}

export function useWatchlistVenueHydration(
  markets: PredictionMarketSummary[],
  enabled: boolean,
): PredictionMarketSummary[] {
  const [hydrated, setHydrated] = useState(markets);
  const marketsRef = useRef(markets);
  marketsRef.current = markets;
  const key = watchlistHydrateKey(markets);

  useEffect(() => {
    if (!enabled) {
      setHydrated(marketsRef.current);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const run = async () => {
      try {
        const next = await overlayVenueStatsOnSummaries(marketsRef.current, controller.signal);
        if (!cancelled) setHydrated(next);
      } catch {
        // Keep the last painted snapshots if Kalshi/Gamma miss a tick.
      }
    };
    setHydrated(marketsRef.current);
    void run();
    const intervalId = setInterval(() => void run(), WATCHLIST_HYDRATE_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(intervalId);
    };
  }, [enabled, key]);

  return enabled ? hydrated : markets;
}
