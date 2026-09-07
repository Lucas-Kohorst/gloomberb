import { useCallback, useMemo, useState } from "react";
import { Box, Text, TextAttributes, useUiHost } from "../../../../ui";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../../components";
import { colors, priceColor } from "../../../../theme/colors";
import { displayWidth, formatNumber, padTo } from "../../../../utils/format";
import { formatMarketPriceWithCurrency } from "../../../../market-data/market/format";
import { t } from "../../../../i18n";
import { useAppLanguage } from "../../../../i18n/react";
import {
  applySortPreference,
  nextSortPreference,
  type SortComparableValue,
  type SortPreference,
} from "../../../../utils/sort-values";
import type { Quote } from "../../../../types/financials";
import type { PositionTableRow, StatField } from "./types";

const STAT_COLUMN_GAP = 2;
const STAT_LABEL_WIDTH = 12;
const BOOK_LABEL_WIDTH = 4;
const RANGE_ENDPOINT_WIDTH = 11;

export type PositionColumnId = "account" | "qty" | "avg" | "mark" | "cost" | "value" | "pnl" | "ret";
export type PositionColumn = DataTableColumn & { id: PositionColumnId };

function RangeTrack({
  barWidth,
  markerIndex,
  position,
  markerColor,
}: {
  barWidth: number;
  markerIndex: number;
  position: number;
  markerColor: string;
}) {
  // The desktop webview must not draw rules out of box-drawing glyphs.
  if (useUiHost().kind === "desktop-web") {
    return (
      <Box
        marginLeft={1}
        marginRight={1}
        width={barWidth}
        height={1}
        style={{ position: "relative", justifyContent: "center" }}
      >
        <Box style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: "2px",
          borderRadius: "1px",
          backgroundColor: colors.border,
        }} />
        <Box style={{
          position: "absolute",
          left: `${position * 100}%`,
          width: "8px",
          height: "8px",
          marginLeft: "-4px",
          borderRadius: "50%",
          backgroundColor: markerColor,
        }} />
      </Box>
    );
  }

  return (
    <Box marginLeft={1} marginRight={1} width={barWidth} flexDirection="row">
      <Text fg={colors.border}>{"\u2500".repeat(markerIndex)}</Text>
      <Text fg={markerColor}>{"\u25cf"}</Text>
      <Text fg={colors.border}>{"\u2500".repeat(Math.max(0, barWidth - markerIndex - 1))}</Text>
    </Box>
  );
}

export function CompactRangeBar({
  current,
  low,
  high,
  label,
  width,
  currency,
  assetCategory,
  markerColor,
}: {
  current: number;
  low: number;
  high: number;
  label: string;
  width: number;
  currency: string;
  assetCategory?: string;
  markerColor: string;
}) {
  const range = high - low;
  if (range <= 0) return null;
  const position = Math.max(0, Math.min(1, (current - low) / range));
  const pctLabel = `${Math.round(position * 100)}%`;
  const lowText = formatMarketPriceWithCurrency(low, currency, { assetCategory });
  const highText = formatMarketPriceWithCurrency(high, currency, { assetCategory });
  const endpointWidth = Math.min(
    RANGE_ENDPOINT_WIDTH,
    Math.max(7, Math.floor((width - 8) / 3)),
  );
  const barWidth = Math.max(5, width - endpointWidth * 2 - 2);
  const markerIndex = Math.max(0, Math.min(barWidth - 1, Math.round(position * (barWidth - 1))));
  const labelWidth = Math.max(0, width - displayWidth(pctLabel));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box flexDirection="row" height={1}>
        <Box width={labelWidth} overflow="hidden">
          <Text fg={colors.textDim}>{label}</Text>
        </Box>
        <Text fg={markerColor}>{pctLabel}</Text>
      </Box>
      <Box flexDirection="row" height={1}>
        <Box width={endpointWidth} overflow="hidden">
          <Text fg={colors.textDim}>{lowText}</Text>
        </Box>
        <RangeTrack
          barWidth={barWidth}
          markerIndex={markerIndex}
          position={position}
          markerColor={markerColor}
        />
        <Box flexDirection="row" width={endpointWidth} justifyContent="flex-end" overflow="hidden">
          <Text fg={colors.textDim}>{highText}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function BookRow({
  label,
  value,
  width,
  valueColor,
}: {
  label: string;
  value: string;
  width: number;
  valueColor: string;
}) {
  return (
    <Box flexDirection="row" height={1} width={width}>
      <Text fg={colors.textDim}>{padTo(label, BOOK_LABEL_WIDTH)}</Text>
      <Text fg={valueColor}>{value}</Text>
    </Box>
  );
}

export function QuoteBook({ quote, assetCategory, width }: { quote: Quote; assetCategory?: string; width: number }) {
  const bidPrice = quote.bid != null
    ? formatMarketPriceWithCurrency(quote.bid, quote.currency, { assetCategory })
    : "—";
  const askPrice = quote.ask != null
    ? formatMarketPriceWithCurrency(quote.ask, quote.currency, { assetCategory })
    : "—";
  const bidText = quote.bidSize != null && quote.bidSize > 0 ? `${formatNumber(quote.bidSize, 0)} x ${bidPrice}` : bidPrice;
  const askText = quote.askSize != null && quote.askSize > 0 ? `${formatNumber(quote.askSize, 0)} x ${askPrice}` : askPrice;
  let spreadText = "—";
  if (quote.bid != null && quote.ask != null) {
    const spread = quote.ask - quote.bid;
    const mid = (quote.ask + quote.bid) / 2;
    const spreadPercent = mid > 0 ? ` (${((spread / mid) * 100).toFixed(2)}%)` : "";
    spreadText = `${formatMarketPriceWithCurrency(spread, quote.currency, { assetCategory })}${spreadPercent}`;
  }

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <BookRow label={t("Bid")} value={bidText} width={width} valueColor={colors.borderFocused} />
      <BookRow label={t("Ask")} value={askText} width={width} valueColor={colors.negative} />
      <BookRow label={t("Spr")} value={spreadText} width={width} valueColor={colors.textDim} />
    </Box>
  );
}

