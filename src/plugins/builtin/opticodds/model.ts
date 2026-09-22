import type { DataTableColumn } from "../../../components";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import type { OddsRow } from "./types";

export type OddsColumnId = "matchup" | "start" | "book" | "selection" | "price";
export type OddsColumn = DataTableColumn & { id: OddsColumnId };
export type OddsSortPreference = SortPreference<OddsColumnId>;

export const DEFAULT_ODDS_SORT: OddsSortPreference = { columnId: null, direction: "asc" };
export const ODDS_COLUMN_IDS: readonly OddsColumnId[] = ["matchup", "start", "book", "selection", "price"];

export function buildOddsColumns(): OddsColumn[] {
  return [
    { id: "matchup", label: "GAME", width: 18, align: "left", flexGrow: 1 },
    { id: "start", label: "START", width: 12, align: "left" },
    { id: "book", label: "BOOK", width: 12, align: "left" },
    { id: "selection", label: "SIDE", width: 16, align: "left", flexGrow: 1 },
    { id: "price", label: "PRICE", width: 8, align: "right" },
  ];
}

export function formatAmerican(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "—";
  const rounded = Math.round(price);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function formatStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function sortValue(row: OddsRow, columnId: OddsColumnId): string | number | null {
  switch (columnId) {
    case "matchup":
      return row.matchup;
    case "start":
      return row.startMs || null;
    case "book":
      return row.sportsbook;
    case "selection":
      return row.selection;
    case "price":
      return row.price;
  }
}

export function sortOddsRows(rows: readonly OddsRow[], sort: OddsSortPreference): OddsRow[] {
  return applySortPreference(rows, sort, sortValue);
}

export function nextOddsSort(current: OddsSortPreference, columnId: string): OddsSortPreference {
  if (!ODDS_COLUMN_IDS.includes(columnId as OddsColumnId)) return current;
  return nextSortPreference(current, columnId as OddsColumnId, {
    defaultDirection: columnId === "price" || columnId === "start" ? "asc" : "asc",
    resetTo: DEFAULT_ODDS_SORT,
  });
}
