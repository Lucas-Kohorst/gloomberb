import { useMemo, useState } from "react";
import { DataTableView, type DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { formatNumber } from "../../../utils/format";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import { formatPredictionProbability } from "../metrics";
import type { PredictionTrade } from "../types";

type TradeColumnId = "time" | "side" | "outcome" | "price" | "size";
type TradeColumn = DataTableColumn & { id: TradeColumnId };

const TRADE_COLUMNS: TradeColumn[] = [
  { id: "time", label: "TIME", width: 16, align: "left" },
  { id: "side", label: "SIDE", width: 6, align: "left" },
  { id: "outcome", label: "OUT", width: 4, align: "left" },
  { id: "price", label: "PRICE", width: 8, align: "right" },
  { id: "size", label: "SIZE", width: 10, align: "right" },
];

export function PredictionMarketTradesView({
  focused,
  trades,
  width,
}: {
  focused: boolean;
  trades: PredictionTrade[];
  width: number;
}) {
  const [sortPreference, setSortPreference] = useState<SortPreference<TradeColumnId>>({
    columnId: null,
    direction: "desc",
  });
  const rows = useMemo(
    () => applySortPreference(trades.slice(0, 30), sortPreference, (trade, columnId) => {
      switch (columnId) {
        case "time": return trade.timestamp;
        case "side": return trade.side;
        case "outcome": return trade.outcome;
        case "price": return trade.price;
        case "size": return trade.size;
      }
    }),
    [sortPreference, trades],
  );
  return (
    <DataTableView<PredictionTrade, TradeColumn>
      focused={focused}
      keyboardNavigation={false}
      rootWidth={width}
      rootBackgroundColor={colors.panel}
      selection={{ kind: "none" }}
      columns={TRADE_COLUMNS}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as TradeColumnId,
        { defaultDirection: columnId === "side" || columnId === "outcome" ? "asc" : "desc" },
      ))}
      getItemKey={(trade) => trade.id}
      renderCell={(trade, column) => {
        const tradeColor = trade.side === "buy" ? colors.positive : colors.negative;
        switch (column.id) {
          case "time":
            return {
              text: new Date(trade.timestamp).toLocaleTimeString("en-US", {
                hour12: false,
              }),
              color: colors.textDim,
            };
          case "side":
            return {
              text: trade.side.toUpperCase(),
              color: tradeColor,
            };
          case "outcome":
            return {
              text: trade.outcome.toUpperCase(),
              color: colors.text,
            };
          case "price":
            return {
              text: formatPredictionProbability(trade.price),
              color: tradeColor,
            };
          case "size":
            return {
              text: formatNumber(trade.size, 0),
              color: colors.textDim,
            };
        }
      }}
      emptyStateTitle="No recent trades."
      emptyStateHint="This venue did not return recent prints."
    />
  );
}
