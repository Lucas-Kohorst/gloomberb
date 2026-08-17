/**
 * Turns a pane's table into a self-contained share payload.
 *
 * Same reasoning as chart snapshots: the share page renders text that was
 * already computed rather than re-running a provider query, so a shared table
 * opens instantly and works without an account.
 */

import type { TableShareCell, TableShareColumn, TableSharePayload, TableShareRow } from "./payload";

/** Rows past this are dropped, and the page says the view is partial. */
export const TABLE_SHARE_MAX_ROWS = 1_000;

export interface TableSnapshotInput<T> {
  title: string;
  subtitle?: string;
  columns: readonly TableShareColumn[];
  items: readonly T[];
  /** Cell text for one item and column, mirroring the pane's own renderer. */
  cell: (item: T, columnId: string) => TableShareCell | string | null | undefined;
  rowUrl?: (item: T) => string | null | undefined;
  maxRows?: number;
  /** Pane template the rows came from, so the terminal can reopen it live. */
  paneTemplateId?: string;
  now?: Date;
}

function toCell(value: TableShareCell | string | null | undefined): TableShareCell {
  if (value == null) return { text: "" };
  if (typeof value === "string") return { text: value };
  return value.color ? { text: value.text, color: value.color } : { text: value.text };
}

export function buildTableSharePayload<T>({
  title,
  subtitle,
  columns,
  items,
  cell,
  rowUrl,
  maxRows = TABLE_SHARE_MAX_ROWS,
  paneTemplateId,
  now = new Date(),
}: TableSnapshotInput<T>): TableSharePayload {
  const visible = items.slice(0, Math.max(0, maxRows));
  const rows: TableShareRow[] = visible.map((item) => {
    const url = rowUrl?.(item);
    const row: TableShareRow = {
      cells: columns.map((column) => toCell(cell(item, column.id))),
    };
    if (url) row.url = url;
    return row;
  });
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    capturedAt: now.toISOString(),
    columns: columns.map((column) => ({
      id: column.id,
      label: column.label,
      ...(column.align ? { align: column.align } : {}),
      ...(column.width !== undefined ? { width: column.width } : {}),
    })),
    rows,
    ...(items.length > rows.length ? { truncatedFrom: items.length } : {}),
    ...(paneTemplateId ? { paneTemplateId } : {}),
  };
}
