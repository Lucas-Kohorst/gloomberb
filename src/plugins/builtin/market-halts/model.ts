import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type { HaltFilter, HaltStatus, MarketHalt } from "./types";

export const HALT_CODE_MAP: Record<string, string> = {
  LUDP: "Volatility Trading Pause (5 min)",
  T1: "News Pending (Release Imminent)",
  T12: "Additional Information Requested",
  T5: "Regulatory Concern",
  T6: "Normal Order Imbalance",
  T8: "Halt Resumption Threshold",
  H10: "SEC Suspension",
  H11: "Regulatory Halt",
  H4: "Failure to Execute",
  D: "News Dissemination",
  M: "Market-Wide Circuit Breaker Halt",
  S: "Special Processing",
  O: "Operations",
  C: "Common Stock Regulatory",
  P: "Corporate Action",
  I: "Order Imbalance",
  R: "Regulatory",
  V: "Volatility",
  X: "Other",
  Z: "Circuit Breaker",
};

export function haltCodeDescription(code: string): string {
  return HALT_CODE_MAP[code] ?? code;
}

export function computeStatus(halt: {
  quoteResumeTime: Date | null;
  resumeTime: Date | null;
}): HaltStatus {
  if (halt.resumeTime) return "resumed";
  if (halt.quoteResumeTime) return "quote_resumed";
  return "active";
}

export function filterHalts(halts: MarketHalt[], filter: HaltFilter): MarketHalt[] {
  if (filter === "all") return halts;
  if (filter === "active") return halts.filter((h) => h.status === "active");
  return halts.filter((h) => h.status !== "active");
}

export type HaltColumnId =
  | "ticker"
  | "exchange"
  | "name"
  | "haltCode"
  | "haltTime"
  | "quoteResume"
  | "resumeTime";

export type HaltColumn = DataTableColumn & { id: HaltColumnId };

export interface HaltSortPreference {
  columnId: HaltColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: HaltSortPreference = {
  columnId: null,
  direction: "asc",
};

function getSortValue(columnId: HaltColumnId, row: MarketHalt): string | number | null {
  switch (columnId) {
    case "ticker":
      return row.ticker;
    case "exchange":
      return row.exchange;
    case "name":
      return row.name;
    case "haltCode":
      return row.haltCode;
    case "haltTime":
      return row.haltTime.getTime();
    case "quoteResume":
      return row.quoteResumeTime?.getTime() ?? null;
    case "resumeTime":
      return row.resumeTime?.getTime() ?? null;
  }
}

export function sortHalts(
  rows: MarketHalt[],
  sortPreference: HaltSortPreference,
): MarketHalt[] {
  const sortColumnId = sortPreference.columnId;
  if (!sortColumnId) return rows;
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortColumnId, left),
    getSortValue(sortColumnId, right),
    sortPreference.direction,
  ));
}

export function nextSortPreference(
  current: HaltSortPreference,
  columnId: string,
): HaltSortPreference {
  const typedColumnId = columnId as HaltColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId: typedColumnId, direction: "desc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

export function buildHaltColumns(width: number): HaltColumn[] {
  const tickerWidth = 8;
  const exchangeWidth = 8;
  const codeWidth = 7;
  const haltTimeWidth = 12;
  const quoteResumeWidth = 12;
  const resumeWidth = 12;
  const columnCount = 7;
  const fixedWidth =
    tickerWidth + exchangeWidth + codeWidth + haltTimeWidth + quoteResumeWidth + resumeWidth;
  const nameWidth = Math.max(6, width - 2 - columnCount - fixedWidth);

  return [
    { id: "ticker", label: "TICKER", width: tickerWidth, align: "left" },
    { id: "exchange", label: "EXCH", width: exchangeWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "haltCode", label: "CODE", width: codeWidth, align: "left" },
    { id: "haltTime", label: "HALT TIME", width: haltTimeWidth, align: "left" },
    { id: "quoteResume", label: "QUOTE RESUME", width: quoteResumeWidth, align: "left" },
    { id: "resumeTime", label: "TRADE RESUME", width: resumeWidth, align: "left" },
  ];
}

export const HALT_FILTER_TABS: Array<{ id: HaltFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "resumed", label: "Resumed" },
];
