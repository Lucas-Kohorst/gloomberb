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
 * The timer runs on the interval itself rather than a faster poll: a load
 * that failed is retried on the next tick, and a load that succeeded early
 * is left alone.
 */
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
    const tick = () => {
      if (cancelled) return;
      const previous = lastUpdatedRef.current;
      if (previous && Date.now() - previous < intervalMs) return;
      if (shouldYieldToUi()) {
        void whenUiQuiet().then(tick);
        return;
      }
      refreshRef.current();
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [resolvedMinutes]);
}
