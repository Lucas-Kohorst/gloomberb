import { useEffect, useRef } from "react";
import { useAppSelector } from "../../../state/app/context";
import { shouldYieldToUi, whenUiQuiet } from "../../../utils/ui-yield";

/**
 * Re-pull a pane once its data is older than the global refresh interval
 * (`refreshIntervalMinutes`, RI), so network panes follow the cadence the
 * user already configured instead of each hardcoding its own.
 *
 * Pass `intervalMinutes` to use a per-pane override (TWIT uses 1m when live
 * polling is on, and 0 to disable the timer).
 * The next tick is scheduled from the data's age, not from mount: a load
 * that failed is retried after a full interval, and a load that succeeded
 * early waits only the remaining freshness.
 */
export function nextAutoRefreshDelayMs(
  lastUpdated: number | null,
  intervalMs: number,
  now = Date.now(),
): number {
  if (!(intervalMs > 0)) return 0;
  if (!lastUpdated) return intervalMs;
  return Math.max(0, intervalMs - (now - lastUpdated));
}

export function useAutoRefresh(
  lastUpdated: number | null,
  refresh: () => void,
  intervalMinutes?: number,
): void {
  const globalMinutes = useAppSelector((state) => state.config.refreshIntervalMinutes);
  const resolvedMinutes = intervalMinutes ?? globalMinutes;
  const refreshRef = useRef(refresh);
  const lastUpdatedRef = useRef(lastUpdated);
  refreshRef.current = refresh;
  lastUpdatedRef.current = lastUpdated;

  useEffect(() => {
    if (!(resolvedMinutes > 0)) return;
    const intervalMs = resolvedMinutes * 60_000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const delay = nextAutoRefreshDelayMs(lastUpdatedRef.current, intervalMs);
      timer = setTimeout(tick, delay);
    };

    const tick = () => {
      if (cancelled) return;
      const previous = lastUpdatedRef.current;
      if (previous && Date.now() - previous < intervalMs) {
        schedule();
        return;
      }
      if (shouldYieldToUi()) {
        void whenUiQuiet().then(tick);
        return;
      }
      refreshRef.current();
      // lastUpdated updates asynchronously, so wait a full interval before
      // checking again instead of treating the still-stale stamp as due now.
      timer = setTimeout(tick, intervalMs);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastUpdated, resolvedMinutes]);
}
