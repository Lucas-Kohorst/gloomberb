import { usePaneFooter, type PaneFooterSegment } from "../../../components";
import { isPlainKey } from "../../../utils/keyboard";
import { useShortcut } from "../../../react/input";
import {
  quoteBoardFooterInfo,
  quoteBoardStatus,
  type BoardQuoteMap,
} from "../shared/use-quote-board";

/** The reason a board is empty, taken from the per-symbol errors the board records. */
export function boardErrorMessage(quotes: BoardQuoteMap): string | null {
  let total = 0;
  let unavailable = 0;
  let message: string | null = null;
  for (const state of quotes.values()) {
    total += 1;
    if (state.quote || state.loading) continue;
    unavailable += 1;
    message ??= state.error;
  }
  if (total === 0 || unavailable < total || !message) return null;
  return message;
}

export function useWorldIndicesFooter(quotes: BoardQuoteMap, onRefresh: () => void, focused: boolean) {
  const status = quoteBoardStatus(quotes);
  const errorMessage = boardErrorMessage(quotes);

  useShortcut((event) => {
    if (!focused || event.targetEditable || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    onRefresh();
  }, { allowEditable: true, enabled: focused });

  usePaneFooter(
    "world-indices",
    () => {
      const info: PaneFooterSegment[] = quoteBoardFooterInfo(status);
      if (errorMessage) info.push({ id: "reason", parts: [{ text: errorMessage, tone: "warning" }] });
      return {
        info,
        hints: [
          { id: "refresh", key: "r", label: "efresh", onPress: onRefresh },
        ],
      };
    },
    [errorMessage, focused, onRefresh, status.latestTs, status.loading, status.stale, status.unavailable],
  );
}
