import { useMemo } from "react";
import { usePaneFooter, type PaneHint } from "../../../components";

export function useConnectionsFooter({ onRefresh }: { onRefresh: () => void }) {
  const hints = useMemo<PaneHint[]>(() => [
    { id: "refresh", key: "r", label: "efresh", onPress: onRefresh },
  ], [onRefresh]);

  usePaneFooter("connections", () => ({
    hints,
  }), [hints]);
}
