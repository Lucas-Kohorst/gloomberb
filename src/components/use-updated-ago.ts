import { useEffect, useState } from "react";
import { formatApproximateAge } from "../utils/relative-time";

/**
 * Returns a compact "~5m" age label for a timestamp that re-renders every
 * minute so the count increments without another fetch. Returns null when no
 * timestamp is provided.
 */
export function useUpdatedAgo(timestamp: number | null | undefined): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timestamp) return;
    const interval = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, [timestamp]);
  if (!timestamp) return null;
  return formatApproximateAge(timestamp);
}
