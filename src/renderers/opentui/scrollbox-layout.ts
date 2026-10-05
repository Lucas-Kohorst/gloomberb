import type { BoxRenderable, ScrollBoxRenderable as NativeScrollBoxRenderable } from "@opentui/core";
import type { ScrollBoxRenderable } from "../../ui/host";

/** Observe computed native content layout after ScrollBox updates its range. */
export function observeScrollBoxContentSize(
  scrollBox: ScrollBoxRenderable | null,
  onSizeChange: () => void,
): (() => void) | undefined {
  return observeSizeChange((scrollBox as NativeScrollBoxRenderable | null)?.content, onSizeChange);
}

/** Scrollbars can resize the viewport without changing the scroll box itself. */
export function observeScrollBoxViewportSize(
  scrollBox: ScrollBoxRenderable | null,
  onSizeChange: () => void,
): (() => void) | undefined {
  return observeSizeChange((scrollBox as NativeScrollBoxRenderable | null)?.viewport, onSizeChange);
}

function observeSizeChange(content: BoxRenderable | undefined, onSizeChange: () => void) {
  if (!content) return;
  // Computed layout invokes onSizeChange, not the explicit resize event.
  // Preserve the internal handler that recalculates the scrollbars.
  const previousSizeChange = content.onSizeChange;
  const handleContentSizeChange = () => {
    previousSizeChange?.call(content);
    onSizeChange();
  };
  content.onSizeChange = handleContentSizeChange;
  return () => {
    if (content.onSizeChange === handleContentSizeChange) {
      content.onSizeChange = previousSizeChange;
    }
  };
}
