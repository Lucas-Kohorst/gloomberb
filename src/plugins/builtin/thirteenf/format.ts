import {
  formatCompact,
  formatMoneyCompact as sharedFormatMoneyCompact,
  formatSignedPercentValue,
} from "../../../utils/format";
import type { HoldingAction } from "./types";

export function formatMoneyCompact(value: number | null | undefined): string {
  return sharedFormatMoneyCompact(value);
}

export function formatShares(value: number | null | undefined): string {
  if (value == null) return "--";
  return formatCompact(value);
}

/**
 * Unit-less signed percent for "%"-headed columns (WEIGHT%, VALUE%). Matches
 * the sign and dynamic precision of the previous unit-suffixed formatter.
 */
export function formatPercentMaybeValue(value: number | null | undefined): string {
  if (value == null) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(Math.abs(value) >= 0.1 ? 1 : 2)}`;
}

/**
 * Unit-less sign-prefixed percent for the "EST 13F%" column whose header
 * already reads "%". Same "--" missing marker as the previous formatter.
 */
export function formatRawPercentMaybeValue(value: number | null | undefined): string {
  if (value == null) return "--";
  return formatSignedPercentValue(value);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "--";
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function actionLabel(action: HoldingAction): string {
  switch (action) {
    case "new":
      return "New";
    case "add":
      return "Add";
    case "trim":
      return "Trim";
    case "exit":
      return "Exit";
    case "held":
      return "Held";
  }
}

export function formatChangeShares(value: number | null | undefined): string {
  if (value == null) return "--";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatCompact(value)}`;
}
