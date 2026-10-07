import type { CommandBarResultLine } from "../../../types/plugin";
import type { TickerRecord } from "../../../types/ticker";
import type { BrokerContractRef, TickerListingRef } from "../../../types/instrument";
import {
  buildSections,
  type CommandBarCategoryPriorities,
  type CommandBarSectionOptions,
  type CommandBarSectionOrder,
} from "../view-model";

/**
 * A row stays scannable next to its neighbours, so a snippet gets two rows at
 * most however many lines a provider hands over.
 */
const MAX_RESULT_ITEM_LINES = 2;

export interface ResultItem {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "plugin" | "action" | "info";
  /** Extra rows under the label, e.g. a matched snippet from a search provider. */
  lines?: CommandBarResultLine[];
  /** Short tag drawn left of the label: a shortcut, an asset class, a document type. */
  badge?: string;
  right?: string;
  /** Provider type retained for symbol/alias identity checks. */
  instrumentType?: string;
  contractKey?: string;
  instrument?: BrokerContractRef | null;
  listing?: TickerListingRef;
  /** Materialize this exact listing when another command consumes the row. */
  resolveTicker?: () => Promise<TickerRecord>;
  shortcutQuery?: string;
  searchText?: string;
  /** Tints the trailing marker and the section heading with the AI accent. */
  accent?: boolean;
  /**
   * How the command-search report names running this row, for rows its kind
   * does not describe: an AI candidate with the text it runs, or Ask Gloom.
   */
  searchChoice?: { kind: "assist"; input: string } | { kind: "ask-gloom" };
  /**
   * Set false for rows that answer nothing on their own — a placeholder, or an
   * offer the user never asked for. The list skips them when it picks the
   * selection for an untouched query, so plain Enter always runs a real match.
   */
  defaultSelectable?: boolean;
  secondaryAction?: () => void | Promise<void>;
  checked?: boolean;
  current?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

type ListScreenKind = "root" | "mode" | "picker";

export interface ListScreenState {
  kind: ListScreenKind;
  title: string;
  subtitle?: string;
  query: string;
  selectedIdx: number;
  hoveredIdx: number | null;
  results: ResultItem[];
  searching: boolean;
  emptyLabel: string;
  emptyDetail: string;
  footerLeft: string;
  footerRight: string;
  sectionOrder?: CommandBarSectionOrder;
  categoryPriorities?: CommandBarCategoryPriorities;
}

export type CommandBarListRow =
  | { kind: "spacer"; id: string }
  | { kind: "heading"; id: string; label: string; accent?: boolean }
  | { kind: "item"; item: ResultItem; globalIdx: number }
  | { kind: "message"; id: string; label: string; dim?: boolean }
  | { kind: "spinner"; id: string; label: string }
  | { kind: "filler"; id: string };

export function orderListResults(
  results: ResultItem[],
  options?: CommandBarSectionOptions,
): ResultItem[] {
  return buildSections(results, options).flatMap((section) => section.items);
}

export function buildListRows(listState: ListScreenState): CommandBarListRow[] {
  const rows: CommandBarListRow[] = [];
  const sections = buildSections(listState.results, {
    sectionOrder: listState.sectionOrder,
    categoryPriorities: listState.categoryPriorities,
  });
  let globalIdx = 0;
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      rows.push({ kind: "spacer", id: `spacer:${sectionIndex}:${section.category}` });
    }
    rows.push({
      kind: "heading",
      id: `heading:${sectionIndex}:${section.category}`,
      label: section.category,
      accent: section.items.some((item) => item.accent),
    });
    for (const item of section.items) {
      rows.push({ kind: "item", item, globalIdx });
      globalIdx += 1;
    }
  });
  return rows;
}

export function getResultItemLines(item: ResultItem): CommandBarResultLine[] {
  const lines = item.lines;
  if (!lines || lines.length === 0) return [];
  return lines.length > MAX_RESULT_ITEM_LINES ? lines.slice(0, MAX_RESULT_ITEM_LINES) : lines;
}

/** Terminal rows the list spends on one entry; every row but an item is one line. */
function getListRowHeight(row: CommandBarListRow): number {
  return row.kind === "item" ? 1 + getResultItemLines(row.item).length : 1;
}

export function getListRowsHeight(rows: readonly CommandBarListRow[]): number {
  return rows.reduce((total, row) => total + getListRowHeight(row), 0);
}

/**
 * Line the list has to scroll to for the selected row to be fully visible.
 *
 * The scroll box works in lines and takes a single target, which is enough to
 * pull one line into view from either edge but not a whole multi-line row. So
 * the target follows the direction of travel: moving down aims at the row's last
 * line, which lands its snippet just inside the bottom edge, and anything else
 * aims at its first line. Returns -1 when nothing is selected.
 */
export function resolveSelectedScrollLine(
  rows: readonly CommandBarListRow[],
  selectedRowIndex: number,
  movedDown: boolean,
): number {
  const selectedRow = rows[selectedRowIndex];
  if (!selectedRow) return -1;
  let line = 0;
  for (let index = 0; index < selectedRowIndex; index += 1) {
    line += getListRowHeight(rows[index]!);
  }
  return movedDown ? line + getListRowHeight(selectedRow) - 1 : line;
}

