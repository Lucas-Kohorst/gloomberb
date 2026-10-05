import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, TextAttributes } from "../../../ui";
import {
  DataTableView,
  PaneListChrome,
  usePaneFooter,
  usePaneListSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { formatCompact, formatNumber } from "../../../utils/format";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import type { PaneProps } from "../../../types/plugin";
import type { ScannerHiloExtreme } from "../../../api-client";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { usePluginPaneActions, usePluginTickerActions } from "../../runtime";
import { paneSearchHint } from "../shared/pane-footer";
import { ScannerDeniedState } from "./denied";
import { useHiloFeed, useScannerStatusFooter } from "./feed";
import { HiloBars } from "./hilo-bars";
import { ScannerWaitingState } from "./waiting";
import { filterHiloRows, type HiloMinPrice, type HiloSort } from "./hilo-model";

type Side = "lows" | "highs";

function hiloRowId(row: ScannerHiloExtreme): string {
  return `${row.symbol}:${row.at}:${row.price}`;
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
  const [minPrice] = usePaneSettingValue<HiloMinPrice>("minPrice", "1");
  const [sort] = usePaneSettingValue<HiloSort>("sort", "recent");
  const [activeSide, setActiveSide] = useState<Side>("lows");
  const [selected, setSelected] = useState<Record<Side, string | null>>({ lows: null, highs: null });
  const [tableSort, setTableSort] = useState<SortPreference<string>>({ columnId: null, direction: "desc" });
  const [searchQuery, setSearchQuery] = useState("");
  const listSearch = usePaneListSearch({
    focused,
    enabled: !feed.denied,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: "symbol",
  });

  const needle = searchQuery.trim().toLowerCase();
  const lows = useMemo(() => {
    const filtered = filterHiloRows(feed.payload?.lows, minPrice, sort);
    return needle.length === 0
      ? filtered
      : filtered.filter((row) => row.symbol.toLowerCase().includes(needle));
  }, [feed.payload?.lows, minPrice, needle, sort]);
  const highs = useMemo(() => {
    const filtered = filterHiloRows(feed.payload?.highs, minPrice, sort);
    return needle.length === 0
      ? filtered
      : filtered.filter((row) => row.symbol.toLowerCase().includes(needle));
  }, [feed.payload?.highs, minPrice, needle, sort]);
  const sortRows = useCallback((rows: ScannerHiloExtreme[]) => (
    applySortPreference(rows, tableSort, (row, columnId) => {
      switch (columnId) {
        case "symbol":
          return row.symbol.toLowerCase();
        case "price":
          return row.price;
        case "count":
          return row.count;
        default:
          return null;
      }
    })
  ), [tableSort]);
  const sortedLows = useMemo(() => sortRows(lows), [lows, sortRows]);
  const sortedHighs = useMemo(() => sortRows(highs), [highs, sortRows]);
  const handleHeaderClick = useCallback((columnId: string) => {
    setTableSort((current) => nextSortPreference(current, columnId, {
      defaultDirection: (id) => (id === "symbol" ? "asc" : "desc"),
    }));
  }, []);

  useEffect(() => {
    setSelected((current) => {
      const lowsId = current.lows && sortedLows.some((row) => hiloRowId(row) === current.lows)
        ? current.lows
        : sortedLows[0] ? hiloRowId(sortedLows[0]) : null;
      const highsId = current.highs && sortedHighs.some((row) => hiloRowId(row) === current.highs)
        ? current.highs
        : sortedHighs[0] ? hiloRowId(sortedHighs[0]) : null;
      if (lowsId === current.lows && highsId === current.highs) return current;
      return { lows: lowsId, highs: highsId };
    });
  }, [sortedHighs, sortedLows]);

  useScannerStatusFooter("hilo", feed, focused && !listSearch.searchFocused);
  usePaneFooter("scanner-hilo-search", () => (
    feed.denied ? null : {
      hints: [paneSearchHint(listSearch.focusSearch, { disabled: listSearch.searchFocused })],
    }
  ), [feed.denied, listSearch.focusSearch, listSearch.searchFocused]);

  const split = width >= SPLIT_MIN_WIDTH;
  const showBars = height >= BARS_MIN_HEIGHT;
  // One cell of gutter keeps the two cursors from reading as a single wide row.
  const tableWidth = split ? Math.max(12, Math.floor((width - 1) / 2)) : Math.max(12, width);
  const tableHeight = Math.max(2, height - (showBars ? BARS_HEIGHT : 0) - 1);
  const columns = useMemo(() => buildColumns(tableWidth), [tableWidth]);

  const handleSelect = useCallback((side: Side, row: ScannerHiloExtreme) => {
    setActiveSide(side);
    const id = hiloRowId(row);
    setSelected((current) => (current[side] === id ? current : { ...current, [side]: id }));
    selectTicker(row.symbol);
  }, [selectTicker]);

  const handleSideSwitchKey = useCallback((event: DataTableKeyEvent) => {
    if (listSearch.handleSearchKey(event)) return true;
    if (event.name !== "left" && event.name !== "right") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    setActiveSide(event.name === "left" ? "lows" : "highs");
    return true;
  }, [listSearch.handleSearchKey]);

  if (feed.denied) {
    return <ScannerDeniedState reason={feed.deniedReason} />;
  }

  const renderTable = (side: Side, rows: ScannerHiloExtreme[]) => (
    <DataTableView<ScannerHiloExtreme>
      focused={focused && !listSearch.searchFocused && activeSide === side}
      selection={{
        kind: "id",
        selectedId: selected[side],
        // The feed can report the same symbol more than once. Index is omitted
        // so a sort does not move the selection onto a different symbol.
        getId: (row) => hiloRowId(row),
        onChange: (_id, row) => handleSelect(side, row),
      }}
      onRootKeyDown={handleSideSwitchKey}
      rootWidth={tableWidth}
      rootHeight={tableHeight}
      columns={columns}
      items={rows}
      sortColumnId={tableSort.columnId}
      sortDirection={tableSort.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => hiloRowId(row)}
      onActivate={(row) => pinTicker(row.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID })}
      renderCell={(row, column, _index, rowState) => renderCell(side, row, column, rowState)}
      emptyContent={feed.payload ? undefined : <ScannerWaitingState />}
      emptyStateTitle={needle.length > 0 ? "No symbols match." : "Nothing above the price filter yet."}
    />
  );

  return (
    <Box flexDirection="column" width={width} height={height}>
      {showBars && <HiloBars windows={feed.payload?.windows} width={width} />}
      <PaneListChrome width={width} focused={focused} search={listSearch.search} />
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {split ? (
          <>
            {renderTable("lows", sortedLows)}
            <Box width={1} flexShrink={0} />
            {renderTable("highs", sortedHighs)}
          </>
        ) : (
          // Too narrow for both: show the focused side and keep left/right switching it.
          renderTable(activeSide, activeSide === "lows" ? sortedLows : sortedHighs)
        )}
      </Box>
    </Box>
  );
}

export default HiloPane;
