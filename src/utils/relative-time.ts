export function formatRelativeAge(timestamp: number | undefined, now = Date.now(), empty = "never"): string {
  if (!timestamp) return empty;
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return "just now";
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
}

/**
 * Approximate age formatting for pane footers: a compact "~5m" style label
 * that ticks up each minute. Future or invalid timestamps clamp to "~0m".
 */
export function formatApproximateAge(timestamp: number | null | undefined, now: number = Date.now()): string {
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
