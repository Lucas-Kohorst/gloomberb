import type { PaneFooterSegment } from "../../../components/layout/pane/footer";
import { hasValidQuoteObservationTime, isQuoteStaleForCurrentSession } from "../../../market-data/quotes/freshness";
import { formatQuoteNavAsOf } from "../../../market-data/quotes/time";
import type { Quote } from "../../../types/financials";
import { formatApproximateAge } from "../../../utils/datetime-format";

export function tickerQuoteFooterInfo(
  quote: Quote | undefined,
  access: PaneFooterSegment | null,
  _width?: number,
): PaneFooterSegment[] {
  const info: PaneFooterSegment[] = [];
  const navAsOf = formatQuoteNavAsOf(quote);
  if (quote && isQuoteStaleForCurrentSession(quote) && hasValidQuoteObservationTime(quote)) {
    const status: PaneFooterSegment = {
      id: "ticker-research-stale",
      parts: [{ text: formatApproximateAge(quote.lastUpdated), tone: "muted" }],
    };
    if (navAsOf) status.parts.push({ text: navAsOf, tone: "muted" });
    info.push(status);
  } else if (navAsOf) {
    info.push({ id: "ticker-research-nav", parts: [{ text: navAsOf, tone: "muted" }] });
  }
  if (access) info.push(access);
  return info;
}
