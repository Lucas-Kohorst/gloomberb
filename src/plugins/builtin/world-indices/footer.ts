import { usePaneFooter, usePaneLoadingSignal, type PaneFooterSegment } from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import {
  boardErrorMessage,
  quoteBoardFooterInfo,
  quoteBoardStatus,
  type BoardQuoteMap,
} from "../shared/use-quote-board";

export function useWorldIndicesFooter(quotes: BoardQuoteMap, onRefresh: () => void, focused: boolean) {
  const status = quoteBoardStatus(quotes);
  const errorMessage = boardErrorMessage(quotes);

  usePaneRefreshKey(onRefresh, { focused });
  usePaneLoadingSignal(status.loading > 0);

  usePaneFooter(
    "world-indices",
    () => {
      const info: PaneFooterSegment[] = quoteBoardFooterInfo(status);
      if (errorMessage) info.push({ id: "reason", parts: [{ text: errorMessage, tone: "warning" }] });
      return { info };
    },
    [errorMessage, focused, onRefresh, status.latestTs, status.loading, status.stale, status.unavailable],
  );
}
