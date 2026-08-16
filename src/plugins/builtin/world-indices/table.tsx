import type { DataTableCell, DataTableColumn } from "../../../components";
import { type ColumnVisibilityColumn } from "../../../components/data-table/column-settings";
import { colors, priceColor } from "../../../theme/colors";
import type { MarketState } from "../../../types/financials";
import { TextAttributes } from "../../../ui";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { marketStatusDot } from "../shared/market-status-dot";
import type { BoardQuoteMap } from "../shared/use-quote-board";
import type { WorldIndexColumnId, WorldIndexTableRow } from "./model";

export type WorldIndexColumn = DataTableColumn & { id: WorldIndexColumnId };

export const WORLD_INDEX_COLUMN_DEFS: readonly ColumnVisibilityColumn[] = [
  { id: "status", label: "", description: "Live trading session indicator." },
  { id: "symbol", label: "INDEX", description: "Index ticker." },
  { id: "name", label: "NAME", description: "Index name." },
  { id: "price", label: "LAST", description: "Last price." },
  { id: "changePercent", label: "CHG%", description: "Percent change." },
];

export const DEFAULT_WORLD_INDEX_COLUMN_IDS = WORLD_INDEX_COLUMN_DEFS.map(
  (column) => column.id,
);

export function createWorldIndexColumns(width: number): WorldIndexColumn[] {
  const statusWidth = 1;
  const symbolWidth = 8;
  const priceWidth = 15;
  const changeWidth = 9;
  const columnCount = 5;
  const fixedWidth = statusWidth + symbolWidth + priceWidth + changeWidth;
  const nameWidth = Math.max(10, width - 2 - columnCount - fixedWidth);

  return [
    { id: "status", label: "", width: statusWidth, align: "left" },
    { id: "symbol", label: "INDEX", width: symbolWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: changeWidth, align: "right" },
  ];
}

export function renderWorldIndexCell(
  row: WorldIndexTableRow,
  column: WorldIndexColumn,
  rowState: { selected: boolean },
  quotes: BoardQuoteMap,
): DataTableCell {
  if (row.type === "header") return { text: "" };

  const { entry } = row;
  const state = quotes.get(entry.symbol);
  const quote = state?.quote;
  const selectedColor = rowState.selected ? colors.selectedText : undefined;

  switch (column.id) {
    case "status": {
      const dot = marketStatusDot(quote?.marketState);
      return { text: dot.char, color: dot.color };
    }
    case "symbol":
      return {
        text: entry.shortName,
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "name":
      return {
        text: entry.name,
        color: selectedColor,
      };
    case "price":
      if (state?.loading && !quote) {
        return { text: "…", color: rowState.selected ? colors.selectedText : colors.textDim };
      }
      if (state?.error || quote?.price === undefined) {
        return { text: "—", color: rowState.selected ? colors.selectedText : colors.textDim };
      }
      return {
        text: formatCurrency(quote.price, quote.currency ?? "USD"),
        color: selectedColor,
      };
    case "changePercent":
      if (!quote || quote.changePercent === undefined) {
        return { text: "—", color: rowState.selected ? colors.selectedText : colors.textDim };
      }
      return {
        text: formatPercentRaw(quote.changePercent),
        color: selectedColor ?? priceColor(quote.changePercent),
      };
  }
}
