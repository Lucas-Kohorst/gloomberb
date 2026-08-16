import { useShortcut } from "../../../react/input";

export function useConnectionsKeyboard({
  focused,
  detailOpen,
  hasSelection,
  onRefresh,
  onOpenDetail,
  onBack,
}: {
  focused: boolean;
  detailOpen: boolean;
  hasSelection: boolean;
  onRefresh: () => void;
  onOpenDetail: () => void;
  onBack: () => void;
}) {
  useShortcut((event) => {
    if (!focused) return;

    if (detailOpen && event.name === "escape") {
      event.stopPropagation();
      onBack();
      return;
    }

    if (!detailOpen) {
      if (event.name === "enter" || event.name === "return") {
        if (hasSelection) {
          event.stopPropagation();
          event.preventDefault?.();
          onOpenDetail();
        }
        return;
      }
      if (event.name === "r") {
        onRefresh();
        return;
      }
    }
  });
}
