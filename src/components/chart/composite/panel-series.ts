import type { ResolvedSeries } from "../../../time-series/types";

/**
 * Groups series by panelId. When `previous` is supplied, reuses each panel's
 * array identity if the member series refs are unchanged — so consumers that
 * key off array identity (TradingView sync) do not treat a parent re-group as
 * new data.
 */
export function groupSeriesByPanelId(
  series: readonly ResolvedSeries[],
  previous?: ReadonlyMap<string, readonly ResolvedSeries[]>,
): Map<string, ResolvedSeries[]> {
  const grouped = new Map<string, ResolvedSeries[]>();
  for (const entry of series) {
    const list = grouped.get(entry.panelId);
    if (list) list.push(entry);
    else grouped.set(entry.panelId, [entry]);
  }
  if (!previous || previous.size === 0) return grouped;

  const next = new Map<string, ResolvedSeries[]>();
  for (const [panelId, members] of grouped) {
    const prior = previous.get(panelId);
    if (
      prior
      && prior.length === members.length
      && prior.every((entry, index) => entry === members[index])
    ) {
      next.set(panelId, prior as ResolvedSeries[]);
    } else {
      next.set(panelId, members);
    }
  }
  return next;
}
