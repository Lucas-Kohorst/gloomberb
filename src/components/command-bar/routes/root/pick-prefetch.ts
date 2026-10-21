import { useEffect, useRef } from "react";
import { getSharedMarketDataCoordinator } from "../../../../market-data/coordinator";
import type { InstrumentRef } from "../../../../market-data/request-types";
import { instrumentIdentityKey } from "../../../../utils/instrument-identity";
import type { ResultItem } from "../../list/model";

/** Typing passes through rows faster than this; reading the list and pressing Enter takes longer. */
const PICK_REST_MS = 200;

function warmInstrument(instrument: InstrumentRef): void {
  getSharedMarketDataCoordinator()?.warmTickerGaps(instrument);
}

/**
 * Warms the quote and chart of the instrument Enter would open once the pick
 * rests, so its pane paints with data instead of loading. Only the row Enter
 * runs, only an instrument row, and each instrument once per visit to the bar:
 * Gloom Cloud rate-limits the free plan.
 */
export function useRootPickPrefetch(
  pick: ResultItem | null | undefined,
  prefetch: (instrument: InstrumentRef) => void = warmInstrument,
): void {
  const instrument = pick?.prefetchInstrument ?? null;
  const latest = useRef(instrument);
  latest.current = instrument;
  const warmed = useRef(new Set<string>());
  const key = instrument ? instrumentIdentityKey(instrument) : null;

  useEffect(() => {
    if (!key || warmed.current.has(key)) return;
    const timer = setTimeout(() => {
      warmed.current.add(key);
      if (latest.current) prefetch(latest.current);
    }, PICK_REST_MS);
    return () => clearTimeout(timer);
  }, [key, prefetch]);
}
