export type WebDataTableRowMemoProps = {
  columns: unknown;
  columnGap: number;
  horizontalPadding: number;
  itemKey: string;
  index: number;
  selected: boolean;
  rowSize: number;
  rowStart: number;
  gridTemplateColumns: string;
  rowContextMenuSurface: boolean;
  rowRevision?: string | number;
  item: unknown;
  renderCell: unknown;
  renderSectionHeader: unknown;
  getRowBackgroundColor: unknown;
  isRowArriving: unknown;
  focusPane: unknown;
  onTableMouseDown: unknown;
  onActivateRow: unknown;
  onRowContextMenu: unknown;
  onRowMouseDown: unknown;
  onSelectRow: unknown;
};

function layoutPropsEqual(
  prev: WebDataTableRowMemoProps,
  next: WebDataTableRowMemoProps,
): boolean {
  return prev.itemKey === next.itemKey
    && prev.index === next.index
    && prev.selected === next.selected
    && prev.rowSize === next.rowSize
    && prev.rowStart === next.rowStart
    && prev.columnGap === next.columnGap
    && prev.horizontalPadding === next.horizontalPadding
    && prev.gridTemplateColumns === next.gridTemplateColumns
    && prev.rowContextMenuSurface === next.rowContextMenuSurface
    && prev.columns === next.columns;
}

/** Skip re-render when only table-level callbacks (renderCell) changed. */
export function webDataTableRowPropsAreEqual(
  prev: WebDataTableRowMemoProps,
  next: WebDataTableRowMemoProps,
): boolean {
  if (!layoutPropsEqual(prev, next)) return false;
  if (prev.item !== next.item) return false;
  if (prev.getRowBackgroundColor !== next.getRowBackgroundColor) return false;
  if (prev.isRowArriving !== next.isRowArriving) return false;
  if (prev.renderSectionHeader !== next.renderSectionHeader) return false;
  if (prev.rowRevision !== undefined && prev.rowRevision === next.rowRevision) {
    return true;
  }
  return prev.rowRevision === next.rowRevision
    && prev.renderCell === next.renderCell
    && prev.focusPane === next.focusPane
    && prev.onTableMouseDown === next.onTableMouseDown
    && prev.onActivateRow === next.onActivateRow
    && prev.onRowContextMenu === next.onRowContextMenu
    && prev.onRowMouseDown === next.onRowMouseDown
    && prev.onSelectRow === next.onSelectRow;
}
