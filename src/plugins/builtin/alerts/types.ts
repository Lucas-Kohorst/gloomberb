import type { QuoteDataSource } from "../../../types/financials";

export type AlertCondition = "above" | "below" | "crosses" | "halted" | "short_float" | "ex_div";
export type AlertStatus = "active" | "triggered" | "expired";

export function isPriceAlertCondition(
  condition: AlertCondition,
): condition is "above" | "below" | "crosses" {
  return condition === "above" || condition === "below" || condition === "crosses";
}

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  createdAt: number;
  status: AlertStatus;
  triggeredAt?: number;
  lastCheckedPrice?: number;
  lastCheckedAt?: number;
  lastCheckError?: string;
  lastQuoteUpdatedAt?: number;
  lastQuoteSource?: QuoteDataSource;
  lastQuoteProviderId?: string;
  message?: string;
}
