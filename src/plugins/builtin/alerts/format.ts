import { formatApproximateAge } from "../../../utils/datetime-format";
import { formatMarketPrice } from "../../../market-data/market/format";
import { formatQuoteAgeWithSource } from "../../../market-data/quotes/time";
import { isPriceAlertCondition, type AlertCondition, type AlertRule } from "./types";

export function relativeTime(ts: number): string {
  return formatApproximateAge(ts);
}

export function formatCurrentPrice(alert: AlertRule, maxWidth = 9): string {
  if (alert.condition === "halted") {
    if (alert.lastCheckError) return "—";
    if (alert.lastCheckedPrice == null) return "-";
    return alert.lastCheckedPrice > 0 ? "Halted" : "Open";
  }
  if (alert.condition === "short_float") {
    if (alert.lastCheckError) return "—";
    return alert.lastCheckedPrice == null ? "-" : `${alert.lastCheckedPrice.toFixed(1)}%`;
  }
  if (alert.condition === "ex_div") {
    if (alert.lastCheckError) return "—";
    if (alert.lastCheckedPrice == null) return "-";
    const days = Math.round(alert.lastCheckedPrice);
    return days === 0 ? "today" : `${days}d`;
  }
  if (alert.lastCheckError) return "No quote";
  if (alert.condition === "pct_day") {
    return alert.lastCheckedPrice == null || !Number.isFinite(alert.lastCheckedPrice)
      ? "-"
      : `${Math.abs(alert.lastCheckedPrice).toFixed(1)}%`;
  }
  return alert.lastCheckedPrice == null
    ? "-"
    : formatMarketPrice(alert.lastCheckedPrice, {
        maxWidth,
        minimumFractionDigits: 2,
      });
}

export function formatAlertTargetPrice(alert: AlertRule, maxWidth = 9): string {
  if (alert.condition === "halted") return "—";
  if (alert.condition === "short_float" || alert.condition === "pct_day") return `${alert.targetPrice}%`;
  if (alert.condition === "ex_div") return `${alert.targetPrice}d`;
  return formatMarketPrice(alert.targetPrice, {
    maxWidth,
    minimumFractionDigits: 2,
  });
}

/** Compact countdown while an alert is snoozed, e.g. "Snooz 12m"; empty when not snoozed. */
export function formatSnoozeRemaining(alert: AlertRule, now = Date.now()): string {
  const until = alert.snoozedUntil;
  if (until == null || until <= now) return "";
  const minutes = Math.ceil((until - now) / 60_000);
  return minutes >= 60 ? `Snooz ${Math.floor(minutes / 60)}h` : `Snooz ${minutes}m`;
}

export function formatAlertDistance(alert: AlertRule): string {
  if (!isPriceAlertCondition(alert.condition)) return "-";
  const currentPrice = alert.lastCheckedPrice;
  if (alert.lastCheckError) return "-";
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice === 0) {
    return "-";
  }
  const percent = ((alert.targetPrice - currentPrice) / currentPrice) * 100;
  if (!Number.isFinite(percent)) return "-";
  // One decimal at any distance, so the column holds still as the price moves;
  // a distance that rounds to zero is unsigned (0.0%, never -0.0%).
  const fixed = Math.abs(percent).toFixed(1);
  return `${/[1-9]/.test(fixed) ? (percent > 0 ? "+" : "-") : ""}${fixed}%`;
}

export function formatQuoteChecked(alert: AlertRule): string {
  if (alert.lastCheckError) {
    return isPriceAlertCondition(alert.condition) || alert.condition === "pct_day" ? "No quote" : "—";
  }
  if (alert.lastQuoteUpdatedAt) {
    return formatQuoteAgeWithSource({
      lastUpdated: alert.lastQuoteUpdatedAt,
      dataSource: alert.lastQuoteSource,
    });
  }
  if (alert.lastCheckedAt) return relativeTime(alert.lastCheckedAt);
  return "-";
}

export function conditionLabel(condition: AlertCondition): string {
  switch (condition) {
    case "above":
      return "Above";
    case "below":
      return "Below";
    case "crosses":
      return "Cross";
    case "halted":
      return "Halt";
    case "short_float":
      return "SI %";
    case "ex_div":
      return "Ex-div";
    case "pct_day":
      return "Day %";
  }
}
