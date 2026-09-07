import { useEffect, useState } from "react";
import { formatRelativeAge } from "../../../utils/relative-time";
import { useAutoRefresh as useCadenceAutoRefresh } from "./use-auto-refresh";

/** The label only changes once a minute, so a coarse tick is enough. */
export const AGE_TICK_MS = 30_000;

/**
 * How old a pane's data is, as a footer-ready label that keeps ageing on its
 * own. Returns null before the first successful load so callers can leave the
 * footer empty instead of claiming a freshness they do not have.
 */
export function useUpdatedAgo(lastUpdated: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  return lastUpdated ? formatRelativeAge(lastUpdated, now) : null;
}

/**
 * Re-pull a pane once its data is older than the global refresh interval.
 * Override-capable callers should import `use-auto-refresh.ts` instead.
 */
export function useAutoRefresh(lastUpdated: number | null, refresh: () => void): void {
  useCadenceAutoRefresh(lastUpdated, refresh);
}
