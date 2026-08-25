import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type InputRenderable } from "../../../ui";
import {
  DataTableView,
  InputSearchBar,
  usePaneFooter,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
} from "../../../components";
import { buildColumnVisibilityField, resolveVisibleColumns } from "../../../components/data-table/column-settings";
import { useShortcut } from "../../../react/input";
import { usePaneInstance } from "../../../state/app/context";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PaneProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { usePluginTickerActions } from "../../runtime";
import type { PluginModule } from "../plugin-module";
import {
  countFailedQuotes,
  countLoadingQuotes,
  latestQuoteTimestamp,
  useQuoteBoard,
} from "../shared/use-quote-board";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import { paneRefreshHint, paneSearchHint } from "../shared/pane-footer";
import {
  COMMODITY_SYMBOLS,
  getContractsBySector,
  matchesCommoditySearch,
  type CommoditySector,
} from "./contracts";
import {
  buildCommodityRows,
  DEFAULT_COMMODITY_SORT,
  nextCommoditySort,
  type CommoditySortPreference,
  type CommodityTableRow,
} from "./model";
import {
  COMMODITY_COLUMN_DEFS,
  createCommodityColumns,
  DEFAULT_COMMODITY_COLUMN_IDS,
  renderCommodityCell,
  type CommodityColumn,
} from "./table";
import { COMMODITIES_PANE_ID } from "./types";

const REFRESH_INTERVAL_MS = 60_000;

function CommoditiesPane({ focused, width, height }: PaneProps) {
  const { pinTicker } = usePluginTickerActions();
  const paneInstance = usePaneInstance();
  const { quotes, refresh } = useQuoteBoard(COMMODITY_SYMBOLS, REFRESH_INTERVAL_MS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<CommoditySortPreference>(DEFAULT_COMMODITY_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [collapsedSectors, setCollapsedSectors] = useState<Set<CommoditySector>>(new Set());
  const searchInputRef = useRef<InputRenderable | null>(null);

  const contractsBySector = useMemo(() => getContractsBySector(), []);
  const rows = useMemo(
    () => buildCommodityRows(contractsBySector, sortPreference, quotes, {
      filter: (contract) => matchesCommoditySearch(contract, searchQuery),
      collapsed: collapsedSectors,
    }),
    [collapsedSectors, contractsBySector, quotes, searchQuery, sortPreference],
  );

  const columns = useMemo<CommodityColumn[]>(
    () => resolveVisibleColumns(
      createCommodityColumns(width),
      paneInstance?.settings?.columnIds,
      DEFAULT_COMMODITY_COLUMN_IDS,
    ),
    [paneInstance?.settings?.columnIds, width],
  );

  const renderCell = useCallback((
    row: CommodityTableRow,
    column: CommodityColumn,
    _index: number,
    rowState: { selected: boolean },
  ) => renderCommodityCell(row, column, rowState, quotes), [quotes]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const toggleSector = useCallback((sector: CommoditySector) => {
    setCollapsedSectors((current) => {
      const next = new Set(current);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  }, []);

  const selectedRow = useMemo(() => {
    return rows.find((row) => {
      if (row.type === "header") return `header-${row.sector}` === selectedId;
      return row.contract.symbol === selectedId;
    }) ?? null;
  }, [rows, selectedId]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => (
      row.type === "header" ? `header-${row.sector}` : row.contract.symbol
    ) === selectedId)) {
      const firstNavigable = rows.find((row) => row.type === "row") ?? rows[0] ?? null;
      setSelectedId(firstNavigable
        ? (firstNavigable.type === "header" ? `header-${firstNavigable.sector}` : firstNavigable.contract.symbol)
        : null);
    }
  }, [rows, selectedId]);

  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selectedRow || selectedRow.type !== "row") return;
    popOutChart(`FUT:${selectedRow.contract.code}`);
  }, [popOutChart, selectedRow]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    return false;
  }, [focusSearch, graphSelected]);

  const loadingCount = countLoadingQuotes(quotes);
  const failedCount = countFailedQuotes(quotes);
  const latestTs = latestQuoteTimestamp(quotes);
  useAutoRefresh(latestTs || null, refresh);

  usePaneFooter("commodities", () => {
    const info: PaneFooterSegment[] = [];
    if (loadingCount > 0) info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    if (failedCount > 0) {
      info.push({ id: "error", parts: [{ text: "quote error", tone: "warning" }] });
    }
    if (latestTs > 0) {
      info.push({ id: "delayed", parts: [{ text: "delayed", tone: "muted" }] });
    }
    return {
      info,
      hints: [
        { id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !(selectedRow && selectedRow.type === "row") },
        paneSearchHint(focusSearch),
        paneRefreshHint(refresh),
      ],
    };
  }, [failedCount, focusSearch, graphSelected, latestTs, loadingCount, refresh, selectedRow]);

  useShortcut((event) => {
    if (!focused || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !searchFocused });

  return (
    <DataTableView<CommodityTableRow, CommodityColumn>
      focused={focused && !searchFocused}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.type === "row" ? row.contract.symbol : `header-${row.sector}`,
        onChange: (id) => setSelectedId(id),
      }}
      isNavigable={() => true}
      onActivate={(row) => {
        if (row.type === "header") {
          toggleSector(row.sector);
          return;
        }
        pinTicker(row.contract.symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextCommoditySort(current, columnId))}
      getItemKey={(row) => row.type === "row" ? row.contract.symbol : `header-${row.sector}`}
      renderCell={renderCell}
      emptyStateTitle={searchQuery.trim() ? "No matching contracts." : "No contracts configured."}
      rootBefore={(
        <InputSearchBar
          value={searchQuery}
          focused={focused}
          active={searchFocused}
          width={width}
          focusToken={searchFocusToken}
          inputRef={searchInputRef}
          placeholder="oil, gold, wheat"
          debounceMs={80}
          onFocus={focusSearch}
          onBlur={blurSearch}
          onNavigateDown={blurSearch}
          onQueryChange={setSearchQuery}
        />
      )}
      onRootKeyDown={handleRootKeyDown}
    />
  );
}

export const commoditiesModule: PluginModule = {
  panes: [
    {
      id: COMMODITIES_PANE_ID,
      name: "Commodities",
      icon: "C",
      component: CommoditiesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 76, height: 32 },
      settings: {
        title: "Commodities Settings",
        fields: [buildColumnVisibilityField(COMMODITY_COLUMN_DEFS)],
      },
    },
  ],

  paneTemplates: [
    {
      id: "commodities-pane",
      paneId: COMMODITIES_PANE_ID,
      label: "Commodities",
      description:
        "Energy, metals, and agriculture front-month prices from Yahoo: oil, gas, gold, copper, grains, and softs. Delayed session quotes with sortable columns.",
      keywords: [
        "commodities",
        "oil",
        "crude",
        "brent",
        "wti",
        "gold",
        "silver",
        "copper",
        "wheat",
        "corn",
        "soy",
        "natgas",
        "metals",
        "agriculture",
      ],
      category: "Data",
      shortcut: { prefix: "COMM" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
