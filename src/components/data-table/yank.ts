import type { DataTableCell, DataTableColumn } from "../ui";

/** What a yank copies: the selected row or a single cell of it. */
export type YankTarget = "row" | "cell";

/**
 * Imperative yank access for pane chrome such as a `[y]ank` footer hint, which
 * must run the same copy the table's own `y` / `Shift+Y` keys perform.
 */
export interface DataTableYankHandle {
  yank(target: YankTarget): void;
}

export interface YankKeyEventLike {
  name?: string;
  key?: string;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  alt?: boolean;
  option?: boolean;
  shift?: boolean;
}

/**
 * Key routing for table yank: plain `y` copies the selected row, `Shift+Y` the
 * selected cell. `y` stays reserved for pane-level share bindings whenever a
 * modifier other than Shift is held, so those panes keep working unchanged.
 */
export function resolveYankTarget(event: YankKeyEventLike): YankTarget | null {
  const name = (event.name ?? event.key ?? "").toLowerCase();
  if (name !== "y") return null;
  if (event.ctrl || event.meta || event.super === true || event.alt || event.option) {
    return null;
  }
  return event.shift ? "cell" : "row";
}

export type YankRenderCell<T, C extends DataTableColumn = DataTableColumn> = (
  item: T,
  column: C,
  index: number,
  rowState: { selected: boolean },
) => DataTableCell;

/**
 * Tab-separated text of the row's visible cells, using the same cell renderer
 * the table paints with so the clipboard matches what is on screen.
 */
export function projectYankRowText<T, C extends DataTableColumn>(
  columns: readonly C[],
  renderCell: YankRenderCell<T, C>,
  item: T,
  index: number,
): string {
  return columns
    .map((column) => renderCell(item, column, index, { selected: false }).text ?? "")
    .join("\t");
}

/**
 * Text of the row's leading cell — its identity column (the ticker symbol in
 * Portfolio and Watchlist). Tables have no per-cell cursor yet, so this is
 * the "selected cell" `Shift+Y` copies. Null when the table has no columns.
 */
export function projectYankCellText<T, C extends DataTableColumn>(
  columns: readonly C[],
  renderCell: YankRenderCell<T, C>,
  item: T,
  index: number,
): string | null {
  const column = columns[0];
  if (!column) return null;
  return renderCell(item, column, index, { selected: false }).text ?? "";
}