/** Where a page or edge key sends the selection in a list. */
export type ListJump = "first" | "last" | "page-up" | "page-down";

/**
 * The result a page key lands on: the farthest one within a viewport of lines
 * from the selection, less one line so the row being left stays in view.
 * Headings and multi-line snippets spend lines too, so a page is counted in
 * lines rather than results. Always moves at least one result when there is one.
 */
export function resolveListPageTarget(
  rows: readonly CommandBarListRow[],
  selectedIdx: number,
  viewportLines: number,
  direction: 1 | -1,
): number {
  const budget = Math.max(1, viewportLines - 1);
  const start = rows.findIndex((row) => row.kind === "item" && row.globalIdx === selectedIdx);
  if (start < 0) return selectedIdx + budget * direction;
  let target = selectedIdx;
  let lines = 0;
  for (let index = start + direction; index >= 0 && index < rows.length; index += direction) {
    const row = rows[index]!;
    lines += getListRowHeight(row);
    if (lines > budget && target !== selectedIdx) break;
    if (row.kind === "item") target = row.globalIdx;
  }
  return target;
}

/** Mounted lines grow and move in steps of this many, so arrowing through a step remounts nothing. */
const LIST_WINDOW_BLOCK_LINES = 32;

interface ListRowRun {
  /** Unmounted lines between the previous run, or the top, and this one. */
  padBefore: number;
  rows: readonly CommandBarListRow[];
}

export interface ListRowWindow {
  runs: readonly ListRowRun[];
  /** Unmounted lines after the last run. */
  padAfter: number;
  /** Mounted line ranges as [start, end), to check a scroll position against. */
  mounted: readonly (readonly [number, number])[];
}

/**
 * The rows a long terminal list mounts. Around the selected row, the lines the
 * scroll can land on when it follows the selection (a viewport either way)
 * plus the overscan; around the current scroll position as well, when it sits
 * elsewhere for a frame before following. Ranges are widened to whole steps,
 * and two far-apart ranges stay separate runs, so a jump from the top to the
 * end mounts two small runs instead of everything between them. Spacers keep
 * every line where it is, so the scroll box still addresses the full list.
 */
export function resolveListRowWindow(
  rows: readonly CommandBarListRow[],
  selectedIdx: number,
  viewportLines: number,
  overscanLines: number,
  scrollLine?: number,
): ListRowWindow {
  const viewport = Math.max(0, viewportLines);
  const overscan = Math.max(0, overscanLines);
  // starts[i] is the first line of row i; starts[rows.length] is the total.
  const starts = new Array<number>(rows.length + 1);
  let totalLines = 0;
  let selectedRowIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    starts[index] = totalLines;
    if (selectedRowIndex < 0 && row.kind === "item" && row.globalIdx === selectedIdx) selectedRowIndex = index;
    totalLines += getListRowHeight(row);
  }
  starts[rows.length] = totalLines;
  if (totalLines <= viewport + overscan) {
    return { runs: [{ padBefore: 0, rows }], padAfter: 0, mounted: [[0, totalLines]] };
  }

  const margin = Math.max(0, viewport - 1) + overscan;
  const lineRanges: Array<[number, number]> = [selectedRowIndex < 0
    ? [0, viewport + overscan]
    : [starts[selectedRowIndex]! - margin, starts[selectedRowIndex + 1]! + margin]];
  if (typeof scrollLine === "number" && Number.isFinite(scrollLine)) {
    const scrolled = Math.floor(scrollLine);
    lineRanges.push([scrolled - overscan, scrolled + viewport + overscan]);
  }

  // Whole steps, then whole rows: a multi-line row the edge falls inside is mounted entire.
  const rowRanges = lineRanges.map(([from, to]): [number, number] => {
    const fromLine = Math.max(0, Math.floor(from / LIST_WINDOW_BLOCK_LINES) * LIST_WINDOW_BLOCK_LINES);
    const toLine = Math.min(totalLines, Math.ceil(to / LIST_WINDOW_BLOCK_LINES) * LIST_WINDOW_BLOCK_LINES);
    let startRow = 0;
    while (startRow < rows.length && starts[startRow + 1]! <= fromLine) startRow += 1;
    let endRow = startRow;
    while (endRow < rows.length && starts[endRow]! < toLine) endRow += 1;
    return [startRow, endRow];
  }).filter(([from, to]) => to > from).sort((left, right) => left[0] - right[0]);

  const merged: Array<[number, number]> = [];
  for (const range of rowRanges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  let line = 0;
  const runs = merged.map(([from, to]) => {
    const run = { padBefore: starts[from]! - line, rows: rows.slice(from, to) };
    line = starts[to]!;
    return run;
  });
  return {
    runs,
    padAfter: totalLines - line,
    mounted: merged.map(([from, to]) => [starts[from]!, starts[to]!] as const),
  };
}

export function buildNativeListRows(listState: ListScreenState, rows: CommandBarListRow[]): CommandBarListRow[] {
  if (listState.searching && rows.length === 0) {
    return [{ kind: "spinner", id: "searching", label: "Searching…" }];
  }
  if (rows.length === 0) {
    return [{ kind: "message", id: "empty", label: listState.emptyLabel }];
  }
  if (listState.searching) {
    return [...rows, { kind: "spinner", id: "searching", label: "Searching…" }];
  }
  return rows;
}
