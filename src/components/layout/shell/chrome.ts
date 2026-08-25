import { TITLEBAR_OVERLAY_HEIGHT_PX } from "../titlebar-overlay";

export const DEFAULT_HEADER_HEIGHT = 1;
export const DEFAULT_STATUS_BAR_HEIGHT = 1;
/**
 * Extra pixels on the native/web status bar beyond one cell: 4px top padding,
 * 10px bottom padding (window-radius clearance), 1px border-top.
 * Must stay in sync with `[data-gloom-role="status-bar"]` in styles.css.
 */
export const NATIVE_STATUS_BAR_EXTRA_PX = 15;

export function resolveAppHeaderHeightCells(options: { titleBarOverlay?: boolean; cellHeightPx?: number }): number {
  if (!options.titleBarOverlay || !options.cellHeightPx || options.cellHeightPx <= 0) return DEFAULT_HEADER_HEIGHT;
  return TITLEBAR_OVERLAY_HEIGHT_PX / options.cellHeightPx;
}

/** Cells reserved under the pane grid for the app status bar. Terminal stays 1 row. */
export function resolveAppStatusBarHeightCells(options: {
  visible?: boolean;
  nativePaneChrome?: boolean;
  cellHeightPx?: number;
}): number {
  if (!options.visible) return 0;
  if (!options.nativePaneChrome || !options.cellHeightPx || options.cellHeightPx <= 0) {
    return DEFAULT_STATUS_BAR_HEIGHT;
  }
  return (options.cellHeightPx + NATIVE_STATUS_BAR_EXTRA_PX) / options.cellHeightPx;
}
