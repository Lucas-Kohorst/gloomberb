import { useEffect, useState } from "react";
import type { AdjacentClient } from "../../builtin/adjacent/client";
import type { AdjacentMarket } from "../../builtin/adjacent/types";

const TITLE_MATCH_PREFIX = 20;

/**
 * Adjacent market search is intentionally uncached in the client, so the
 * similar and news tabs would each re-search on every visit. Both tabs share
 * this resolver instead: one lookup per market title for the session.
 */
const resolvedIds = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function bestAdjacentMatch(
  markets: readonly AdjacentMarket[],
  marketTitle: string,
): string | null {
  const needle = marketTitle.toLowerCase();
  const match = markets.find((market) => {
    const title = market.title.toLowerCase();
    return (
      title.includes(needle.slice(0, TITLE_MATCH_PREFIX)) ||
      needle.includes(title.slice(0, TITLE_MATCH_PREFIX))
    );
  });
  return match?.id ?? markets[0]?.id ?? null;
}

export function resolveAdjacentMarketId(
  client: AdjacentClient,
  marketTitle: string,
): Promise<string | null> {
  const cacheKey = marketTitle.trim().toLowerCase();
  const resolved = resolvedIds.get(cacheKey);
  if (resolved !== undefined) return Promise.resolve(resolved);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const lookup = client
    .searchMarkets(marketTitle, 5)
    .then((response) => {
      const id = bestAdjacentMatch(response.markets ?? [], marketTitle);
      resolvedIds.set(cacheKey, id);
      return id;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, lookup);
  return lookup;
}

export interface AdjacentMarketMatch {
  marketId: string | null;
  loading: boolean;
  error: string | null;
}

export function useAdjacentMarketMatch(
  client: AdjacentClient | null,
  marketTitle: string,
): AdjacentMarketMatch {
  const [match, setMatch] = useState<AdjacentMarketMatch>({
    marketId: null,
    loading: !!client && !!marketTitle,
    error: null,
  });

  useEffect(() => {
    if (!client || !marketTitle) {
      setMatch({ marketId: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setMatch({ marketId: null, loading: true, error: null });
    resolveAdjacentMarketId(client, marketTitle)
      .then((marketId) => {
        if (!cancelled) setMatch({ marketId, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMatch({
          marketId: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, marketTitle]);

  return match;
}
