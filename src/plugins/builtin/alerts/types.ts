import type { QuoteDataSource } from "../../../types/financials";
import type { WeatherAlertCondition } from "./weather";

export type AlertCondition = "above" | "below" | "crosses" | "halted" | "short_float" | "ex_div" | "weather" | (string & {});
export type AlertStatus = "active" | "triggered" | "expired";

export function isPriceAlertCondition(
  condition: AlertCondition,
): condition is "above" | "below" | "crosses" {
  return condition === "above" || condition === "below" || condition === "crosses";
}

export interface AlertRule {
  id: string;
  symbol: string;
  exchange?: string;
  condition: AlertCondition;
  targetPrice: number;
  /** Text target for custom alert conditions registered via `registerAlertCondition`. */
  targetText?: string;
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
  /** Present only on weather alerts. `symbol` remains the station id for table compatibility. */
  weather?: {
    stationId: string;
    condition: Exclude<WeatherAlertCondition, { kind: "market-probability" } | { kind: "market-spread" }>;
  };
  lastWeatherStatus?: "preliminary" | "final";
}
