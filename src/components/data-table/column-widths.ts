import { displayWidth } from "../../utils/format";

const AUTO_SAMPLE = 24;
/** A cell longer than this ellipsizes. Dragging can still go wider. */
const AUTO_CONTENT_CAP = 64;

/**
 * Width a column takes before anyone drags it. A wrapped column stays at the
 * width the pane gave it, so the text wraps instead of becoming one long line.
 * Anything else grows to the sampled cell text, and never shrinks past the
 * pane's width.
 */
export function autoColumnWidth(
  column: { width: number; wrap?: boolean },
  texts: readonly string[],
): number {
  const declared = Math.max(1, Math.floor(column.width) || 1);
  if (column.wrap) return declared;
  let content = 0;
  const count = Math.min(texts.length, AUTO_SAMPLE);
  for (let index = 0; index < count; index += 1) {
    const width = displayWidth(texts[index] ?? "");
    if (width > content) content = width;
  }
  if (content <= declared) return declared;
  return Math.min(AUTO_CONTENT_CAP, content);
}

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

function hasColumnWidths(widths: TableColumnWidths): boolean {
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
  let changed = false;
  const next = columns.map((column) => {
    const saved = widths[column.id];
    if (saved == null) return column;
    if (
      column.width === saved
      && column.lockWidth === true
      && (column.flexGrow ?? 0) === 0
    ) {
      return column;
    }
    changed = true;
    return { ...column, width: saved, flexGrow: 0, lockWidth: true };
  });
  return changed ? next : columns as C[];
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
