import { useEffect } from "react";
import { noteUiInteraction, setUiYieldReason } from "../../utils/ui-yield";

/**
 * Yield background pane updates while the user is typing, using Command-K,
 * or dragging a resize/move handle so those frames stay on the input.
 */
export function useUiYieldRuntime({
  commandBarOpen,
  inputCaptured,
}: {
  commandBarOpen: boolean;
  inputCaptured: boolean;
}): void {
  useEffect(() => {
    setUiYieldReason("input", inputCaptured);
    return () => setUiYieldReason("input", false);
  }, [inputCaptured]);

  useEffect(() => {
    setUiYieldReason("command-bar", commandBarOpen);
    return () => setUiYieldReason("command-bar", false);
  }, [commandBarOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }

    const onPointerDown = () => {
      setUiYieldReason("pointer", true);
    };
    const onPointerUp = () => {
      setUiYieldReason("pointer", false);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0) return;
      noteUiInteraction();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        noteUiInteraction();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("lostpointercapture", onPointerUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("lostpointercapture", onPointerUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
      setUiYieldReason("pointer", false);
    };
  }, []);
}
