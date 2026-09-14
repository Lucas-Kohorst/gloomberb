import type { HolderRecord } from "../../../types/financials";
import {
  formatCompact,
  formatMoneyCompact as sharedFormatMoneyCompact,
  formatPercent,
  formatPercentRaw,
  formatSignedPercentValue,
} from "../../../utils/format";
import type { HolderRow } from "./types";

export function formatMoneyCompact(value: number | undefined, currency = "USD"): string {
  return sharedFormatMoneyCompact(value, currency);
}

export function formatMaybePercent(value: number | undefined): string {
  if (value == null) return "-";
  return Math.abs(value) <= 1 ? formatPercent(value) : formatPercentRaw(value);
}

/**
 * Unit-less signed percent for the CHG% column whose header already reads "%".
 * Keeps the sign, precision, and "-" missing marker of formatMaybePercent.
 */
export function formatMaybePercentValue(value: number | undefined): string {
  if (value == null) return "-";
  return Math.abs(value) <= 1
    ? formatSignedPercentValue(value * 100)
    : formatSignedPercentValue(value);
}

export function resolveHolderOwnershipPercent(row: Pick<HolderRecord, "percentHeld" | "value">, marketCap: number | undefined): number | undefined {
  if (row.percentHeld != null) return row.percentHeld;
  if (row.value == null || row.value < 0 || marketCap == null || marketCap <= 0) return undefined;
  return row.value / marketCap;
}

export function formatHolderOwnershipPercent(value: number | undefined): string {
  if (value == null) return "-";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent.toFixed(2)}%`;
}

/**
 * Unit-less ownership percent for the HELD% column whose header carries "%".
 */
export function formatHolderOwnershipPercentValue(value: number | undefined): string {
  if (value == null) return "-";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return percent.toFixed(2);
}

export function formatHolderOwnershipLine(row: HolderRow, marketCap: number | undefined): string | null {
  const ownership = resolveHolderOwnershipPercent(row, marketCap);
  return ownership == null ? null : `${formatHolderOwnershipPercent(ownership)} held`;
}

export function formatSignedCompact(value: number | undefined): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCompact(value)}`;
}

export function displayDate(value: string | undefined): string {
  return value?.slice(0, 10) ?? "-";
}
