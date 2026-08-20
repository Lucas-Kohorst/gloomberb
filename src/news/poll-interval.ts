/** Floor so a 1-minute setting cannot turn into a retry storm. */
export const MIN_NEWS_POLL_INTERVAL_MS = 15 * 1000;

export function newsPollIntervalMsFromMinutes(minutes: number): number {
  return Math.max(MIN_NEWS_POLL_INTERVAL_MS, Math.max(1, minutes) * 60_000);
}
