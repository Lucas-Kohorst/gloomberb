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

export function buildYieldColumns(width: number): YieldColumnDef[] {
  const ratingWidth = 5;
  const maturityWidth = 8;
  const yieldWidth = 9;
  const spreadWidth = 10;
  // 4 inter-column gaps + 2 leading/trailing pad cells ≈ 6
  const labelWidth = Math.max(14, width - ratingWidth - maturityWidth - yieldWidth - spreadWidth - 6);
  return [
    { id: "label", label: "LABEL", width: labelWidth, align: "left" },
    { id: "rating", label: "RATING", width: ratingWidth, align: "left" },
    { id: "maturity", label: "MATURITY", width: maturityWidth, align: "left" },
    { id: "yield", label: "YIELD", width: yieldWidth, align: "right" },
    { id: "spread", label: "SPREAD", width: spreadWidth, align: "right" },
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

export function buildSearchColumns(width: number): SearchColumnDef[] {
  const kindWidth = 10;
  const detailWidth = Math.min(28, Math.max(16, Math.floor(width * 0.35)));
  const labelWidth = Math.max(16, width - kindWidth - detailWidth - 6);
  return [
    { id: "label", label: "NAME", width: labelWidth, align: "left" },
    { id: "kind", label: "KIND", width: kindWidth, align: "left" },
    { id: "detail", label: "ID", width: detailWidth, align: "left" },
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
