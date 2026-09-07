import type { DataTableColumn } from "../../../components";
import type { CorporateYieldEntry, YieldColumn } from "./types";
import type { BondSearchHit } from "./search";

export const BOND_SEARCH_PANE_ID = "bond-search";

export type SortDirection = "asc" | "desc";

export type YieldColumnId = YieldColumn["id"];

export type YieldColumnDef = DataTableColumn & { id: YieldColumnId };

export type SearchColumnId = "label" | "kind" | "detail";

export type SearchColumnDef = DataTableColumn & { id: SearchColumnId };

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function compareYield(
  left: CorporateYieldEntry,
  right: CorporateYieldEntry,
  columnId: YieldColumnId,
): number {
  switch (columnId) {
    case "label":
      return compareText(left.label, right.label);
    case "rating":
      return compareText(left.rating, right.rating);
    case "maturity":
      return compareText(left.maturityRange, right.maturityRange);
    case "yield":
      return (left.yield ?? -Infinity) - (right.yield ?? -Infinity);
    case "spread":
      return (left.spreadBp ?? -Infinity) - (right.spreadBp ?? -Infinity);
  }
}

export function nextColumnSort<T extends string>(
  current: { columnId: T; direction: SortDirection },
  columnId: T,
  defaultDirection: SortDirection,
): { columnId: T; direction: SortDirection } {
  if (current.columnId !== columnId) {
    return { columnId, direction: defaultDirection };
  }
  return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function nextSort(
  current: { columnId: YieldColumnId; direction: SortDirection },
  columnId: YieldColumnId,
  defaultDirection: SortDirection,
): { columnId: YieldColumnId; direction: SortDirection } {
  return nextColumnSort(current, columnId, defaultDirection);
}

export function sortedYields(
  entries: CorporateYieldEntry[],
  sort: { columnId: YieldColumnId; direction: SortDirection },
): CorporateYieldEntry[] {
  return [...entries].sort((left, right) => {
    const comparison = compareYield(left, right, sort.columnId);
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    // Stable tie-break: keep the declared series order (rating tiers first).
    return 0;
  });
}

export function buildYieldColumns(): YieldColumnDef[] {
  return [
    { id: "label", label: "LABEL", width: 14, align: "left", flexGrow: 1 },
    { id: "rating", label: "RATING", width: 5, align: "left" },
    { id: "maturity", label: "MATURITY", width: 8, align: "left" },
    { id: "yield", label: "YIELD", width: 9, align: "right" },
    { id: "spread", label: "SPREAD", width: 10, align: "right" },
  ];
}

export function formatYieldPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatSpreadBp(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}bp`;
}

export function formatYieldDate(value: Date | null): string {
  if (!value) return "--";
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buildSearchColumns(): SearchColumnDef[] {
  return [
    { id: "label", label: "NAME", width: 16, align: "left", flexGrow: 1 },
    { id: "kind", label: "KIND", width: 10, align: "left" },
    { id: "detail", label: "ID", width: 16, align: "left" },
  ];
}

export function searchKindLabel(hit: BondSearchHit): string {
  return hit.kind === "series" ? hit.right : hit.right || "BOND";
}

export function sortedSearchHits(
  hits: BondSearchHit[],
  sort: { columnId: SearchColumnId; direction: SortDirection },
): BondSearchHit[] {
  return [...hits].sort((left, right) => {
    let comparison = 0;
    if (sort.columnId === "label") comparison = left.label.localeCompare(right.label, "en-US", { sensitivity: "base" });
    else if (sort.columnId === "kind") {
      comparison = searchKindLabel(left).localeCompare(searchKindLabel(right), "en-US", { sensitivity: "base" });
    } else {
      comparison = left.detail.localeCompare(right.detail, "en-US", { sensitivity: "base" });
    }
    return sort.direction === "asc" ? comparison : -comparison;
  });
}
