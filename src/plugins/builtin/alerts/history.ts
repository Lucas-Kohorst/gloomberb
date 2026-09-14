import type { AlertRule } from "./types";

export const ALERT_HISTORY_LIMIT = 200;

export interface AlertHistoryEntry {
  /** The rule that triggered. */
  id: string;
  symbol: string;
  condition: string;
  price?: number;
  triggeredAt: number;
}

export function appendAlertHistory(
  entries: readonly AlertHistoryEntry[],
  entry: AlertHistoryEntry,
  limit = ALERT_HISTORY_LIMIT,
): AlertHistoryEntry[] {
  return [...entries, entry].slice(-Math.max(0, limit));
}

export function createAlertHistoryEntry(
  alert: AlertRule,
  condition: string,
  triggeredAt: number,
  price?: number,
): AlertHistoryEntry {
  return {
    id: alert.id,
    symbol: alert.symbol,
    condition,
    ...(price != null && Number.isFinite(price) ? { price } : {}),
    triggeredAt,
  };
}

export function serializeAlertHistory(entries: AlertHistoryEntry[]): string {
  return JSON.stringify(entries);
}

export function deserializeAlertHistory(json: string): AlertHistoryEntry[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry: any): entry is AlertHistoryEntry => (
      entry?.id
      && entry?.symbol
      && typeof entry?.condition === "string"
      && typeof entry?.triggeredAt === "number"
      && (entry.price == null || typeof entry.price === "number")
    ));
  } catch {
    return [];
  }
}
