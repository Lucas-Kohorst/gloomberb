import type { AlertCondition, AlertRule } from "./types";
import { isPriceAlertCondition } from "./types";

export type { AlertRule };

/** Built-in conditions a stored alert may carry. Custom conditions from other plugins are also accepted. */
const BUILTIN_CONDITIONS = new Set<string>([
  "above",
  "below",
  "crosses",
  "halted",
  "short_float",
  "ex_div",
  "weather",
]);

export function createAlert(
  symbol: string,
  condition: AlertCondition,
  targetPrice: number,
  exchange?: string,
): AlertRule {
  return {
    id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: symbol.toUpperCase(),
    exchange: exchange?.trim() || undefined,
    condition,
    targetPrice,
    createdAt: Date.now(),
    status: "active",
  };
}

/**
 * Rebuilt from a whitelist rather than spread so every trigger/quote lifecycle
 * field is dropped: a re-armed `crosses` alert must start from a fresh baseline.
 */
export function editAlert(
  alert: AlertRule,
  symbol: string,
  condition: AlertCondition,
  targetPrice: number,
): AlertRule {
  const nextSymbol = symbol.trim().toUpperCase();
  return {
    id: alert.id,
    symbol: nextSymbol,
    exchange: nextSymbol === alert.symbol.trim().toUpperCase() ? alert.exchange : undefined,
    condition,
    targetPrice,
    createdAt: alert.createdAt,
    status: "active",
    message: alert.message,
  };
}

export function rearmAlert(alert: AlertRule): AlertRule {
  return editAlert(alert, alert.symbol, alert.condition, alert.targetPrice);
}

export function evaluateAlert(alert: AlertRule, currentPrice: number): boolean {
  if (alert.status !== "active" || !isPriceAlertCondition(alert.condition)) return false;

  switch (alert.condition) {
    case "above":
      return currentPrice > alert.targetPrice;
    case "below":
      return currentPrice < alert.targetPrice;
    case "crosses": {
      if (alert.lastCheckedPrice == null) return false;
      const wasBelowOrAt = alert.lastCheckedPrice <= alert.targetPrice;
      const wasAboveOrAt = alert.lastCheckedPrice >= alert.targetPrice;
      const isAbove = currentPrice > alert.targetPrice;
      const isBelow = currentPrice < alert.targetPrice;
      return (wasBelowOrAt && isAbove) || (wasAboveOrAt && isBelow);
    }
  }
}

export function evaluateHaltedAlert(alert: AlertRule, activeHaltTickers: ReadonlySet<string>): boolean {
  if (alert.status !== "active" || alert.condition !== "halted") return false;
  return activeHaltTickers.has(alert.symbol.toUpperCase());
}

export function evaluateShortFloatAlert(alert: AlertRule, shortPercentFloat: number | null): boolean {
  if (alert.status !== "active" || alert.condition !== "short_float") return false;
  if (shortPercentFloat == null || !Number.isFinite(shortPercentFloat)) return false;
  return shortPercentFloat >= alert.targetPrice;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDaysUntil(date: Date, now = new Date()): number {
  return Math.ceil((startOfUtcDay(date) - startOfUtcDay(now)) / DAY_MS);
}

export function evaluateExDivAlert(alert: AlertRule, exDate: Date | null, now = new Date()): boolean {
  if (alert.status !== "active" || alert.condition !== "ex_div") return false;
  if (!exDate || Number.isNaN(exDate.getTime())) return false;
  const days = utcDaysUntil(exDate, now);
  return days >= 0 && days <= alert.targetPrice;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function formatAlertDescription(alert: AlertRule): string {
  switch (alert.condition) {
    case "halted":
      return `${alert.symbol} halted`;
    case "short_float":
      return `${alert.symbol} SI ≥ ${alert.targetPrice}%`;
    case "ex_div":
      return `${alert.symbol} ex-div ≤ ${alert.targetPrice}d`;
    case "weather":
      return alert.message ?? `${alert.symbol} weather alert`;
    case "above":
    case "below":
    case "crosses": {
      const prefix = alert.condition === "above" ? ">"
        : alert.condition === "below" ? "<" : "↕";
      return `${alert.symbol} ${prefix} ${alert.targetPrice}`;
    }
    default:
      return alert.message ?? `${alert.symbol} ${alert.condition}`;
  }
}

export function serializeAlerts(alerts: AlertRule[]): string {
  return JSON.stringify(alerts);
}

/**
 * Non-null when the stored blob is not valid alert JSON. Without this a corrupt
 * store deserializes to `[]` and the pane claims the user has no alerts.
 */
export function readAlertsStoreError(json: string): string | null {
  if (!json.trim()) return null;
  try {
    return Array.isArray(JSON.parse(json)) ? null : "Saved alerts are not a list.";
  } catch (error) {
    return error instanceof Error ? error.message : "Saved alerts could not be read.";
  }
}

export function deserializeAlerts(json: string): AlertRule[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a: any) => a?.id && a?.symbol && typeof a?.condition === "string"
      && typeof a?.targetPrice === "number"
      && (BUILTIN_CONDITIONS.has(a.condition) || typeof a.condition === "string")
      && (a.condition !== "weather" || (a.weather?.stationId && a.weather?.condition?.kind)));
  } catch {
    return [];
  }
}
