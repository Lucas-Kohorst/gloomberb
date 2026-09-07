import { useEffect, useRef } from "react";
import { useShortcut } from "../../../../react/input";
import type { WindowEditMode } from "../../../../plugins/registry";
import {
  createDoubleEscapeCloseState,
  recordDoubleEscapeClose,
  resetDoubleEscapeClose,
} from "../../../../utils/double-escape-close";
import {
  inputCaptureAllowsPaneManagementShortcut,
  resolvePaneManagementShortcut,
} from "../shortcuts";

interface ShellPaneManagementShortcutOptions {
  cancelActiveDrag(): void;
  closeAllFloatingPanes(): boolean;
  closePane(paneId: string): boolean;
  closeFocusedPane(): boolean;
  copyFocusedPaneScreenshot(): boolean;
  exportFocusedPaneCsv(): boolean;
  focusedPaneId: string | null;
  gridlockVisiblePanes(): boolean;
  hasActiveDrag(): boolean;
  inputCaptured: boolean;
  openFocusedPaneSettings(): boolean;
  openLayoutGallery(): void;
  overlayOpen: boolean;
  popOutFocusedPane(): boolean;
  shareFocusedPane(): boolean;
  startWindowMode(paneId?: string, mode?: WindowEditMode): void;
  toggleFocusedPaneFullscreen(): boolean;
  toggleFocusedPaneFloating(): boolean;
  transientFocusActive: boolean;
  transientFocusPaneId: string | null;
  unfocusFocusedPane(): boolean;
}

export function useShellPaneManagementShortcuts({
  cancelActiveDrag,
  closeAllFloatingPanes,
  closePane,
  closeFocusedPane,
  copyFocusedPaneScreenshot,
  exportFocusedPaneCsv,
  focusedPaneId,
  gridlockVisiblePanes,
  hasActiveDrag,
  inputCaptured,
  openFocusedPaneSettings,
  openLayoutGallery,
  overlayOpen,
  popOutFocusedPane,
  shareFocusedPane,
  startWindowMode,
  toggleFocusedPaneFullscreen,
  toggleFocusedPaneFloating,
  transientFocusActive,
  transientFocusPaneId,
  unfocusFocusedPane,
}: ShellPaneManagementShortcutOptions): void {
  const doubleEscapeCloseRef = useRef(createDoubleEscapeCloseState());

  useEffect(() => {
    if (overlayOpen) {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    }
  }, [overlayOpen]);

  useShortcut((event) => {
    const shortcut = resolvePaneManagementShortcut(event);
    if (shortcut === "toggle-fullscreen" && !overlayOpen) {
      if (!inputCaptured || inputCaptureAllowsPaneManagementShortcut(shortcut, event)) {
        if (hasActiveDrag()) {
          cancelActiveDrag();
        }
        if (toggleFocusedPaneFullscreen()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }

    const isEscape = event.name === "escape" || event.name === "esc";
    if (!isEscape) return;
    if (!hasActiveDrag()) return;
    resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    cancelActiveDrag();
    event.preventDefault();
    event.stopPropagation();
  }, { phase: "before" });

  useShortcut((event) => {
    const isEscape = event.name === "escape" || event.name === "esc";
    if (!isEscape) {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
      return;
    }
    if (hasActiveDrag() || overlayOpen) {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
      return;
    }

    const doubleEscapeState = doubleEscapeCloseRef.current;
    if (
      transientFocusActive
      && (!focusedPaneId || focusedPaneId === transientFocusPaneId)
      && toggleFocusedPaneFullscreen()
    ) {
      resetDoubleEscapeClose(doubleEscapeState);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const now = Date.now();
    const pendingId = doubleEscapeState.targetId;
    if (pendingId && recordDoubleEscapeClose(doubleEscapeState, pendingId, now) && closePane(pendingId)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (focusedPaneId) recordDoubleEscapeClose(doubleEscapeState, focusedPaneId, now);
    if (unfocusFocusedPane()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { phase: "after" });

  useShortcut((event) => {
    const shortcut = resolvePaneManagementShortcut(event);
    if (!shortcut || hasActiveDrag() || overlayOpen) return;
    if (inputCaptured && !inputCaptureAllowsPaneManagementShortcut(shortcut, event)) return;

    let handled = false;
    switch (shortcut) {
      case "close":
        handled = closeFocusedPane();
        break;
      case "close-all-floating":
        handled = closeAllFloatingPanes();
        break;
      case "settings":
        handled = openFocusedPaneSettings();
        break;
      case "toggle-fullscreen":
        handled = toggleFocusedPaneFullscreen();
        break;
      case "toggle-floating":
        handled = !transientFocusActive || focusedPaneId !== transientFocusPaneId
          ? toggleFocusedPaneFloating()
          : false;
        break;
      case "pop-out":
        handled = popOutFocusedPane();
        break;
      case "copy-screenshot":
        handled = copyFocusedPaneScreenshot();
        break;
      case "export-csv":
        handled = exportFocusedPaneCsv();
        break;
      case "share":
        handled = shareFocusedPane();
        break;
      case "layout-gallery":
        openLayoutGallery();
        handled = true;
        break;
      case "gridlock-all":
        handled = gridlockVisiblePanes();
        break;
      case "window-mode":
        startWindowMode(undefined, "move");
        handled = true;
        break;
      case "window-resize-mode":
        startWindowMode(undefined, "resize");
        handled = true;
        break;
    }

    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });
}
