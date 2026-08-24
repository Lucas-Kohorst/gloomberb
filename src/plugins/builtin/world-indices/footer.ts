import { usePaneFooter, type PaneFooterSegment } from "../../../components";
import {
  countFailedQuotes,
  countLoadingQuotes,
  latestQuoteTimestamp,
  type BoardQuoteMap,
} from "../shared/use-quote-board";

export function useWorldIndicesFooter(quotes: BoardQuoteMap, onRefresh: () => void) {
  const loadingCount = countLoadingQuotes(quotes);
  const failedCount = countFailedQuotes(quotes);
  const latestQuoteTs = latestQuoteTimestamp(quotes);

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
      hints: [{ id: "refresh", key: "r", label: "efresh", onPress: onRefresh }],
    };
  }, [failedCount, latestQuoteTs, loadingCount, onRefresh]);
}
