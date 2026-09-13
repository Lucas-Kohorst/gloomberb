export const TABLE_COLUMN_WIDTHS_SETTING = "columnWidths";

export const MIN_TABLE_COLUMN_WIDTH = 3;
export const MAX_TABLE_COLUMN_WIDTH = 240;

export type TableColumnWidths = Record<string, number>;

export interface WidthLockableColumn {
  id: string;
  width: number;
  flexGrow?: number;
  lockWidth?: boolean;
}

export function clampTableColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_TABLE_COLUMN_WIDTH;
  return Math.max(
    MIN_TABLE_COLUMN_WIDTH,
    Math.min(MAX_TABLE_COLUMN_WIDTH, Math.round(width)),
  );
}

export function parseColumnWidths(value: unknown): TableColumnWidths {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const widths: TableColumnWidths = {};
  for (const [id, width] of Object.entries(value as Record<string, unknown>)) {
    if (id.length === 0) continue;
    if (typeof width !== "number" || !Number.isFinite(width)) continue;
    widths[id] = clampTableColumnWidth(width);
  }
  return widths;
}

export function hasColumnWidths(widths: TableColumnWidths): boolean {
  for (const _key in widths) return true;
  return false;
}

export function resizedColumnWidth(startWidth: number, deltaCells: number): number {
  return clampTableColumnWidth(startWidth + deltaCells);
}

export function applyColumnWidths<C extends WidthLockableColumn>(
  columns: readonly C[],
  widths: TableColumnWidths,
): C[] {
  if (!hasColumnWidths(widths)) return columns as C[];
  return columns.map((column) => {
    const saved = widths[column.id];
    if (saved == null) return column;
    if (
      column.width === saved
      && column.lockWidth === true
      && (column.flexGrow ?? 0) === 0
    ) {
      return column;
    }
    return { ...column, width: saved, flexGrow: 0, lockWidth: true };
  });
}

export function setColumnWidth(
  widths: TableColumnWidths,
  columnId: string,
  width: number,
): TableColumnWidths {
  const nextWidth = clampTableColumnWidth(width);
  if (widths[columnId] === nextWidth) return widths;
  return { ...widths, [columnId]: nextWidth };
}

export function columnWidthsWithout(
  widths: TableColumnWidths,
  columnId: string,
): TableColumnWidths {
  if (!(columnId in widths)) return widths;
  const next = { ...widths };
  delete next[columnId];
  return next;
}