export function StatGrid({ fields, width }: { fields: StatField[]; width: number }) {
  const columnCount = width >= 58 ? 2 : 1;
  const availableWidth = width - STAT_COLUMN_GAP * (columnCount - 1);
  const baseColWidth = Math.floor(availableWidth / columnCount);
  const extraWidth = availableWidth - baseColWidth * columnCount;
  const colWidths = Array.from({ length: columnCount }, (_, index) => baseColWidth + (index === columnCount - 1 ? extraWidth : 0));
  const rows: Array<Array<StatField | null>> = [];
  for (let i = 0; i < fields.length; i += columnCount) {
    rows.push(Array.from({ length: columnCount }, (_, offset) => fields[i + offset] ?? null));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={i} flexDirection="row" height={1}>
          {row.map((field, j) => {
            const colWidth = colWidths[j] ?? baseColWidth;
            if (!field) {
              return (
                <Box key={j} flexDirection="row">
                  {j > 0 && <Box width={STAT_COLUMN_GAP} />}
                  <Box width={colWidth} />
                </Box>
              );
            }
            const labelWidth = Math.min(STAT_LABEL_WIDTH, Math.max(8, Math.floor(colWidth * 0.45)));
            const valueWidth = Math.max(1, colWidth - labelWidth);
            return (
              <Box key={j} flexDirection="row">
                {j > 0 && <Box width={STAT_COLUMN_GAP} />}
                <Box width={colWidth} flexDirection="row">
                  <Box width={labelWidth} overflow="hidden">
                    <Text fg={colors.textDim}>{t(field.label)}</Text>
                  </Box>
                  <Box flexDirection="row" width={valueWidth} justifyContent="flex-end" overflow="hidden">
                    <Text fg={field.valueColor ?? colors.text}>{field.value}</Text>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <Box height={1}>
      <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>{title}</Text>
    </Box>
  );
}

function positionColumns(): PositionColumn[] {
  return [
    { id: "account", label: t("Account"), width: 10, align: "left", flexGrow: 1 },
    { id: "qty", label: t("Qty"), width: 8, align: "right" },
    { id: "avg", label: t("Avg"), width: 9, align: "right" },
    { id: "mark", label: t("Mark"), width: 9, align: "right" },
    { id: "cost", label: t("Cost"), width: 11, align: "right" },
    { id: "value", label: t("Value"), width: 11, align: "right" },
    { id: "pnl", label: t("P&L"), width: 12, align: "right" },
    { id: "ret", label: t("Ret"), width: 7, align: "right" },
  ];
}

function positionCellNumber(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9eE.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function positionSortValue(row: PositionTableRow, columnId: PositionColumnId): SortComparableValue {
  if (columnId === "account") return row.account;
  if (columnId === "pnl" || columnId === "ret") return row.pnlValue;
  if (columnId === "qty") {
    const parsed = Number.parseFloat(row.qty);
    return Number.isFinite(parsed) ? parsed : row.qty;
  }
  return positionCellNumber(row[columnId]) ?? row[columnId];
}

export function PositionTable({ rows, width }: { rows: PositionTableRow[]; width: number }) {
  const language = useAppLanguage();
  const columns = useMemo(() => positionColumns(), [language]);
  const [sortPreference, setSortPreference] = useState<SortPreference<PositionColumnId>>({
    columnId: null,
    direction: "asc",
  });
  const items = useMemo(
    () => applySortPreference(rows, sortPreference, positionSortValue),
    [rows, sortPreference],
  );
  const tableHeight = 1 + Math.max(items.length, 1);
  const renderCell = useCallback((
    row: PositionTableRow,
    column: PositionColumn,
  ): DataTableCell => {
    if (column.id === "account") {
      return { text: row.account, color: colors.textBright };
    }
    if (column.id === "pnl" || column.id === "ret") {
      return { text: row[column.id], color: priceColor(row.pnlValue ?? 0) };
    }
    return { text: row[column.id], color: colors.text };
  }, []);

  return (
    <Box width={width} height={tableHeight} flexShrink={0}>
      <DataTableView<PositionTableRow, PositionColumn>
        focused={false}
        keyboardNavigation={false}
        rootWidth={width}
        rootHeight={tableHeight}
        selection={{ kind: "none" }}
        columns={columns}
        items={items}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
          current,
          columnId as PositionColumnId,
          { defaultDirection: columnId === "account" ? "asc" : "desc" },
        ))}
        getItemKey={(row, index) => `${row.account}:${row.qty}:${index}`}
        renderCell={renderCell}
        emptyStateTitle={t("No positions")}
        horizontalPadding={0}
      />
    </Box>
  );
}
