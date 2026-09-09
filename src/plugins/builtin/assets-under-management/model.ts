import type { DataTableColumn } from "../../../components";
import type { FinancialStatement, Fundamentals, Quote } from "../../../types/financials";
import { formatCompact, formatCurrency, formatMoneyCompact } from "../../../utils/format";
import { compareSortValues, type SortDirection } from "../../../utils/sort-values";

export type AumColumnId = "metric" | "value";
export type AumColumn = DataTableColumn & { id: AumColumnId };

export interface AumRow {
  key: string;
  label: string;
  value: string;
  /** Always-present text (e.g. the currency code) that should never be dimmed. */
  plain?: boolean;
  bold?: boolean;
  /** Canonical display position; the metric column is sorted on this so the default order is stable. */
  order: number;
  /** Numeric basis for the VALUE column; null when the metric has no numeric value ("—"). */
  sortValue: number | null;
}

export interface AumMetrics {
  marketCap: number | null;
  sharesOutstanding: number | null;
  price: number | null;
  currency: string;
  volume: number | null;
  totalAssets: number | null;
  totalEquity: number | null;
  /** (price − NAV per share) / NAV per share, as a percent. */
  navPremiumDiscount: number | null;
}

export interface AumSortPreference {
  columnId: AumColumnId;
  direction: SortDirection;
}

export const DEFAULT_AUM_SORT: AumSortPreference = {
  columnId: "metric",
  direction: "asc",
};

/** Keep finite positive numbers; everything else collapses to "—". */
export function positiveMetric(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function latestAnnualStatement(
  statements: readonly FinancialStatement[],
): FinancialStatement | null {
  if (statements.length === 0) return null;
  return [...statements].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export function formatNavPremium(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

export function buildAumMetrics(
  quote: Quote | null | undefined,
  fundamentals: Fundamentals | null | undefined,
  annualStatements: readonly FinancialStatement[],
): AumMetrics {
  const statement = latestAnnualStatement(annualStatements);
  const price = positiveMetric(quote?.price);
  const sharesOutstanding = positiveMetric(fundamentals?.sharesOutstanding);
  const totalEquity = positiveMetric(statement?.totalEquity);
  const totalAssets = positiveMetric(statement?.totalAssets);

  // NAV per share from the latest balance sheet; premium/discount vs. the quote.
  let navPremiumDiscount: number | null = null;
  if (price != null && totalEquity != null && sharesOutstanding != null) {
    const navPerShare = totalEquity / sharesOutstanding;
    if (Number.isFinite(navPerShare) && navPerShare > 0) {
      navPremiumDiscount = ((price - navPerShare) / navPerShare) * 100;
    }
  }

  return {
    marketCap: positiveMetric(quote?.marketCap),
    sharesOutstanding,
    price,
    currency: quote?.currency ?? "USD",
    volume: positiveMetric(quote?.volume),
    totalAssets,
    totalEquity,
    navPremiumDiscount,
  };
}

export function buildAumRows(metrics: AumMetrics): AumRow[] {
  const currency = metrics.currency;
  return [
    {
      key: "marketCap",
      label: "Market Cap / AUM",
      value: formatMoneyCompact(metrics.marketCap, currency),
      bold: true,
      order: 0,
      sortValue: metrics.marketCap,
    },
    {
      key: "sharesOutstanding",
      label: "Shares Outstanding",
      value: formatCompact(metrics.sharesOutstanding ?? undefined),
      order: 1,
      sortValue: metrics.sharesOutstanding,
    },
    {
      key: "price",
      label: "Price",
      value: formatCurrency(metrics.price ?? undefined, currency),
      order: 2,
      sortValue: metrics.price,
    },
    {
      key: "currency",
      label: "Currency",
      value: currency,
      plain: true,
      order: 3,
      sortValue: null,
    },
    {
      key: "volume",
      label: "Volume",
      value: formatCompact(metrics.volume ?? undefined),
      order: 4,
      sortValue: metrics.volume,
    },
    {
      key: "totalAssets",
      label: "Total Assets",
      value: formatMoneyCompact(metrics.totalAssets, currency),
      order: 5,
      sortValue: metrics.totalAssets,
    },
    {
      key: "totalEquity",
      label: "Total Equity",
      value: formatMoneyCompact(metrics.totalEquity, currency),
      order: 6,
      sortValue: metrics.totalEquity,
    },
    {
      key: "navPremiumDiscount",
      label: "NAV Premium/Discount",
      value: formatNavPremium(metrics.navPremiumDiscount),
      order: 7,
      sortValue: metrics.navPremiumDiscount,
    },
  ];
}

function rowSortValue(row: AumRow, columnId: AumColumnId): string | number | null {
  if (columnId === "metric") return row.order;
  return row.sortValue;
}

export function sortAumRows(rows: readonly AumRow[], preference: AumSortPreference): AumRow[] {
  return [...rows].sort((left, right) =>
    compareSortValues(
      rowSortValue(left, preference.columnId),
      rowSortValue(right, preference.columnId),
      preference.direction,
    ),
  );
}

export function nextAumSort(current: AumSortPreference, columnId: string): AumSortPreference {
  if (current.columnId === columnId) {
    return {
      columnId: columnId as AumColumnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return { columnId: columnId as AumColumnId, direction: "asc" };
}

export function buildAumColumns(): AumColumn[] {
  return [
    { id: "metric", label: "METRIC", width: 24, align: "left", flexGrow: 1 },
    { id: "value", label: "VALUE", width: 18, align: "right" },
  ];
}
