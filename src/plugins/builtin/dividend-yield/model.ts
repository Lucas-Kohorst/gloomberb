import type { DataTableColumn } from "../../../components";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import type { PricePoint } from "../../../types/financials";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type { DividendMetrics, DividendPayment } from "./types";

export type DividendColumnId = "exDate" | "amount" | "currency";
export type DividendColumn = DataTableColumn & { id: DividendColumnId };

export interface DividendRow {
  key: string;
  exDate: string;
  amount: number;
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

export function buildDividendColumns(): DividendColumn[] {
  return [
    { id: "exDate", label: "EX-DATE", width: 14, align: "left", flexGrow: 1 },
    { id: "amount", label: "AMOUNT", width: 10, align: "right" },
    { id: "currency", label: "CCY", width: 6, align: "left" },
  ];
}

function getSortValue(columnId: DividendColumnId, row: DividendRow): string | number | null {
  switch (columnId) {
    case "exDate": return row.exDate;
    case "amount": return row.amount;
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
    amount: p.amount,
    currency: p.currency,
  }));
}

function formatDate(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function positiveMetric(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function cashPayments(payments: readonly DividendPayment[]): DividendPayment[] {
  return payments.filter((payment) => payment.type === "cash" || payment.type === "unknown");
}

export function inferFrequency(payments: readonly DividendPayment[]): DividendMetrics["paymentFrequency"] {
  const regular = cashPayments(payments);
  if (regular.length < 2) return null;
  const sorted = [...regular].sort((left, right) => left.exDate.getTime() - right.exDate.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i]!.exDate.getTime() - sorted[i - 1]!.exDate.getTime()) / DAY_MS);
  }
  const avgGapDays = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (Math.abs(avgGapDays - 30) < 8) return "monthly";
  if (Math.abs(avgGapDays - 91) < 18) return "quarterly";
  if (Math.abs(avgGapDays - 182) < 36) return "semi-annual";
  if (Math.abs(avgGapDays - 365) < 73) return "annual";
  return "irregular";
}

export function annualPaymentCount(freq: DividendMetrics["paymentFrequency"]): number | null {
  switch (freq) {
    case "monthly": return 12;
    case "quarterly": return 4;
    case "semi-annual": return 2;
    case "annual": return 1;
    default: return null;
  }
}

function newestFirst(payments: readonly DividendPayment[]): DividendPayment[] {
  return [...cashPayments(payments)].sort((left, right) => right.exDate.getTime() - left.exDate.getTime());
}

/** Last full year of cash dividends (last N payments at the inferred frequency). */
export function trailingAnnualFromPayments(payments: readonly DividendPayment[]): number | null {
  const newest = newestFirst(payments);
  const count = annualPaymentCount(inferFrequency(newest));
  if (count && newest.length >= count) {
    return newest.slice(0, count).reduce((sum, payment) => sum + payment.amount, 0);
  }
  const cutoff = Date.now() - 365 * DAY_MS;
  const ttm = newest.filter((payment) => payment.exDate.getTime() >= cutoff)
    .reduce((sum, payment) => sum + payment.amount, 0);
  return ttm > 0 ? ttm : null;
}

/** Indicated annual rate from the latest payment × payments per year. */
export function indicatedAnnualFromPayments(payments: readonly DividendPayment[]): number | null {
  const newest = newestFirst(payments);
  const last = newest[0];
  const count = annualPaymentCount(inferFrequency(newest));
  if (!last || !count) return null;
  return last.amount * count;
}

export function dividendGrowth(
  payments: readonly DividendPayment[],
  years: 1 | 3,
): number | null {
  const newest = newestFirst(payments);
  const count = annualPaymentCount(inferFrequency(newest));
  if (!count) return null;
  const needed = count * (years + 1);
  if (newest.length < needed) return null;
  const recent = newest.slice(0, count).reduce((sum, payment) => sum + payment.amount, 0);
  const prior = newest.slice(count * years, count * (years + 1))
    .reduce((sum, payment) => sum + payment.amount, 0);
  if (recent <= 0 || prior <= 0) return null;
  if (years === 1) return (recent - prior) / prior;
  return Math.pow(recent / prior, 1 / years) - 1;
}

