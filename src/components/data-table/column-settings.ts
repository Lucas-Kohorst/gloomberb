import type { PaneSettingField } from "../../types/plugin";

export interface ColumnVisibilityColumn {
  id: string;
  label: string;
  description?: string;
}

/**
 * Builds an ordered-multi-select settings field that stores a `columnIds`
 * array in the pane's settings. Panes resolve the saved ids with
 * {@link resolveVisibleColumns} when building their table columns.
 */
export function buildColumnVisibilityField(
  columns: readonly ColumnVisibilityColumn[],
): PaneSettingField {
  return {
    key: "columnIds",
    label: "Columns",
    type: "ordered-multi-select",
    options: columns.map((column) => ({
      value: column.id,
      label: column.label,
      description: column.description,
    })),
  };
}

/**
 * Filters a pane's full column list down to the ids stored in `columnIds`,
 * falling back to `defaultColumnIds` when nothing is saved (or the saved ids
 * no longer resolve).
 */
export function resolveVisibleColumns<T extends { id: string }>(
  columns: readonly T[],
  columnIds: unknown,
  defaultColumnIds: readonly string[],
): T[] {
  const savedIds = Array.isArray(columnIds)
    ? columnIds.filter((value): value is string => typeof value === "string")
    : [];
  const byId = new Map(columns.map((column) => [column.id, column]));
  const resolved = (savedIds.length > 0 ? savedIds : defaultColumnIds)
    .map((id) => byId.get(id))
    .filter((column): column is T => column != null);
  return resolved.length > 0
    ? resolved
    : columns.filter((column) => defaultColumnIds.includes(column.id));
}
