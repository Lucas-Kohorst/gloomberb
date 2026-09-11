import type { PatternMatch, PatternType } from "../shared/indicators";
import type { PricePoint } from "../../../types/financials";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";

export interface PatternRecognitionRow {
  key: string;
  type: PatternType;
  typeLabel: string;
  confidence: number;
  description: string;
  dateRange: string;
}

export interface PatternSortPreference {
  columnId: PatternRecognitionColumnId;
  direction: SortDirection;
}

export type PatternRecognitionColumnId = "type" | "confidence" | "dateRange" | "description";

export const DEFAULT_PATTERN_SORT: PatternSortPreference = {
  columnId: "confidence",
  direction: "desc",
};

const PATTERN_LABELS: Record<PatternType, string> = {
  "double-top": "Double Top",
  "double-bottom": "Double Bottom",
  "head-and-shoulders": "Head & Shoulders",
  "inv-head-and-shoulders": "Inverse Head & Shoulders",
  "ascending-triangle": "Ascending Triangle",
  "descending-triangle": "Descending Triangle",
  "symmetrical-triangle": "Symmetrical Triangle",
  "rising-wedge": "Rising Wedge",
  "falling-wedge": "Falling Wedge",
  "bull-flag": "Bull Flag",
  "bear-flag": "Bear Flag",
  "channel-up": "Ascending Channel",
  "channel-down": "Descending Channel",
  range: "Trading Range",
};

export function formatPatternType(type: PatternType): string {
  return PATTERN_LABELS[type];
}

function pointDate(point: PricePoint | undefined): Date | null {
  if (!point) return null;
  const value = point.date as Date | string | number;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

function formatDateRange(points: PricePoint[], match: PatternMatch): string {
  const start = formatDate(pointDate(points[match.startIdx]));
  const end = formatDate(pointDate(points[match.endIdx]));
  return `${start} – ${end}`;
}

export function buildPatternRows(
  points: PricePoint[],
  matches: PatternMatch[],
): PatternRecognitionRow[] {
  return matches.map((match, index) => ({
    key: `${match.type}:${match.startIdx}:${match.endIdx}:${index}`,
    type: match.type,
    typeLabel: formatPatternType(match.type),
    confidence: match.confidence,
    description: match.description,
    dateRange: formatDateRange(points, match),
  }));
}

function sortValue(row: PatternRecognitionRow, columnId: PatternRecognitionColumnId): string | number {
  switch (columnId) {
    case "type": return row.typeLabel;
    case "confidence": return row.confidence;
    case "dateRange": return row.dateRange;
    case "description": return row.description;
  }
}

export function sortPatternRows(
  rows: PatternRecognitionRow[],
  preference: PatternSortPreference,
): PatternRecognitionRow[] {
  return [...rows].sort((left, right) => compareSortValues(
    sortValue(left, preference.columnId),
    sortValue(right, preference.columnId),
    preference.direction,
  ));
}

export function nextPatternSortPreference(
  current: PatternSortPreference,
  columnId: string,
): PatternSortPreference {
  const typedColumnId = columnId as PatternRecognitionColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "desc" };
  }
  return {
    columnId: typedColumnId,
    direction: current.direction === "desc" ? "asc" : "desc",
  };
}
