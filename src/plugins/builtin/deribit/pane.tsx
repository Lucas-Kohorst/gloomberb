import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneInstance, usePluginPaneState } from "../../../public/react";
import { priceColor } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { nextHeaderSort } from "../../../utils/sort-values";
import { fetchDerivatives, type BookSummary } from "./client";
import {
  FUTURE_COLUMNS,
  FUTURE_EXPIRY_SORT,
  OPTION_COLUMNS,
  OPTION_EXPIRY_SORT,
  formatChange,
  formatIndexLevel,
  formatIv,
  formatPrice,
  formatSize,
  futureRows,
  optionExpiryRows,
  resolveCurrency,
  sortFutures,
  sortOptions,
  type FutureRow,
  type FutureSortColumn,
  type OptionExpiryRow,
  type OptionSortColumn,
} from "./model";

const TABS = [
  { label: "Futures", value: "futures" },
  { label: "Options", value: "options" },
];
const NO_ROWS: BookSummary[] = [];

function currencyOf(value: unknown): "BTC" | "ETH" | null {
  try {
    return resolveCurrency(value);
  } catch {
    return null;
  }
}

export function DeribitPane({ focused, width, height }: PaneProps) {
  const instance = usePaneInstance();
  const launched = currencyOf(instance?.params?.currency) ?? "BTC";
  const [storedCurrency, setStoredCurrency] = usePluginPaneState("currency", launched);
  const currency = currencyOf(storedCurrency) ?? launched;
  const [search, setSearch] = usePluginPaneState("instrument", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const loadBook = useCallback(() => {
    if (!currency) return Promise.reject(new Error("Use BTC or ETH"));
    return fetchDerivatives(currency);
  }, [currency]);
  const resource = useAsyncResource(currency ? loadBook : null);
  const data = resource.data;
  const [storedTab, setTab] = usePluginPaneState<string>("tab", "futures");
  const tab = storedTab === "options" ? "options" : "futures";
  const [futureSort, setFutureSort] = useState(FUTURE_EXPIRY_SORT);
  const [optionSort, setOptionSort] = useState(OPTION_EXPIRY_SORT);
  const [futureId, setFutureId] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);

  const futures = useMemo(
    () => sortFutures(futureRows(data?.futures ?? NO_ROWS), futureSort).filter((row) => !needle || row.instrument.toLowerCase().includes(needle)),
    [data?.futures, futureSort, needle],
  );
  const options = useMemo(
    () => sortOptions(optionExpiryRows(data?.options ?? NO_ROWS), optionSort).filter((row) => !needle || row.expiry.toLowerCase().includes(needle)),
    [data?.options, needle, optionSort],
  );

  useEffect(() => {
    if (futureId && futures.some((row) => row.id === futureId)) return;
    setFutureId(futures[0]?.id ?? null);
  }, [futureId, futures]);
  useEffect(() => {
    if (optionId && options.some((row) => row.id === optionId)) return;
    setOptionId(options[0]?.id ?? null);
  }, [optionId, options]);

  const palette = useThemeColors();
  const refresh = useCallback(() => { void resource.reload(); }, [resource.reload]);
  useAutoRefresh(resource.updatedAt, refresh);
  usePaneRefreshKey(refresh, { focused: focused && !searchActive });

  const { strip: tabs, rows: tabRows } = usePaneTabs(currency ? {
    tabs: TABS,
    activeValue: tab,
    onSelect: setTab,
    focused,
    compact: true,
    variant: "bare",
  } : null);

  const info = useMemo<PaneFooterSegment[]>(() => (
    data?.index
      ? [{ id: "index", parts: [{ text: formatIndexLevel(data.index.level), tone: "value" as const }] }]
      : []
  ), [data]);

  usePaneStatusFooter({
    registrationId: "deribit",
    loading: resource.loading,
    error: data ? resource.error : null,
    info,
  });

  const onFutureHeader = useCallback((columnId: string) => {
    setFutureSort((current) => nextHeaderSort(current, columnId as FutureSortColumn, { resetTo: FUTURE_EXPIRY_SORT }));
  }, []);
  const onOptionHeader = useCallback((columnId: string) => {
    setOptionSort((current) => nextHeaderSort(current, columnId as OptionSortColumn, { resetTo: OPTION_EXPIRY_SORT }));
  }, []);

  const renderFuture = useCallback((row: FutureRow, column: { id: string }): DataTableCell => {
    switch (column.id) {
      case "instrument":
        return { text: row.instrument, value: row.instrument, color: palette.textBright, attributes: TextAttributes.BOLD };
      case "last":
        return { text: formatPrice(row.last), value: row.last, color: palette.text };
      case "mark":
        return { text: formatPrice(row.mark), value: row.mark, color: palette.text };
      case "openInterest":
        return { text: formatSize(row.openInterest), value: row.openInterest, color: palette.textDim };
      case "volume":
        return { text: formatSize(row.volume), value: row.volume, color: palette.textDim };
      default:
        return {
          text: formatChange(row.change),
          value: row.change,
          color: row.change == null ? palette.textDim : priceColor(row.change, palette),
          keepColorWhenSelected: row.change != null,
        };
    }
  }, [palette]);

  const renderOption = useCallback((row: OptionExpiryRow, column: { id: string }): DataTableCell => {
    switch (column.id) {
      case "expiry":
        return { text: row.expiry, value: row.expiry, color: palette.textBright, attributes: TextAttributes.BOLD };
      case "openInterest":
        return { text: formatSize(row.openInterest), value: row.openInterest, color: palette.textDim };
      case "volume":
        return { text: formatSize(row.volume), value: row.volume, color: palette.textDim };
      default:
        return { text: formatIv(row.markIv), value: row.markIv, color: palette.text };
    }
  }, [palette]);

  const tableHeight = Math.max(1, height - tabRows - 1);
  const queryBar = (
    <QueryBar
      width={width}
      search={{ value: search, onChange: setSearch, placeholder: "instrument", focused, ...searchProps }}
      filters={[{
        id: "currency",
        label: "Currency",
        inline: true,
        value: currency,
        defaultValue: launched,
        options: [{ value: "BTC", label: "BTC" }, { value: "ETH", label: "ETH" }],
        onChange: setStoredCurrency,
      }]}
    />
  );
  let body = null;
  if (!currency) {
    body = <PaneStatusBody error="Use BTC or ETH." />;
  } else if (resource.loading && !data) {
    body = <PaneStatusBody loading />;
  } else if (resource.error && !data) {
    body = <PaneStatusBody error={resource.error} errorTitle="Futures and options unavailable." />;
  } else if (tab === "futures") {
    body = (
      <DataTableView<FutureRow>
        focused={focused && !searchActive}
        rootWidth={width}
        rootHeight={tableHeight}
        columns={FUTURE_COLUMNS}
        items={futures}
        getItemKey={(row) => row.id}
        sortColumnId={futureSort.columnId}
        sortDirection={futureSort.direction}
        onHeaderClick={onFutureHeader}
        selectedTextOverridesCellColor
        selection={{ kind: "id", selectedId: futureId, getId: (row) => row.id, onChange: setFutureId }}
        renderCell={renderFuture}
        emptyStateTitle={needle ? "No matching instruments." : "No futures."}
      />
    );
  } else {
    body = (
      <DataTableView<OptionExpiryRow>
        focused={focused && !searchActive}
        rootWidth={width}
        rootHeight={tableHeight}
        columns={OPTION_COLUMNS}
        items={options}
        getItemKey={(row) => row.id}
        sortColumnId={optionSort.columnId}
        sortDirection={optionSort.direction}
        onHeaderClick={onOptionHeader}
        selectedTextOverridesCellColor
        selection={{ kind: "id", selectedId: optionId, getId: (row) => row.id, onChange: setOptionId }}
        renderCell={renderOption}
        emptyStateTitle={needle ? "No matching expiries." : "No options."}
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      {queryBar}
      {body}
    </Box>
  );
}
