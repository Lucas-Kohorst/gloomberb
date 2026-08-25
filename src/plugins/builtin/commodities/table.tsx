import type { DataTableCell, DataTableColumn } from "../../../components";
import { type ColumnVisibilityColumn } from "../../../components/data-table/column-settings";
import { colors, priceColor } from "../../../theme/colors";
import type { Quote } from "../../../types/financials";
import { TextAttributes } from "../../../ui";
import { formatNumber, formatPercentRaw } from "../../../utils/format";
import { marketStatusDot } from "../shared/market-status-dot";
import type { BoardQuoteMap } from "../shared/use-quote-board";
import type { CommodityColumnId, CommodityTableRow } from "./model";
import { COMMODITY_SECTOR_LABELS } from "./contracts";

export type CommodityColumn = DataTableColumn & { id: CommodityColumnId };

export const COMMODITY_COLUMN_DEFS: readonly ColumnVisibilityColumn[] = [
  { id: "status", label: "", description: "Session indicator." },
  { id: "code", label: "SYM", description: "Exchange contract code." },
  { id: "name", label: "CONTRACT", description: "Contract name." },
  { id: "price", label: "LAST", description: "Last traded price." },
  { id: "change", label: "CHG", description: "Change on the session." },
  { id: "changePercent", label: "CHG%", description: "Percent change on the session." },
];

export const DEFAULT_COMMODITY_COLUMN_IDS = COMMODITY_COLUMN_DEFS.map((column) => column.id);

export function createCommodityColumns(width: number): CommodityColumn[] {
  const statusWidth = 1;
  const codeWidth = 5;
  const priceWidth = 12;
  const changeWidth = 10;
  const changePercentWidth = 9;
  const columnCount = COMMODITY_COLUMN_DEFS.length;
  const fixed = statusWidth + codeWidth + priceWidth + changeWidth + changePercentWidth;
  const nameWidth = Math.max(10, width - 2 - columnCount - fixed);

  return [
    { id: "status", label: "", width: statusWidth, align: "left" },
    { id: "code", label: "SYM", width: codeWidth, align: "left" },
    { id: "name", label: "CONTRACT", width: nameWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "change", label: "CHG", width: changeWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: changePercentWidth, align: "right" },
  ];
}

function priceDecimals(price: number): number {
  const magnitude = Math.abs(price);
  if (magnitude >= 10) return 2;
  if (magnitude >= 1) return 4;
  return 6;
}

function trimTrailingZeros(text: string): string {
  if (!text.includes(".")) return text;
  const trimmed = text.replace(/0+$/, "");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length >= 2) return trimmed;
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function formatContractPrice(quote: Quote): string {
  if (!Number.isFinite(quote.price)) return "—";
  const text = trimTrailingZeros(formatNumber(quote.price, priceDecimals(quote.price)));
  return quote.currency === "USX" ? `${text}c` : text;
}

function formatContractChange(quote: Quote): string {
  if (!Number.isFinite(quote.change)) return "—";
  const decimals = Number.isFinite(quote.price) ? priceDecimals(quote.price) : 2;
  const text = trimTrailingZeros(formatNumber(Math.abs(quote.change), decimals));
  return `${quote.change >= 0 ? "+" : "-"}${text}`;
}

export function renderCommodityCell(
  row: CommodityTableRow,
  column: CommodityColumn,
  rowState: { selected: boolean },
  quotes: BoardQuoteMap,
): DataTableCell {
  if (row.type === "header") {
    if (column.id === "code") {
      return {
        text: COMMODITY_SECTOR_LABELS[row.sector],
        color: colors.textMuted,
        attributes: TextAttributes.BOLD,
      };
    }
    return { text: "" };
  }

  const { contract } = row;
  const state = quotes.get(contract.symbol);
  const quote = state?.quote;
  const selectedColor = rowState.selected ? colors.selectedText : undefined;
  const dimmed = rowState.selected ? colors.selectedText : colors.textDim;

  switch (column.id) {
    case "status": {
      const dot = marketStatusDot(quote?.marketState);
      return { text: dot.char, color: dot.color };
    }
    case "code":
      return { text: contract.code, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "name":
      return { text: contract.name, color: selectedColor };
    case "price":
      if (state?.loading && !quote) return { text: "…", color: dimmed };
      if (state?.error || !quote) return { text: "—", color: dimmed };
      return { text: formatContractPrice(quote), color: selectedColor };
    case "change":
      if (!quote || !Number.isFinite(quote.change)) return { text: "—", color: dimmed };
      return { text: formatContractChange(quote), color: selectedColor ?? priceColor(quote.change) };
    case "changePercent":
      if (!quote || !Number.isFinite(quote.changePercent)) return { text: "—", color: dimmed };
      return {
        text: formatPercentRaw(quote.changePercent),
        color: selectedColor ?? priceColor(quote.changePercent),
      };
  }
}
