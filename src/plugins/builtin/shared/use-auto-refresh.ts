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
 * that succeeded early waits only the remaining freshness. A failed or
 * deferred tick rechecks on a 1m watchdog instead of sleeping another interval.
 */

/** Recheck overdue polls this often so a throttled 15m timeout cannot sit ~2 intervals stale. */
export const AUTO_REFRESH_WATCHDOG_MS = 60_000;
/** Typing / Command-K can hold yield; do not let that starve a due poll forever. */
export const AUTO_REFRESH_YIELD_MAX_MS = 5_000;

export function nextAutoRefreshDelayMs(
  lastUpdated: number | null,
  intervalMs: number,
  now = Date.now(),
): number {
  if (!(intervalMs > 0)) return 0;
  if (!lastUpdated) return intervalMs;
  return Math.max(0, intervalMs - (now - lastUpdated));
}

/** Cap a long poll sleep so background-throttled timers still notice overdue data. */
export function nextAutoRefreshWakeMs(
  lastUpdated: number | null,
  intervalMs: number,
  now = Date.now(),
  watchdogMs = AUTO_REFRESH_WATCHDOG_MS,
): number {
  return Math.min(nextAutoRefreshDelayMs(lastUpdated, intervalMs, now), watchdogMs);
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
    let yieldStartedAt = 0;

    const arm = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, Math.max(0, delay));
    };

    const tick = () => {
      if (cancelled) return;
      const remaining = nextAutoRefreshDelayMs(lastUpdatedRef.current, intervalMs);
      if (remaining > 0) {
        yieldStartedAt = 0;
        arm(nextAutoRefreshWakeMs(lastUpdatedRef.current, intervalMs));
        return;
      }
      if (shouldYieldToUi()) {
        if (!yieldStartedAt) yieldStartedAt = Date.now();
        if (Date.now() - yieldStartedAt < AUTO_REFRESH_YIELD_MAX_MS) {
          void whenUiQuiet().then(tick);
          arm(AUTO_REFRESH_YIELD_MAX_MS);
          return;
        }
      }
      yieldStartedAt = 0;
      refreshRef.current();
      // lastUpdated updates asynchronously. Recheck on the watchdog so a
      // failed fetch retries in a minute instead of sleeping another interval.
      arm(AUTO_REFRESH_WATCHDOG_MS);
    };

    arm(nextAutoRefreshWakeMs(lastUpdatedRef.current, intervalMs));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lastUpdated, resolvedMinutes]);
}
