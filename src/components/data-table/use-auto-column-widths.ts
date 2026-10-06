import { useMemo, useRef } from "react";
import type { DataTableColumn, DataTableProps } from "../ui/data-table/types";
import { autoColumnWidth } from "./column-widths";

const AUTO_SAMPLE = 24;

type AutoWidthColumn = DataTableColumn & { wrap?: boolean };

/**
 * Sizes unlocked columns from the cells on screen. Re-measures when the row
 * count or the column definitions change, not on every quote tick.
 */
export function useAutoColumnWidths<T, C extends AutoWidthColumn>(
  columns: C[],
  items: readonly T[],
  renderCell: DataTableProps<T, C>["renderCell"],
  isSelected: DataTableProps<T, C>["isSelected"],
): C[] {
  const renderCellRef = useRef(renderCell);
  const isSelectedRef = useRef(isSelected);
  const itemsRef = useRef(items);
  const columnsRef = useRef(columns);
  renderCellRef.current = renderCell;
  isSelectedRef.current = isSelected;
  itemsRef.current = items;
  columnsRef.current = columns;
  const sampleKey = `${items.length}:${columns.map((column) => (
    `${column.id}:${column.width}:${column.wrap ? 1 : 0}`
  )).join("|")}`;
  const measured = useMemo(() => {
    const sampleItems = itemsRef.current;
    const sampleColumns = columnsRef.current;
    if (sampleItems.length === 0) return null;
    const widths: Record<string, number> = {};
    for (const column of sampleColumns) {
      if (column.lockWidth || column.wrap) continue;
      const texts: string[] = [];
      const count = Math.min(sampleItems.length, AUTO_SAMPLE);
      for (let index = 0; index < count; index += 1) {
        const item = sampleItems[index]!;
        const cell = renderCellRef.current(item, column, index, {
          selected: isSelectedRef.current(item, index),
        });
        if (cell?.text) texts.push(cell.text);
      }
      const width = autoColumnWidth(column, texts);
      if (width !== column.width) widths[column.id] = width;
    }
    return Object.keys(widths).length > 0 ? widths : null;
    // sampleKey stands in for the rows so a quote tick does not resize columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleKey]);

  if (!measured) return columns;
  let changed = false;
  const next = columns.map((column) => {
    const width = measured[column.id];
    if (width == null || width === column.width) return column;
    changed = true;
    return { ...column, width };
  });
  return changed ? next : columns;
}
