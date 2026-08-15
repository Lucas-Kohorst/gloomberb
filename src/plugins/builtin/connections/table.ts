import { TextAttributes } from "../../../ui";
import type { DataTableCell, DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { truncateToDisplayWidth } from "../../../utils/format";
import { formatRelativeAge } from "../../../utils/relative-time";
import { t } from "../../../i18n";
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
    case "news": return t("News");
    case "broker": return t("Broker");
    case "prediction-market": return t("Prediction");
    case "websocket": return t("WebSocket");
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

export function truncate(value: string, width: number): string {
  return truncateToDisplayWidth(value, width);
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