export function estimateNextPayDate(payments: readonly DividendPayment[], now = Date.now()): Date | null {
  const newest = newestFirst(payments);
  const last = newest[0];
  const previous = newest[1];
  if (!last || !previous) return null;
  const gap = last.exDate.getTime() - previous.exDate.getTime();
  if (gap <= 0) return null;
  const next = new Date(last.exDate.getTime() + gap);
  return next.getTime() > now ? next : null;
}

export function unixDate(seconds: number | null | undefined): Date | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export interface DividendQuoteFields {
  trailingAnnualDividendRate: number | null;
  trailingAnnualDividendYield: number | null;
  forwardAnnualDividendRate: number | null;
  payoutRatio: number | null;
  exDividendDate: number | null;
  dividendDate: number | null;
}

export function buildDividendMetrics(
  payments: readonly DividendPayment[],
  quoteFields: DividendQuoteFields | null,
  currentPrice: number | null,
  now = Date.now(),
): DividendMetrics {
  const trailingRate = positiveMetric(quoteFields?.trailingAnnualDividendRate)
    ?? trailingAnnualFromPayments(payments);
  const forwardRate = positiveMetric(quoteFields?.forwardAnnualDividendRate)
    ?? indicatedAnnualFromPayments(payments);
  const price = positiveMetric(currentPrice);
  const trailingYield = positiveMetric(quoteFields?.trailingAnnualDividendYield)
    ?? (trailingRate != null && price != null ? trailingRate / price : null);
  const forwardYield = forwardRate != null && price != null ? forwardRate / price : null;
  const frequency = inferFrequency(payments);
  const exDividendDate = unixDate(quoteFields?.exDividendDate)
    ?? (newestFirst(payments)[0]?.exDate ?? null);
  const quotedNextPay = unixDate(quoteFields?.dividendDate);
  const nextPayDate = quotedNextPay && quotedNextPay.getTime() > now
    ? quotedNextPay
    : estimateNextPayDate(payments, now);

  return {
    trailingYield,
    forwardYield,
    trailingRate,
    forwardRate,
    payoutRatio: positiveMetric(quoteFields?.payoutRatio),
    growth1Y: dividendGrowth(payments, 1),
    growth3Y: dividendGrowth(payments, 3),
    paymentFrequency: frequency,
    exDividendDate,
    nextPayDate,
  };
}

function ttmDividendsAt(
  payments: readonly DividendPayment[],
  asOf: Date,
  windowMs = 365 * DAY_MS,
): number {
  const start = asOf.getTime() - windowMs;
  const asOfTime = asOf.getTime();
  return cashPayments(payments)
    .filter((payment) => {
      const time = payment.exDate.getTime();
      return time > start && time <= asOfTime;
    })
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/** Trailing yield at each price print (or each ex-date if history is missing). */
export function buildYieldChartPoints(
  payments: readonly DividendPayment[],
  currentPrice: number | null,
  history: readonly PricePoint[] = [],
): ProjectedChartPoint[] {
  const regular = cashPayments(payments);
  if (regular.length === 0) return [];
  const pricePoints = history.filter((point) => point.close > 0);
  const samples = pricePoints.length >= 2
    ? pricePoints.map((point) => ({ date: point.date, price: point.close }))
    : positiveMetric(currentPrice) != null
      ? regular.map((payment) => ({ date: payment.exDate, price: currentPrice! }))
      : [];
  if (samples.length < 2) return [];

  const points: ProjectedChartPoint[] = [];
  for (const sample of samples) {
    const trailing = ttmDividendsAt(regular, sample.date);
    if (trailing <= 0) continue;
    const yieldPct = (trailing / sample.price) * 100;
    if (!Number.isFinite(yieldPct) || yieldPct <= 0) continue;
    points.push({
      date: sample.date,
      open: yieldPct,
      high: yieldPct,
      low: yieldPct,
      close: yieldPct,
      volume: 0,
    });
  }
  return points;
}
