import { isPlainKey } from "../../../utils/keyboard";
import { useShortcut } from "../../../react/input";

export function useConnectionsFooter({ onRefresh }: { onRefresh: () => void }) {
  useShortcut((event) => {
    if (event.targetEditable || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    onRefresh();
  });
}
