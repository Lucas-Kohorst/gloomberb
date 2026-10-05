import type { CombinedPaneFooter, PaneFooterSegment, PaneHint } from "./model";
import { getShortcutHintWidth } from "../../../ui/shortcut-hint-format";
import { displayWidth } from "../../../../utils/format";
import { t } from "../../../../i18n";

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
  return segment.parts.reduce((total, part, index) => total + (index > 0 ? 1 : 0) + displayWidth(part.text), 0);
}

export function totalFooterInfoWidth(segments: readonly PaneFooterSegment[]): number {
  if (segments.length === 0) return 0;
  return segments.reduce((total, segment, index) => {
    return total + (index > 0 ? 1 : 0) + segmentTextLength(segment);
  }, 0);
}

function takeHints(hints: readonly PaneHint[], width: number): PaneHint[] {
  const row: PaneHint[] = [];
  let used = 0;
  for (const hint of hints) {
    const next = used + (row.length > 0 ? PANE_FOOTER_HINT_GAP : 0) + paneHintDisplayWidth(hint);
    if (next > width) break;
    row.push(hint);
    used = next;
  }
  return row;
}

export function layoutPaneFooterActions(footer: CombinedPaneFooter, contentWidth: number) {
  const width = Math.max(0, Math.floor(contentWidth));
  const hints = footer.hints.filter((hint) => !hint.disabled);
  const infoMinimum = Math.min(width, 10, totalFooterInfoWidth(footer.info));
  const rightBudget = Math.max(0, width - infoMinimum - (infoMinimum > 0 ? 1 : 0));
  const trailingWidth = Math.min(rightBudget, totalFooterInfoWidth(footer.trailingInfo ?? []));
  const first = takeHints(hints, rightBudget - trailingWidth - (trailingWidth > 0 ? 1 : 0));
  const rightWidth = totalHintsWidth(first) + trailingWidth + (first.length > 0 && trailingWidth > 0 ? 1 : 0);
  const infoWidth = Math.max(0, width - rightWidth - (rightWidth > 0 && infoMinimum > 0 ? 1 : 0));
  const remaining = hints.slice(first.length);
  const moreLabel = width >= displayWidth(t("More")) + 2 ? t("More") : "…";
  const moreWidth = Math.min(width, displayWidth(moreLabel) + 2);
  if (remaining.length === 0) {
    return { rows: [first], overflow: [], infoWidth, trailingWidth, moreWidth, moreLabel };
  }
  const allFit = totalHintsWidth(remaining) <= width;
  const second = takeHints(remaining, allFit ? width : width - moreWidth - PANE_FOOTER_HINT_GAP);
  return {
    rows: [first, second],
    overflow: remaining.slice(second.length),
    infoWidth, trailingWidth, moreWidth, moreLabel,
  };
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
  const { rows } = layoutPaneFooterActions(footer, contentWidth);
  return Math.max(1, Math.min(PANE_FOOTER_MAX_HINT_ROWS, rows.length));
}
