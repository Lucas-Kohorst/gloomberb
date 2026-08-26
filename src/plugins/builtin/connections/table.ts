import { TextAttributes } from "../../../ui";
import type { DataTableCell, DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { truncateToDisplayWidth } from "../../../utils/format";
import { formatRelativeAge } from "../../../utils/relative-time";
import { t } from "../../../i18n";
import { compareSortValues } from "../../../utils/sort-values";
import type { ConnectionState, ConnectionStatus } from "./types";

type ConnectionColumnId = "service" | "type" | "status" | "lastPoll" | "latency";
export type ConnectionColumn = DataTableColumn & { id: ConnectionColumnId };

export function statusColor(status: ConnectionStatus): string {
  switch (status) {
    case "connected": return colors.positive;
    case "reconnecting": return colors.warning;
    case "error": return colors.negative;
    case "disconnected": return colors.negative;
    case "idle": return colors.textMuted;
    default: return colors.textDim;
  }
}

export function statusGlyph(status: ConnectionStatus): string {
  switch (status) {
    case "connected": return "*";
    case "reconnecting": return "~";
    case "error": return "!";
    case "disconnected": return "x";
    case "idle": return "o";
    default: return ".";
  }
}

export function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected": return t("Connected");
    case "reconnecting": return t("Reconnecting");
    case "error": return t("Error");
    case "disconnected": return t("Disconnected");
    case "idle": return t("Idle");
    default: return status;
  }
}

export function kindLabel(kind: ConnectionState["kind"]): string {
  switch (kind) {
    case "asset-data": return t("Asset Data");
    case "data": return t("Data");
    case "news": return t("News");
    case "broker": return t("Broker");
    case "prediction-market": return t("Prediction");
    case "websocket": return t("WebSocket");
    case "api": return t("API");
    default: return kind;
  }
}

export function formatLatency(latencyMs: number | null): string {
  if (latencyMs == null) return "-";
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

export function formatLastPoll(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) return "-";
  return formatRelativeAge(timestamp, now);
}

export function connectionRowRevision(row: ConnectionState, now = Date.now()): string {
  return [
    row.id,
    row.status,
    row.wsState,
    row.lastError ?? "",
    formatLastPoll(row.lastPolledAt, now),
    formatLatency(row.lastLatencyMs),
    row.successCount,
    row.failureCount,
  ].join(":");
}

export function truncate(value: string, width: number): string {
  return truncateToDisplayWidth(value, width);
}

export type ConnectionSortPreference = {
  columnId: ConnectionColumnId;
  direction: "asc" | "desc";
};

const STATUS_ORDER: Record<ConnectionStatus, number> = {
  error: 0,
  disconnected: 1,
  reconnecting: 2,
  connected: 3,
  idle: 4,
};

export function compareConnections(
  left: ConnectionState,
  right: ConnectionState,
  columnId: ConnectionColumnId,
): number {
  switch (columnId) {
    case "service":
      return left.name.localeCompare(right.name);
    case "type":
      return left.kind.localeCompare(right.kind);
    case "status": {
      const orderDiff = (STATUS_ORDER[left.status] ?? 99) - (STATUS_ORDER[right.status] ?? 99);
      if (orderDiff !== 0) return orderDiff;
      return left.priority - right.priority;
    }
    case "lastPoll":
      return compareSortValues(left.lastPolledAt, right.lastPolledAt, "asc");
    case "latency":
      return compareSortValues(left.lastLatencyMs, right.lastLatencyMs, "asc");
  }
}

export function sortConnections(
  connections: ConnectionState[],
  preference: ConnectionSortPreference,
): ConnectionState[] {
  return [...connections].sort((left, right) => {
    const primary = preference.columnId === "lastPoll"
      ? compareSortValues(left.lastPolledAt, right.lastPolledAt, preference.direction)
      : preference.columnId === "latency"
        ? compareSortValues(left.lastLatencyMs, right.lastLatencyMs, preference.direction)
        : (preference.direction === "asc" ? 1 : -1) * compareConnections(left, right, preference.columnId);
    return primary !== 0 ? primary : left.name.localeCompare(right.name);
  });
}

export function buildConnectionColumns(width: number): ConnectionColumn[] {
  const usableWidth = Math.max(48, width - 4);
  const typeWidth = 12;
  const statusWidth = 14;
  const lastPollWidth = 10;
  const latencyWidth = 8;
  const separators = 5;
  const serviceWidth = Math.max(
    16,
    usableWidth - typeWidth - statusWidth - lastPollWidth - latencyWidth - separators,
  );

  return [
    { id: "service", label: t("SERVICE"), width: serviceWidth, align: "left" },
    { id: "type", label: t("TYPE"), width: typeWidth, align: "left" },
    { id: "status", label: t("STATUS"), width: statusWidth, align: "left" },
    { id: "lastPoll", label: t("LAST POLL"), width: lastPollWidth, align: "right" },
    { id: "latency", label: t("LATENCY"), width: latencyWidth, align: "right" },
  ];
}

export function renderConnectionCell(
  row: ConnectionState,
  column: ConnectionColumn,
): DataTableCell {
  switch (column.id) {
    case "service":
      return {
        text: truncate(row.name, column.width),
        color: colors.text,
        attributes: TextAttributes.BOLD,
      };
    case "type":
      return {
        text: truncate(kindLabel(row.kind), column.width),
        color: colors.textDim,
      };
    case "status": {
      const label = `${statusGlyph(row.status)} ${statusLabel(row.status)}`;
      const text = row.status === "error" && row.lastError
        ? truncate(`${label} ${row.lastError}`, column.width)
        : label;
      return {
        text,
        color: statusColor(row.status),
      };
    }
    case "lastPoll":
      return {
        text: formatLastPoll(row.lastPolledAt),
        color: row.lastPolledAt ? colors.textMuted : colors.textDim,
      };
    case "latency":
      return {
        text: formatLatency(row.lastLatencyMs),
        color: row.lastLatencyMs == null
          ? colors.textDim
          : row.lastLatencyMs > 2000
            ? colors.negative
            : row.lastLatencyMs > 500
              ? colors.warning
              : colors.positive,
      };
  }
}
