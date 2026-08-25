import type { CombinedPaneFooter, PaneFooterSegment, PaneHint } from "./model";
import { getShortcutHintWidth } from "../../../ui/shortcut-hint-format";

/** Monospace cells between adjacent hints. Native chrome uses CSS gap instead. */
export const PANE_FOOTER_HINT_GAP = 1;
export const PANE_FOOTER_MAX_HINT_ROWS = 2;

export function paneHintDisplayWidth(hint: PaneHint, prefix = ""): number {
  return getShortcutHintWidth(hint.key, hint.label, prefix);
}

export function totalHintsWidth(hints: readonly PaneHint[]): number {
  return hints.reduce((total, hint, index) => (
    total + paneHintDisplayWidth(hint, index > 0 ? " ".repeat(PANE_FOOTER_HINT_GAP) : "")
  ), 0);
}

function segmentTextLength(segment: PaneFooterSegment): number {
  return segment.parts.reduce((total, part, index) => total + (index > 0 ? 1 : 0) + part.text.length, 0);
}

function totalTrailingInfoWidth(segments: readonly PaneFooterSegment[]): number {
  if (segments.length === 0) return 0;
  return segments.reduce((total, segment, index) => {
    return total + (index > 0 ? 1 : 0) + segmentTextLength(segment);
  }, 0);
}

export function packFooterHintRows(hints: readonly PaneHint[], width: number): PaneHint[][] {
  if (hints.length === 0) return [];
  if (width <= 0) return [[...hints]];

  const rows: PaneHint[][] = [];
  let row: PaneHint[] = [];
  let rowWidth = 0;

  for (const hint of hints) {
    const hintWidth = paneHintDisplayWidth(hint);
    const extra = row.length > 0 ? PANE_FOOTER_HINT_GAP : 0;
    const nextWidth = rowWidth + extra + hintWidth;
    const canWrap = rows.length < PANE_FOOTER_MAX_HINT_ROWS - 1;
    if (row.length > 0 && nextWidth > width && canWrap) {
      rows.push(row);
      row = [hint];
      rowWidth = hintWidth;
      continue;
    }
    row.push(hint);
    rowWidth = nextWidth;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

export function measurePaneFooterHintRows(
  footer: CombinedPaneFooter | null | undefined,
  contentWidth: number,
  options?: { focused?: boolean; nativePaneChrome?: boolean },
): number {
  if (!footer) return 1;
  if (options?.nativePaneChrome) return 1;
  // Reserve wrap height even when unfocused so focusing does not shift body
  // click targets. Hints stay visually hidden until the pane is focused.
  const hints = footer.hints.filter((hint) => !hint.disabled);
  if (hints.length === 0) return 1;
  const trailing = footer.trailingInfo ?? [];
  const trailingWidth = totalTrailingInfoWidth(trailing);
  const trailingGap = hints.length > 0 && trailing.length > 0 ? 1 : 0;
  const hintWidth = Math.max(1, contentWidth - trailingWidth - trailingGap);
  const rows = packFooterHintRows(hints, hintWidth);
  return Math.max(1, Math.min(PANE_FOOTER_MAX_HINT_ROWS, rows.length));
}
