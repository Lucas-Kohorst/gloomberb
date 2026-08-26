import { useCallback, useMemo, useState } from "react";
import { Box, TextAttributes } from "../../../ui";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { formatCompact, formatNumber } from "../../../utils/format";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import type { PaneProps } from "../../../types/plugin";
import type { ScannerHiloExtreme } from "../../../api-client";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { usePluginAppActions, usePluginPaneActions, usePluginTickerActions } from "../../runtime";
import { ScannerDeniedState } from "./denied";
import { useHiloFeed, useScannerStatusFooter } from "./feed";
import { HiloBars } from "./hilo-bars";
import { ScannerWaitingState } from "./waiting";
import { filterHiloRows, type HiloMinPrice, type HiloSort } from "./hilo-model";

type Side = "lows" | "highs";

function rowKey(row: ScannerHiloExtreme, index: number): string {
  return `${row.symbol}:${row.at}:${index}`;
}

const BARS_HEIGHT = 4;
/** Below this the two tables cannot both stay legible, so only the focused side is shown. */
const SPLIT_MIN_WIDTH = 42;
/** The bars are the lowest-priority panel: they go first when rows run out. */
const BARS_MIN_HEIGHT = BARS_HEIGHT + 4;

function buildColumns(width: number): DataTableColumn[] {
  const symbolWidth = 8;
  const countWidth = 6;
  // Table chrome is one gap per column, two cells of padding, and the scrollbar.
  const priceWidth = Math.max(7, width - symbolWidth - countWidth - 3 - 2 - 1);
  return [
    { id: "symbol", label: "SYMBOL", width: symbolWidth, align: "left" },
    { id: "price", label: "PRICE", width: priceWidth, align: "right" },
    { id: "count", label: "COUNT", width: countWidth, align: "right" },
  ];
}

function renderCell(
  side: Side,
  row: ScannerHiloExtreme,
  column: DataTableColumn,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;
  const sideColor = side === "lows" ? colors.negative : colors.positive;
  switch (column.id) {
    case "symbol":
      return {
        text: row.symbol,
        color: selectedColor ?? sideColor,
        attributes: TextAttributes.BOLD,
      };
    case "price":
      return {
        text: row.price >= 1000 ? formatNumber(row.price, 2) : row.price.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
        color: selectedColor,
      };
    default:
      return {
        text: formatCompact(row.count),
        color: selectedColor ?? colors.textDim,
      };
  }
}

function HiloPane({ focused, width, height }: PaneProps) {
  const feed = useHiloFeed();
  const { selectTicker } = usePluginPaneActions();
  const { pinTicker } = usePluginTickerActions();
  const { createPaneFromTemplate } = usePluginAppActions();
  const [minPrice] = usePaneSettingValue<HiloMinPrice>("minPrice", "1");
  const [sort] = usePaneSettingValue<HiloSort>("sort", "recent");
  const [activeSide, setActiveSide] = useState<Side>("lows");
  const [selected, setSelected] = useState<Record<Side, string | null>>({ lows: null, highs: null });
  const [sortPreference, setSortPreference] = useState<SortPreference<"symbol" | "price" | "count">>({
    columnId: null,
    direction: "desc",
  });

  const hiloSortValue = useCallback((row: ScannerHiloExtreme, columnId: "symbol" | "price" | "count") => {
    switch (columnId) {
      case "symbol": return row.symbol;
      case "price": return row.price;
      case "count": return row.count;
    }
  }, []);
  const lows = useMemo(
    () => applySortPreference(filterHiloRows(feed.payload?.lows, minPrice, sort), sortPreference, hiloSortValue),
    [feed.payload?.lows, hiloSortValue, minPrice, sort, sortPreference],
  );
  const highs = useMemo(
    () => applySortPreference(filterHiloRows(feed.payload?.highs, minPrice, sort), sortPreference, hiloSortValue),
    [feed.payload?.highs, hiloSortValue, minPrice, sort, sortPreference],
  );

  const selectedSymbol = useMemo(() => {
    const rows = activeSide === "lows" ? lows : highs;
    const key = selected[activeSide];
    if (!key) return rows[0]?.symbol ?? null;
    const match = rows.find((row, index) => rowKey(row, index) === key);
    return match?.symbol ?? rows[0]?.symbol ?? null;
  }, [activeSide, highs, lows, selected]);
  const chartSelected = useCallback(() => {
    if (!selectedSymbol) return;
    createPaneFromTemplate("chart-composer-pane", { arg: selectedSymbol });
  }, [createPaneFromTemplate, selectedSymbol]);

  useScannerStatusFooter("hilo", feed, focused, [
    { id: "graph", key: "g", label: "raph", onPress: chartSelected, disabled: !selectedSymbol },
  ]);

  const split = width >= SPLIT_MIN_WIDTH;
  const showBars = height >= BARS_MIN_HEIGHT;
  // One cell of gutter keeps the two cursors from reading as a single wide row.
  const tableWidth = split ? Math.max(12, Math.floor((width - 1) / 2)) : Math.max(12, width);
  const tableHeight = Math.max(2, height - (showBars ? BARS_HEIGHT : 0));
  const columns = useMemo(() => buildColumns(tableWidth), [tableWidth]);

  const handleSelect = useCallback((side: Side, row: ScannerHiloExtreme, index: number) => {
    setActiveSide(side);
    setSelected((current) => ({ ...current, [side]: rowKey(row, index) }));
    selectTicker(row.symbol);
  }, [selectTicker]);

  const handleSideSwitchKey = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "g") {
      event.preventDefault?.();
      event.stopPropagation?.();
      chartSelected();
      return true;
    }
    if (event.name !== "left" && event.name !== "right") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    setActiveSide(event.name === "left" ? "lows" : "highs");
    return true;
  }, [chartSelected]);

  if (feed.denied) {
    return <ScannerDeniedState reason={feed.deniedReason} />;
  }

  const renderTable = (side: Side, rows: ScannerHiloExtreme[]) => (
    <DataTableView<ScannerHiloExtreme>
      focused={focused && activeSide === side}
      selection={{
        kind: "id",
        selectedId: selected[side],
        // The feed can report the same symbol more than once, so rows need a key
        // of their own instead of the ticker.
        getId: rowKey,
        onChange: (_id, row, index) => handleSelect(side, row, index),
      }}
      onRootKeyDown={handleSideSwitchKey}
      rootWidth={tableWidth}
      rootHeight={tableHeight}
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as "symbol" | "price" | "count",
        { defaultDirection: columnId === "symbol" ? "asc" : "desc" },
      ))}
      getItemKey={rowKey}
      getRowRevision={(row) => `${row.symbol}:${row.at}:${row.price}:${row.count}`}
      onActivate={(row) => pinTicker(row.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID })}
      renderCell={(row, column, _index, rowState) => renderCell(side, row, column, rowState)}
      emptyContent={feed.payload ? undefined : <ScannerWaitingState />}
      emptyStateTitle="Nothing above the price filter yet."
    />
  );

  return (
    <Box flexDirection="column" width={width} height={height}>
      {showBars && <HiloBars windows={feed.payload?.windows} width={width} />}
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {split ? (
          <>
            {renderTable("lows", lows)}
            <Box width={1} flexShrink={0} />
            {renderTable("highs", highs)}
          </>
        ) : (
          // Too narrow for both: show the focused side and keep left/right switching it.
          renderTable(activeSide, activeSide === "lows" ? lows : highs)
        )}
      </Box>
    </Box>
  );
}

export default HiloPane;
