/**
 * Cell rendering for the fundamental screener DataTableView.
 */

import type { DataTableCell } from "../../../components";
import { TextAttributes } from "../../../ui";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatCurrency, formatPercentRaw } from "../../../utils/format";
import type { ScreenerColumn, ScreenerRow } from "./model";

function formatRatio(value: number | null): string {
  if (value == null) return "—";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatGrowth(value: number | null): string {
  if (value == null) return "—";
  return formatPercentRaw(value * 100);
}

function formatYield(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function renderScreenerCell(
  row: ScreenerRow,
  column: ScreenerColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;

  switch (column.id) {
    case "symbol":
      return {
        text: row.symbol,
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "name":
      return { text: row.name, color: selectedColor };
    case "sector":
      return { text: row.sector ?? "—", color: selectedColor ?? colors.textDim };
    case "exchange":
      return { text: row.exchange || "—", color: selectedColor ?? colors.textDim };
    case "price":
      return {
        text: row.price != null ? formatCurrency(row.price, row.currency) : "—",
        color: selectedColor,
      };
    case "marketCap":
      return {
        text: row.marketCap != null ? formatCompact(row.marketCap) : "—",
        color: selectedColor ?? colors.textDim,
      };
    case "peRatio":
      return {
        text: formatRatio(row.peRatio),
        color: selectedColor ?? colors.text,
      };
    case "pbRatio":
      return {
        text: formatRatio(row.pbRatio),
        color: selectedColor ?? colors.text,
      };
    case "debtToEquity":
      return {
        text: formatRatio(row.debtToEquity),
        color: selectedColor ?? colors.text,
      };
    case "revenueGrowth":
      return {
        text: formatGrowth(row.revenueGrowth),
        color: selectedColor ?? priceColor(row.revenueGrowth ?? 0),
      };
    case "grossMargin":
      return {
        text: row.grossMargin != null ? `${(row.grossMargin * 100).toFixed(1)}%` : "—",
        color: selectedColor ?? colors.text,
      };
    case "netMargin":
      return {
        text: row.netMargin != null ? `${(row.netMargin * 100).toFixed(1)}%` : "—",
        color: selectedColor ?? colors.text,
      };
    case "dividendYield":
      return {
        text: formatYield(row.dividendYield),
        color: selectedColor ?? priceColor(row.dividendYield ?? 0),
      };
  }
}
