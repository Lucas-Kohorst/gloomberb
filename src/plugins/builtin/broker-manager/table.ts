import { TextAttributes } from "../../../ui";
import type { DataTableCell, DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { formatBrokerUpdatedAt, type BrokerDisplayState, type BrokerProfileRow } from "./model";
import { t } from "../../../i18n";
import { truncateToDisplayWidth } from "../../../utils/format";

type BrokerColumnId = "profile" | "status" | "broker" | "mode" | "accounts" | "updated";
export type BrokerColumn = DataTableColumn & { id: BrokerColumnId };

export function stateColor(state: BrokerDisplayState): string {
  switch (state) {
    case "connected": return colors.positive;
    case "connecting": return colors.warning;
    case "error": return colors.negative;
    case "disabled": return colors.textMuted;
    case "unavailable": return colors.negative;
    default: return colors.textDim;
  }
}

function stateGlyph(state: BrokerDisplayState): string {
  switch (state) {
    case "connected": return "*";
    case "connecting": return "~";
    case "error": return "!";
    case "disabled": return "-";
    case "unavailable": return "x";
    default: return "o";
  }
}

export function truncate(value: string, width: number): string {
  return truncateToDisplayWidth(value, width);
}

export function isBrokerErrorMessage(message: string | null | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("failed") || normalized.includes("required");
}

export function buildBrokerColumns(): BrokerColumn[] {
  return [
    { id: "profile", label: t("PROFILE"), width: 16, align: "left", flexGrow: 1 },
    { id: "status", label: t("STATUS"), width: 13, align: "left" },
    { id: "broker", label: t("BROKER"), width: 18, align: "left" },
    { id: "mode", label: t("MODE"), width: 11, align: "left" },
    { id: "accounts", label: t("ACCOUNTS"), width: 14, align: "right" },
    { id: "updated", label: t("SYNCED"), width: 9, align: "right" },
  ];
}

export function renderBrokerCell(row: BrokerProfileRow, column: BrokerColumn): DataTableCell {
  switch (column.id) {
    case "profile":
      return {
        text: row.label,
        color: colors.text,
        attributes: TextAttributes.BOLD,
      };
    case "status":
      return {
        text: `${stateGlyph(row.state)} ${row.stateLabel}`,
        color: stateColor(row.state),
      };
    case "broker":
      return { text: row.brokerName, color: colors.textDim };
    case "mode":
      return { text: row.mode, color: colors.textDim };
    case "accounts":
      return { text: row.accountSummary, color: row.accountCount > 0 ? colors.text : colors.textMuted };
    case "updated":
      return { text: formatBrokerUpdatedAt(row.lastSyncedAt), color: colors.textMuted };
  }
}
