import type { QuoteDataSource } from "../../../types/financials";

export type AlertCondition = "above" | "below" | "crosses" | "halted" | "short_float" | "ex_div" | "pct_day";
export type AlertStatus = "active" | "triggered" | "expired";

export function isPriceAlertCondition(
  condition: AlertCondition,
): condition is "above" | "below" | "crosses" {
  return condition === "above" || condition === "below" || condition === "crosses";
}

/** Quote checks: price levels and the day-move percent. Halt and fundamentals are polled separately. */
export function isQuoteAlertCondition(condition: AlertCondition): boolean {
  return isPriceAlertCondition(condition) || condition === "pct_day";
}

export interface AlertRule {
  id: string;
  symbol: string;
  exchange?: string;
  condition: AlertCondition;
  targetPrice: number;
  createdAt: number;
  /** When an edit or re-arm last armed the rule; createdAt until then. Gloom Cloud emails a trigger once per arming. */
  armedAt?: number;
  status: AlertStatus;
  /** While in the future, the poll loop skips evaluation (status stays "active"); expiry re-arms silently. */
  snoozedUntil?: number;
  triggeredAt?: number;
  lastCheckedPrice?: number;
  lastCheckedAt?: number;
  lastCheckError?: string;
  lastQuoteUpdatedAt?: number;
  lastQuoteSource?: QuoteDataSource;
  lastQuoteProviderId?: string;
  message?: string;
}
