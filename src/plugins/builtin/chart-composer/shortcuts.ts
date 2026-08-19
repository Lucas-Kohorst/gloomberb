import type { KeyEventLike } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";

export type ChartComposerShortcut =
  | "add"
  | "delete"
  | "series"
  | "dates"
  | "mode"
  | "reload"
  | "share"
  | { type: "range"; index: number };

export function resolveChartComposerShortcut(
  event: KeyEventLike,
  rangeCount: number,
): ChartComposerShortcut | null {
  if (event.defaultPrevented || event.propagationStopped || event.targetEditable) return null;

  if (isPlainKey(event, "a")) return "add";
  if (isPlainKey(event, "d")) return "delete";
  if (isPlainKey(event, "s")) return "series";
  if (isPlainKey(event, "w")) return "dates";
  if (isPlainKey(event, "m")) return "mode";
  if (isPlainKey(event, "r")) return "reload";
  if (isPlainKey(event, "y")) return "share";
  if (!isPlainKey(event, event.name ?? "")) return null;

  const rangeIndex = Number(event.name) - 1;
  return Number.isInteger(rangeIndex) && rangeIndex >= 0 && rangeIndex < rangeCount
    ? { type: "range", index: rangeIndex }
    : null;
}
