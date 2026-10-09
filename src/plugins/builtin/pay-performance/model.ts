import { formatCompact, formatNumber } from "../../../utils/format";

export const PAY_PERFORMANCE_PANE_ID = "pay-performance";

export const NO_PAY_FACTS = "No pay versus performance facts for this ticker.";

export interface PayPerformanceRow {
  year: number;
  compensationActuallyPaid: number | null;
  companyReturn: number | null;
  peerReturn: number | null;
}

export interface PayPerformanceBoard {
  ticker: string;
  rows: PayPerformanceRow[];
  latestYear: number | null;
}

export function latestPayYear(rows: readonly PayPerformanceRow[]): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    if (latest == null || row.year > latest) latest = row.year;
  }
  return latest;
}

export function formatPayAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCompact(value);
}

/** Filed shareholder return is usually the value of a fixed investment, not a percent. */
export function formatShareholderReturn(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return formatCompact(value);
  return formatNumber(value, 2);
}
