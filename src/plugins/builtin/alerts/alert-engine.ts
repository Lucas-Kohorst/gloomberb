import { isPriceAlertCondition, type AlertCondition, type AlertRule } from "./types";

export type { AlertRule };

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
 * armedAt marks a new arming, so the cloud can email this rule's trigger again.
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
    armedAt: Date.now(),
    status: "active",
    message: alert.message,
  };
}

export function rearmAlert(alert: AlertRule): AlertRule {
  return editAlert(alert, alert.symbol, alert.condition, alert.targetPrice);
}

/** True while the alert's snooze window still holds; a missing or past `snoozedUntil` means not snoozed. */
export function isAlertSnoozed(alert: Pick<AlertRule, "snoozedUntil">, now = Date.now()): boolean {
  return alert.snoozedUntil != null && alert.snoozedUntil > now;
}

export type AlertSnoozeState = "snoozed" | "rearmed" | "active";

/**
 * Snooze gate for one poll cycle. `"snoozed"` while the window still holds —
 * evaluation is skipped. Once the window passes, the stale `snoozedUntil` is
 * cleared in place and the alert re-arms silently (`"rearmed"`) so evaluation
 * resumes without a notification. Alerts without a window report `"active"`.
 */
export function resolveAlertSnooze(alert: AlertRule, now = Date.now()): AlertSnoozeState {
  if (alert.snoozedUntil == null) return "active";
  if (isAlertSnoozed(alert, now)) return "snoozed";
  delete alert.snoozedUntil;
  return "rearmed";
}

/**
 * Snoozes an alert for `durationMs`. A triggered alert re-arms (the trigger
 * and quote lifecycle drop so `crosses` starts from a fresh baseline, and
 * `armedAt` moves so the cloud can email the next trigger) and evaluation is
 * held until the window passes. An already-active alert only gains the window.
 */
export function snoozeAlert(alert: AlertRule, durationMs: number, now = Date.now()): AlertRule {
  const snoozed: AlertRule = { ...alert, status: "active", snoozedUntil: now + durationMs };
  if (alert.status === "triggered") {
    snoozed.armedAt = now;
    delete snoozed.triggeredAt;
    delete snoozed.lastCheckedPrice;
    delete snoozed.lastCheckedAt;
    delete snoozed.lastCheckError;
    delete snoozed.lastQuoteUpdatedAt;
    delete snoozed.lastQuoteSource;
    delete snoozed.lastQuoteProviderId;
  }
  return snoozed;
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

/**
 * `shortPercentOfFloat` is a fraction (0.0127 means 1.27%). `targetPrice` is the
 * percent the user typed (5 means 5%). A missing value does not fire.
 */
export function shortFloatPercent(fraction: number): number {
  return fraction * 100;
}

export function evaluateShortFloatAlert(
  alert: AlertRule,
  shortPercentOfFloat: number | null | undefined,
): boolean {
  if (alert.status !== "active" || alert.condition !== "short_float") return false;
  if (shortPercentOfFloat == null || !Number.isFinite(shortPercentOfFloat)) return false;
  return shortFloatPercent(shortPercentOfFloat) >= alert.targetPrice;
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

/** `YYYY-MM-DD` from fundamentals, read as a UTC calendar date. Anything else does not fire. */
export function parseExDividendDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function evaluatePctDayAlert(alert: AlertRule, changePercent: number | undefined): boolean {
  return alert.status === "active"
    && alert.condition === "pct_day"
    && Number.isFinite(changePercent)
    && Math.abs(changePercent!) >= alert.targetPrice;
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
    case "pct_day":
      return `${alert.symbol} day move ≥ ${alert.targetPrice}%`;
    case "above":
    case "below":
    case "crosses": {
      const prefix = alert.condition === "above" ? ">"
        : alert.condition === "below" ? "<" : "↕";
      return `${alert.symbol} ${prefix} ${alert.targetPrice}`;
    }
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
    // Keep every stored condition that still has a target, including above/below/crosses
    // from before halted, short_float, ex_div, and pct_day existed.
    return parsed.filter((a: any) =>
      a?.id && a?.symbol && typeof a?.condition === "string" && a.condition
      && typeof a?.targetPrice === "number"
    );
  } catch {
    return [];
  }
}
