import type { DataTableSectionHeader } from "../types";

export type OpenTuiDataTableRowMemoProps = {
  columns: unknown;
  columnGap: number;
  horizontalPadding: number;
  contentWidth: number;
  rowHeight: number;
  itemKey: string;
  index: number;
  selected: boolean;
  arriving: boolean;
  sectionHeader: DataTableSectionHeader | null;
  rowContextMenuSurface: boolean;
  rowRevision?: string | number;
  item: unknown;
  renderCell: unknown;
  getRowBackgroundColor: unknown;
  focusPane: unknown;
  onTableMouseDown: unknown;
  onRowContextMenu: unknown;
  onRowMouseDown: unknown;
  onRowPointer: unknown;
};

function sectionHeadersEqual(
  prev: DataTableSectionHeader | null,
  next: DataTableSectionHeader | null,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return prev.text === next.text
    && prev.color === next.color
    && prev.backgroundColor === next.backgroundColor
    && prev.attributes === next.attributes;
}

function layoutPropsEqual(
  prev: OpenTuiDataTableRowMemoProps,
  next: OpenTuiDataTableRowMemoProps,
): boolean {
  return prev.itemKey === next.itemKey
    && prev.index === next.index
    && prev.selected === next.selected
    && prev.arriving === next.arriving
    && prev.rowHeight === next.rowHeight
    && prev.contentWidth === next.contentWidth
    && prev.columnGap === next.columnGap
    && prev.horizontalPadding === next.horizontalPadding
    && prev.rowContextMenuSurface === next.rowContextMenuSurface
    && prev.columns === next.columns
    && sectionHeadersEqual(prev.sectionHeader, next.sectionHeader);
}

/** Skip re-render when a provided row revision and layout are unchanged. */
export function openTuiDataTableRowPropsAreEqual(
  prev: OpenTuiDataTableRowMemoProps,
  next: OpenTuiDataTableRowMemoProps,
): boolean {
  if (!layoutPropsEqual(prev, next)) return false;
  if (prev.rowRevision === undefined || next.rowRevision === undefined) {
    return false;
  }
  return prev.rowRevision === next.rowRevision;
}
