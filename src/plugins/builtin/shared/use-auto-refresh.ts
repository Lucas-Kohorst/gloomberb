import { useEffect, useRef } from "react";
import { useAppSelector } from "../../../state/app/context";

const CHECK_INTERVAL_MS = 30_000;

/**
 * When the global auto-refresh setting is enabled (non-zero), periodically
 * checks whether `lastUpdated` is older than the configured threshold and
 * calls `refresh` if so.  When the setting is off (0) this is a no-op.
 *
 * `refresh` is kept in a ref so callers do not need to memoize it, but
 * `lastUpdated` should be a real timestamp that changes when data is fetched.
 */
export function useAutoRefresh(
  lastUpdated: number | null,
  refresh: () => void,
): void {
  const intervalMinutes = useAppSelector((state) => state.config.autoRefreshInterval);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!intervalMinutes || intervalMinutes < 1) return;

    const intervalMs = intervalMinutes * 60_000;

    const timer = setInterval(() => {
      if (!lastUpdated || Date.now() - lastUpdated >= intervalMs) {
        refreshRef.current();
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [intervalMinutes, lastUpdated]);
}
