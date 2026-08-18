import { usePaneFooter } from "../../../components";
import { isPlainKey } from "../../../utils/keyboard";
import { useShortcut } from "../../../react/input";
import {
  quoteBoardFooterInfo,
  quoteBoardStatus,
  type BoardQuoteMap,
} from "../shared/use-quote-board";

export function useWorldIndicesFooter(quotes: BoardQuoteMap, onRefresh: () => void, focused: boolean) {
  const status = quoteBoardStatus(quotes);

  useShortcut((event) => {
    if (!focused || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    onRefresh();
  }, { enabled: focused });

  usePaneFooter(
    "world-indices",
    () => ({ info: quoteBoardFooterInfo(status) }),
    [focused, onRefresh, status.latestTs, status.loading, status.stale, status.unavailable],
  );
}
