import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortPreference } from "../../../utils/sort-values";
import type { CountryEconKind, CountryEconRow } from "./types";

export type CountryEconColumnId = "iso3" | "name" | "kind" | "year" | "value";
export type CountryEconColumn = DataTableColumn & { id: CountryEconColumnId };
export type CountryEconSort = SortPreference<CountryEconColumnId>;
export type KindFilter = "all" | CountryEconKind;

export const DEFAULT_COUNTRY_ECON_SORT: CountryEconSort = {
  columnId: "value",
  direction: "desc",
};

export const KIND_CYCLE: KindFilter[] = ["all", "country", "region"];

export function nextKindFilter(current: KindFilter): KindFilter {
  const index = KIND_CYCLE.indexOf(current);
  return KIND_CYCLE[(index + 1) % KIND_CYCLE.length]!;
}

export function buildCountryEconColumns(width: number): CountryEconColumn[] {
  const isoWidth = 5;
  const kindWidth = 8;
  const yearWidth = 6;
  const valueWidth = 14;
  const nameWidth = Math.max(12, width - 2 - 5 - isoWidth - kindWidth - yearWidth - valueWidth);
  return [
    { id: "iso3", label: "ISO", width: isoWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "kind", label: "KIND", width: kindWidth, align: "left" },
    { id: "year", label: "YEAR", width: yearWidth, align: "right" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
  ];
}

function sortValue(columnId: CountryEconColumnId, row: CountryEconRow): string | number | null {
  switch (columnId) {
    case "iso3":
      return row.iso3;
    case "name":
      return row.name;
    case "kind":
      return row.kind;
    case "year":
      return row.year;
    case "value":
      return row.value;
  }
}

export function sortCountryEconRows(
  rows: CountryEconRow[],
  sort: CountryEconSort,
): CountryEconRow[] {
  const columnId = sort.columnId ?? "value";
  return [...rows].sort((left, right) => {
    const compared = compareSortValues(
      sortValue(columnId, left),
      sortValue(columnId, right),
      sort.direction,
    );
    return compared !== 0 ? compared : left.name.localeCompare(right.name);
  });
}

export function nextCountryEconSort(
  current: CountryEconSort,
  columnId: CountryEconColumnId,
): CountryEconSort {
  if (current.columnId !== columnId) {
    return { columnId, direction: columnId === "name" || columnId === "iso3" ? "asc" : "desc" };
  }
  if (current.direction === "desc") return { columnId, direction: "asc" };
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return DEFAULT_COUNTRY_ECON_SORT;
}

export function visibleCountryEconRows(
  rows: CountryEconRow[],
  kind: KindFilter,
): CountryEconRow[] {
  if (kind === "all") return rows;
  return rows.filter((row) => row.kind === kind);
}
