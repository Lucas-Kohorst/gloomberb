import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type { DividendPayment } from "./types";

export type DividendColumnId = "exDate" | "paymentDate" | "amount" | "type" | "currency";
export type DividendColumn = DataTableColumn & { id: DividendColumnId };

export interface DividendRow {
  key: string;
  exDate: string;
  paymentDate: string;
  amount: number;
  type: DividendPayment["type"];
  currency: string;
}

export interface DividendSortPreference {
  columnId: DividendColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_SORT_PREFERENCE: DividendSortPreference = {
  columnId: "exDate",
  direction: "desc",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sum of dividends with ex-dates in the trailing 12 months from `now`.
 */
export function computeTrailingRate(payments: DividendPayment[], now = new Date()): number {
  const cutoff = new Date(now.getTime() - 365 * DAY_MS);
  return payments
    .filter((p) => p.exDate >= cutoff && p.exDate <= now)
    .reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Annualized forward rate from the most recent regular payment.
 * Multiplies the latest payment by the inferred annual frequency.
 */
export function computeForwardRate(payments: DividendPayment[]): number | null {
  const regular = payments.filter((p) => p.type === "cash" || p.type === "unknown");
  if (regular.length === 0) return null;
  const freq = inferFrequency(regular);
  if (!freq) return null;
  const annualCount = frequencyAnnualCount(freq);
  if (annualCount == null) return null;
  // Average the last `annualCount` payments to smooth irregular amounts
  const sorted = [...regular].sort((a, b) => b.exDate.getTime() - a.exDate.getTime());
  const recent = sorted.slice(0, annualCount);
  const avg = recent.reduce((sum, p) => sum + p.amount, 0) / recent.length;
  return avg * annualCount;
}

export function computeTrailingYield(trailingRate: number, currentPrice: number | null): number | null {
  if (currentPrice == null || currentPrice <= 0) return null;
  return trailingRate / currentPrice;
}

export function computeForwardYield(forwardRate: number | null, currentPrice: number | null): number | null {
  if (forwardRate == null || currentPrice == null || currentPrice <= 0) return null;
  return forwardRate / currentPrice;
}

/**
 * 1-year YoY dividend growth: compare the trailing 12-month sum to the
 * prior 12-month sum.
 */
export function computeGrowth1Y(payments: DividendPayment[], now = new Date()): number | null {
  const recentCutoff = new Date(now.getTime() - 365 * DAY_MS);
  const priorCutoff = new Date(now.getTime() - 2 * 365 * DAY_MS);
  const recent = payments
    .filter((p) => p.exDate >= recentCutoff && p.exDate <= now)
    .reduce((sum, p) => sum + p.amount, 0);
  const prior = payments
    .filter((p) => p.exDate >= priorCutoff && p.exDate < recentCutoff)
    .reduce((sum, p) => sum + p.amount, 0);
  if (prior <= 0) return null;
  return (recent - prior) / prior;
}

/**
 * 3-year annualized dividend growth: CAGR of the per-year average payment.
 */
export function computeGrowth3Y(payments: DividendPayment[], now = new Date()): number | null {
  const regular = payments.filter((p) => p.type === "cash" || p.type === "unknown");
  if (regular.length < 4) return null;
  const freq = inferFrequency(regular);
  if (!freq) return null;
  const annualCount = frequencyAnnualCount(freq);
  if (annualCount == null) return null;

  const sorted = [...regular].sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  const recentYearEnd = now;
  const recentYearStart = new Date(now.getTime() - 365 * DAY_MS);
  const threeYearsAgo = new Date(now.getTime() - 3 * 365 * DAY_MS);
  const priorYearStart = new Date(now.getTime() - 4 * 365 * DAY_MS);

  const recentAvg = sorted
    .filter((p) => p.exDate >= recentYearStart && p.exDate <= recentYearEnd)
    .reduce((sum, p) => sum + p.amount, 0) / annualCount;
  const priorAvg = sorted
    .filter((p) => p.exDate >= priorYearStart && p.exDate <= threeYearsAgo)
    .reduce((sum, p) => sum + p.amount, 0) / annualCount;

  if (priorAvg <= 0 || recentAvg <= 0) return null;
  return Math.pow(recentAvg / priorAvg, 1 / 3) - 1;
}

type Frequency = "monthly" | "quarterly" | "semi-annual" | "annual" | "irregular";

export function inferFrequency(payments: DividendPayment[]): Frequency | null {
  if (payments.length < 2) return null;
  const sorted = [...payments].sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.exDate.getTime() - sorted[i - 1]!.exDate.getTime());
  }
  const avgGapDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length / DAY_MS;

  // Allow 20% tolerance
  if (Math.abs(avgGapDays - 30) < 8) return "monthly";
  if (Math.abs(avgGapDays - 91) < 18) return "quarterly";
  if (Math.abs(avgGapDays - 182) < 36) return "semi-annual";
  if (Math.abs(avgGapDays - 365) < 73) return "annual";
  return "irregular";
}

function frequencyAnnualCount(freq: Frequency): number | null {
  switch (freq) {
    case "monthly": return 12;
    case "quarterly": return 4;
    case "semi-annual": return 2;
    case "annual": return 1;
    case "irregular": return null;
  }
}

export function buildDividendColumns(width: number): DividendColumn[] {
  const dateWidth = 14;
  const typeWidth = 8;
  const currencyWidth = 6;
  const amountWidth = 10;
  const payDateWidth = Math.max(dateWidth, width - 2 - dateWidth - amountWidth - typeWidth - currencyWidth);
  return [
    { id: "exDate", label: "EX-DATE", width: dateWidth, align: "left" },
    { id: "paymentDate", label: "PAY DATE", width: payDateWidth, align: "left" },
    { id: "amount", label: "AMOUNT", width: amountWidth, align: "right" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
    { id: "currency", label: "CCY", width: currencyWidth, align: "left" },
  ];
}

function getSortValue(columnId: DividendColumnId, row: DividendRow): string | number | null {
  switch (columnId) {
    case "exDate": return row.exDate;
    case "paymentDate": return row.paymentDate;
    case "amount": return row.amount;
    case "type": return row.type;
    case "currency": return row.currency;
  }
}

export function sortRows(
  rows: DividendRow[],
  sortPreference: DividendSortPreference,
): DividendRow[] {
  if (!sortPreference.columnId) return rows;
  return [...rows].sort((left, right) => compareSortValues(
    getSortValue(sortPreference.columnId!, left),
    getSortValue(sortPreference.columnId!, right),
    sortPreference.direction,
  ));
}

export function nextSortPreference(
  current: DividendSortPreference,
  columnId: string,
): DividendSortPreference {
  const typedColumnId = columnId as DividendColumnId;
  if (current.columnId !== typedColumnId) {
    return { columnId: typedColumnId, direction: "desc" };
  }
  if (current.direction === "desc") {
    return { columnId: typedColumnId, direction: "asc" };
  }
  return DEFAULT_SORT_PREFERENCE;
}

export function toDividendRows(payments: DividendPayment[]): DividendRow[] {
  return payments.map((p, i) => ({
    key: `${p.exDate.toISOString()}:${i}`,
    exDate: formatDate(p.exDate),
    paymentDate: p.paymentDate ? formatDate(p.paymentDate) : "—",
    amount: p.amount,
    type: p.type,
    currency: p.currency,
  }));
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}
