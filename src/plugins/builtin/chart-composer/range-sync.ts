import type { ChartResolution, TimeRange } from "../../../time-series/range";
import type { ChartSpec } from "../../../time-series/types";

/**
 * Session-scoped pub/sub that keeps chart surfaces resolving the same ticker on
 * one another's time range, interval, and navigation window. The store is
 * deliberately module-level renderer-neutral state: it coordinates live panes
 * inside one renderer process, never persists, and every apply rides the
 * receiving pane's existing chartSpec persistence path.
 */

/** Committed pan/zoom window, serialized so it can travel between panes. */
export interface ChartRangeSyncWindow {
  start: string;
  end: string;
}

export interface ChartRangeSyncUpdate {
  ticker: string;
  range: TimeRange;
  interval: ChartResolution;
  /**
   * Carried when the change came from chart navigation: the committed pan/zoom
   * window, or null when the user reset to the authored viewport. Undefined
   * when only the authored range or interval changed, so receiving panes keep
   * their own reset-on-range-change behavior.
   */
  window?: ChartRangeSyncWindow | null;
  originPaneId: string;
}

export interface ChartRangeSyncSubscriber {
  paneId: string;
  apply(update: ChartRangeSyncUpdate): void;
}

const subscribersByTicker = new Map<string, Set<ChartRangeSyncSubscriber>>();
let applyingDepth = 0;

/**
 * Tickers arrive from cursor symbols and pane bindings, which trim and case
 * differently depending on the source pane, so compare them case-insensitively.
 */
export function chartRangeSyncTickerKey(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function subscribeChartRangeSync(
  ticker: string,
  subscriber: ChartRangeSyncSubscriber,
): () => void {
  const key = chartRangeSyncTickerKey(ticker);
  const existing = subscribersByTicker.get(key);
  const subscribers = existing ?? new Set<ChartRangeSyncSubscriber>();
  if (!existing) subscribersByTicker.set(key, subscribers);
  subscribers.add(subscriber);
  return () => {
    const current = subscribersByTicker.get(key);
    if (!current?.delete(subscriber)) return;
    if (current.size === 0) subscribersByTicker.delete(key);
  };
}

/**
 * Fan an update out to every live pane resolving the same ticker, except the
 * origin. Applies run with reentrancy guarded: anything a subscriber publishes
 * while applying is dropped, so a synced apply can never echo back out.
 */
export function publishChartRangeSync(update: ChartRangeSyncUpdate): void {
  if (applyingDepth > 0) return;
  const subscribers = subscribersByTicker.get(chartRangeSyncTickerKey(update.ticker));
  if (!subscribers) return;
  const targets = [...subscribers].filter((subscriber) => subscriber.paneId !== update.originPaneId);
  if (targets.length === 0) return;
  applyingDepth += 1;
  try {
    for (const target of targets) {
      try {
        target.apply(update);
      } catch (error) {
        console.error("[chart-composer] failed to apply synced chart range", target.paneId, error);
      }
    }
  } finally {
    applyingDepth -= 1;
  }
}

/**
 * Merge a synced range/interval into a pane's chart spec, mirroring the
 * toolbar's own edits: a range change drops authored date windows and point
 * caps, an interval-only change keeps them. Returns null when the spec already
 * matches so applies never rewrite unchanged settings.
 */
export function mergeSyncedChartViewport(spec: ChartSpec, update: ChartRangeSyncUpdate): ChartSpec | null {
  const rangeChanged = spec.viewport.range !== update.range;
  if (!rangeChanged && spec.viewport.resolution === update.interval) return null;
  return {
    ...spec,
    viewport: {
      ...spec.viewport,
      range: update.range,
      resolution: update.interval,
      ...(rangeChanged ? { dateWindow: undefined, maxPoints: undefined } : {}),
    },
  };
}

/** Parse a transported window into dates; null when the window is invalid. */
export function chartRangeSyncWindowDates(window: ChartRangeSyncWindow): { start: Date; end: Date } | null {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return Number.isFinite(start) && Number.isFinite(end) && start < end
    ? { start: new Date(start), end: new Date(end) }
    : null;
}
