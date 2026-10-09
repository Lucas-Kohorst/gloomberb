import type { PaneFooterSegment } from "../../../components/layout/pane/footer";
import { hasValidQuoteObservationTime, isQuoteStaleForCurrentSession } from "../../../market-data/quotes/freshness";
import type { Quote } from "../../../types/financials";
import { formatApproximateAge } from "../../../utils/datetime-format";

export function tickerQuoteFooterInfo(
  quote: Quote | undefined,
  access: PaneFooterSegment | null,
  _width?: number,
): PaneFooterSegment[] {
  const info: PaneFooterSegment[] = [];
  if (quote && isQuoteStaleForCurrentSession(quote) && hasValidQuoteObservationTime(quote)) {
    info.push({
      id: "ticker-research-stale",
      parts: [{ text: formatApproximateAge(quote.lastUpdated), tone: "muted" }],
    });
  }
  if (access) info.push(access);
  return info;
}
