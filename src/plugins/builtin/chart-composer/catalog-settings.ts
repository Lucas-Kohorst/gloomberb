import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "../../../components/data-table/column-settings";
import {
  buildSortSelectField,
  encodeSortPreference,
  parseSortPreference,
} from "../../../components/data-table/sort-settings";
import { compareSortValues } from "../../../utils/sort-values";
import type { PaneSettingsDef } from "../../../types/plugin";
import { CATALOG_FILTERS, type CatalogFilterId, type CatalogSeriesRow } from "./catalog-inventory";

export type CatalogColumnId = "series" | "source" | "kind" | "expression";

export interface CatalogSortPreference {
  columnId: CatalogColumnId;
  direction: "asc" | "desc";
}

export const CATALOG_COLUMN_IDS: readonly CatalogColumnId[] = ["series", "source", "kind", "expression"];
export const DEFAULT_CATALOG_SORT: CatalogSortPreference = { columnId: "source", direction: "asc" };
export const CATALOG_COLUMN_DEFS = [
  { id: "series", label: "SERIES", description: "Human-readable series name." },
  { id: "source", label: "SOURCE", description: "Data vendor or plugin." },
  { id: "kind", label: "KIND", description: "Field or instrument type." },
  { id: "expression", label: "G", description: "Chart expression." },
] as const;

export function isCatalogFilterId(value: unknown): value is CatalogFilterId {
  return typeof value === "string" && CATALOG_FILTERS.some((filter) => filter.id === value);
}

export function catalogColumnSortValue(columnId: CatalogColumnId, row: CatalogSeriesRow): string {
  switch (columnId) {
    case "series":
      return row.label;
    case "source":
      return row.source;
    case "kind":
      return row.kind;
    case "expression":
      return row.expression;
  }
}

export function sortCatalogRows(
  rows: CatalogSeriesRow[],
  preference: CatalogSortPreference,
): CatalogSeriesRow[] {
  if (!preference.columnId) return rows;
  const { columnId, direction } = preference;
  return [...rows].sort((left, right) => (
    compareSortValues(
      catalogColumnSortValue(columnId, left),
      catalogColumnSortValue(columnId, right),
      direction,
    ) || left.label.localeCompare(right.label)
  ));
}

export function getCatalogPaneSettings(settings: Record<string, unknown> | undefined): {
  defaultTab: CatalogFilterId;
  columnIds: CatalogColumnId[];
  sort: CatalogSortPreference;
} {
  const columnIds = resolveVisibleColumns(
    CATALOG_COLUMN_DEFS,
    settings?.columnIds,
    CATALOG_COLUMN_IDS,
  ).map((column) => column.id as CatalogColumnId);
  return {
    defaultTab: isCatalogFilterId(settings?.defaultTab) ? settings.defaultTab : "all",
    columnIds: columnIds.length > 0 ? columnIds : [...CATALOG_COLUMN_IDS],
    sort: parseSortPreference(settings?.sort, CATALOG_COLUMN_IDS, DEFAULT_CATALOG_SORT),
  };
}

export function buildDataCatalogPaneSettingsDef(
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  const resolved = getCatalogPaneSettings(settings);
  return {
    title: "Data Catalog Settings",
    values: {
      defaultTab: resolved.defaultTab,
      columnIds: [...resolved.columnIds],
      sort: encodeSortPreference(resolved.sort),
    },
    fields: [
      {
        key: "defaultTab",
        label: "Default tab",
        description: "Filter shown when this catalog pane opens.",
        type: "select",
        options: CATALOG_FILTERS.map((filter) => ({
          value: filter.id,
          label: filter.label,
        })),
      },
      buildColumnVisibilityField([...CATALOG_COLUMN_DEFS]),
      buildSortSelectField([
        { value: "source:asc", label: "Source A–Z" },
        { value: "series:asc", label: "Series A–Z" },
        { value: "kind:asc", label: "Kind A–Z" },
        { value: "expression:asc", label: "Expression A–Z" },
      ]),
    ],
  };
}
