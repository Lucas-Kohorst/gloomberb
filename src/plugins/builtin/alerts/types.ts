import type { QuoteDataSource } from "../../../types/financials";
import type { WeatherAlertCondition } from "./weather";

export type AlertCondition = "above" | "below" | "crosses" | "halted" | "short_float" | "ex_div" | "weather" | "pct_day" | "volume_spike" | "news_mention" | (string & {});
export type AlertStatus = "active" | "triggered" | "expired";

export function isPriceAlertCondition(
  condition: AlertCondition,
): condition is "above" | "below" | "crosses" {
  return condition === "above" || condition === "below" || condition === "crosses";
}

export function isQuoteAlertCondition(condition: AlertCondition): boolean {
  return isPriceAlertCondition(condition) || condition === "pct_day" || condition === "volume_spike";
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
  /** Watermark for news-mention alerts; prevents historical headlines from triggering. */
  lastSeenArticleId?: string;
  lastSeenArticlePublishedAt?: number;
  /** Present only on weather alerts. `symbol` remains the station id for table compatibility. */
  weather?: {
    stationId: string;
    condition: Exclude<WeatherAlertCondition, { kind: "market-probability" } | { kind: "market-spread" }>;
  };
  lastWeatherStatus?: "preliminary" | "final";
}
