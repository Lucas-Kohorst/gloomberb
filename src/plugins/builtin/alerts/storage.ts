import type { GloomPluginContext } from "../../../types/plugin";
import {
  deserializeAlertHistory,
  serializeAlertHistory,
  type AlertHistoryEntry,
} from "./history";
import {
  deserializeAlerts,
  serializeAlerts,
} from "./alert-engine";
import { ALERT_HISTORY_KEY, ALERTS_KEY } from "./constants";
import type { AlertRule } from "./types";

export function loadAlerts(ctx: GloomPluginContext): AlertRule[] {
  const json = ctx.configState.get<string>(ALERTS_KEY);
  if (!json) return [];
  return deserializeAlerts(json);
}

export function saveAlerts(
  ctx: GloomPluginContext,
  alerts: AlertRule[],
): void {
  ctx.configState.set(ALERTS_KEY, serializeAlerts(alerts));
}

export function loadAlertHistory(ctx: GloomPluginContext): AlertHistoryEntry[] {
  const json = ctx.configState.get<string>(ALERT_HISTORY_KEY);
  if (!json) return [];
  return deserializeAlertHistory(json);
}

export function saveAlertHistory(
  ctx: GloomPluginContext,
  history: AlertHistoryEntry[],
): void {
  ctx.configState.set(ALERT_HISTORY_KEY, serializeAlertHistory(history));
}
