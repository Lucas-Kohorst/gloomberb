import { getDockedPaneIds, isPaneInLayout } from "../../../plugins/pane-manager";
import { cloneLayout, type LayoutConfig } from "../../../types/config";

export function resolvePaneFocusSourceLayout(
  layout: LayoutConfig,
  paneId: string | null,
): LayoutConfig | null {
  if (!paneId || !isPaneInLayout(layout, paneId)) return null;
  return cloneLayout(layout);
}

export function captureFullscreenHiddenDockedIds(layout: LayoutConfig, paneId: string): string[] {
  return getDockedPaneIds(layout).filter((id) => id !== paneId);
}

export function retainHiddenDockedIds(
  hiddenDockedIds: readonly string[],
  layout: LayoutConfig,
): string[] {
  const docked = new Set(getDockedPaneIds(layout));
  return hiddenDockedIds.filter((id) => docked.has(id));
}

export function isFullscreenBasePane(
  transientFocusActive: boolean,
  transientFocusPaneId: string | null | undefined,
  paneId: string,
): boolean {
  return transientFocusActive && transientFocusPaneId === paneId;
}

export interface TransientFocusView {
  active: boolean;
  paneId: string | null;
  hiddenDockedIds: string[];
}

/**
 * Derive the transient-focus view passed through the shell. Window mode and
 * an inactive state both collapse to the no-op view, so consumers never have
 * to re-check `windowMode` or coerce `null`.
 */
export function resolveTransientFocusView(
  state: { active: boolean; paneId: string; hiddenDockedIds: string[] } | null | undefined,
  allowTransient: boolean,
): TransientFocusView {
  if (!allowTransient || !state?.active) {
    return { active: false, paneId: null, hiddenDockedIds: [] };
  }
  return {
    active: true,
    paneId: state.paneId,
    hiddenDockedIds: state.hiddenDockedIds,
  };
}
