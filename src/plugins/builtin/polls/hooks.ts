import { useEffect, useState } from "react";

function formatApproximateAge(timestamp: number | null | undefined, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "~0m";
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "~0m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `~${days}d`;
  const weeks = Math.floor(days / 7);
  return `~${weeks}w`;
}

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

interface StackSortPreference<C extends string> {
  columnId: C;
  direction: "asc" | "desc";
}

/**
 * Cycles a table's sort preference when a header is clicked: toggles direction
 * on the active column, otherwise switches to the new column at its default
 * direction.
 */
export function nextStackSortPreference<C extends string>(
  current: StackSortPreference<C>,
  columnId: C,
  defaultDirection: "asc" | "desc" = "desc",
): StackSortPreference<C> {
  if (current.columnId === columnId) {
    return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { columnId, direction: defaultDirection };
}
