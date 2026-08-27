import { usePaneFooter, type PaneFooterSegment } from "../../../components";
import { openUrl } from "../../../components/ui/external-link";
import {
  countFailedQuotes,
  countLoadingQuotes,
  latestQuoteTimestamp,
  type BoardQuoteMap,
} from "../shared/use-quote-board";

export function useWorldIndicesFooter(quotes: BoardQuoteMap, onRefresh: () => void, selectedSymbol: string | null) {
  const loadingCount = countLoadingQuotes(quotes);
  const failedCount = countFailedQuotes(quotes);
  const latestQuoteTs = latestQuoteTimestamp(quotes);
  const indexUrl = selectedSymbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(selectedSymbol)}` : null;

  usePaneFooter("world-indices", () => {
    const info: PaneFooterSegment[] = [];
    if (loadingCount > 0) {
      info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    }
    if (failedCount > 0) {
      info.push({
        id: "error",
        parts: [{ text: `${failedCount} failed`, tone: "warning" }],
      });
    }
    if (latestQuoteTs > 0) {
      info.push({
        id: "fresh",
        parts: [{
          text: new Date(latestQuoteTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          tone: "muted",
        }],
      });
    }
    return {
      info,
      hints: [
        ...(indexUrl ? [{ id: "open", key: "o", label: "pen", onPress: () => openUrl(indexUrl) }] : []),
        { id: "refresh", key: "r", label: "efresh", onPress: onRefresh },
      ],
    };
  }, [failedCount, indexUrl, latestQuoteTs, loadingCount, onRefresh]);
}
