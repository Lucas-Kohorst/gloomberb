import { canonicalExchange } from "../../../utils/exchanges";
import { createAlert, deserializeAlerts, readAlertsStoreError, serializeAlerts } from "./alert-engine";
import { ALERTS_KEY } from "./constants";
import type { AlertCondition, AlertRule } from "./types";

/** Where price alerts are stored: the alerts plugin's synced config. */
export const PRICE_ALERTS_STORE = { pluginId: "alerts", key: ALERTS_KEY } as const;

export interface AlertTarget {
  symbol: string;
  exchange?: string;
}

function watches(alert: Pick<AlertRule, "symbol" | "exchange">, target: AlertTarget): boolean {
  if (alert.symbol.trim().toUpperCase() !== target.symbol.trim().toUpperCase()) return false;
  // An alert set without an exchange watches the symbol wherever it is charted.
  return !alert.exchange || !target.exchange || canonicalExchange(alert.exchange) === canonicalExchange(target.exchange);
}

/** Active price alerts on a listing: the levels its charts also draw. */
export function activePriceAlertsFor(alertsJson: unknown, target: AlertTarget): AlertRule[] {
  if (typeof alertsJson !== "string") return [];
  return deserializeAlerts(alertsJson).filter((alert) => (
    alert.status === "active"
    && (alert.condition === "above" || alert.condition === "below" || alert.condition === "crosses")
    && Number.isFinite(alert.targetPrice)
    && watches(alert, target)
  ));
}

/**
 * The condition that fires when the price reaches `level` from where it
 * trades now: above for a level overhead, below for one underneath, and
 * crosses when the price sits on it or is unknown.
 */
export function levelAlertCondition(level: number, currentPrice: number | null): AlertCondition {
  if (currentPrice === null || !Number.isFinite(currentPrice) || level === currentPrice) return "crosses";
  return level > currentPrice ? "above" : "below";
}

/**
 * The alerts store with a price alert at a chart level added. An active alert
 * already watching that price on the listing is returned instead of a
 * duplicate, and a store that does not parse is left alone.
 */
export function addLevelAlert(
  storeJson: string | null | undefined,
  target: AlertTarget,
  level: number,
  currentPrice: number | null,
): { json: string; alert: AlertRule; created: boolean } | { error: string } {
  const json = storeJson ?? "[]";
  const error = readAlertsStoreError(json);
  if (error) return { error };
  const alerts = deserializeAlerts(json);
  const existing = alerts.find((alert) => (
    alert.status === "active" && alert.targetPrice === level && watches(alert, target)
  ));
  if (existing) return { json, alert: existing, created: false };
  const alert = createAlert(target.symbol, levelAlertCondition(level, currentPrice), level, target.exchange);
  return { json: serializeAlerts([...alerts, alert]), alert, created: true };
}
