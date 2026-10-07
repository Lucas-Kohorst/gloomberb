import { useCallback, useMemo } from "react";
import {
  CompositeChart,
  DataTableStackView,
  MarkdownText,
  PaneStatusBody,
  QueryBar,
  StatGrid,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneStatusFooter } from "../../../components/layout/pane/status-footer";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { pricePointsToResolvedSeries } from "../../../components/chart/composite";
import {
  useAsyncResource,
  useAutoRefresh,
  usePaneSettingValue,
  usePluginConfigState,
  usePluginPaneState,
} from "../../../public/react";
import { priceColor } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text, TextAttributes } from "../../../ui";
import { formatPercentRaw } from "../../../utils/format";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { compareSortValues, nextHeaderSort, type SortPreference } from "../../../utils/sort-values";
import {
  AdjacentClient,
  loadCftcFilings,
  resolveAdjacentApiKey,
} from "./client";
import { filingKindLabel, filingPublishedAt } from "./filings-format";
import {
  adjacentIndexPricesToPricePoints,
  adjacentIndexSortValue,
  adjacentRateSortValue,
  normalizeAdjacentIndex,
  normalizeAdjacentIndexPrices,
  normalizeAdjacentRate,
  type AdjacentIndexSortColumnId,
  type AdjacentRateSortColumnId,
} from "./normalize";
import { adjacentPriceWindow } from "./price-window";
import { filterAdjacentRows } from "./search";
import { ADJACENT_API_KEY_CONFIG, type AdjacentIndexRow, type AdjacentRateRow, type CftcFiling } from "./types";

type AdjacentTab = "indices" | "rates" | "cftc";

const TABS = [
  { label: "Indices", value: "indices" },
  { label: "Rates", value: "rates" },
  { label: "CFTC", value: "cftc" },
];

const INDEX_COLUMNS: DataTableColumn[] = [
  { id: "ticker", label: "Ticker", width: 10, align: "left" },
  { id: "name", label: "Name", width: 16, flexGrow: 1, align: "left" },
  { id: "value", label: "Level", width: 8, align: "right" },
  { id: "chg1d", label: "1D%", width: 8, align: "right" },
  { id: "chg7d", label: "7D%", width: 8, align: "right" },
];

const RATE_COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Name", width: 18, flexGrow: 1, align: "left" },
  { id: "value", label: "Value", width: 8, align: "right" },
  { id: "spread", label: "Spread", width: 8, align: "right" },
  { id: "chg1d", label: "1D%", width: 8, align: "right" },
];

const FILING_COLUMNS: DataTableColumn[] = [
  { id: "org", label: "Org", width: 8, align: "left" },
  { id: "kind", label: "Kind", width: 14, align: "left" },
  { id: "title", label: "Title", width: 20, flexGrow: 1, align: "left" },
  { id: "date", label: "Date", width: 12, align: "left" },
];

function tabOf(value: string): AdjacentTab {
  return value === "rates" || value === "cftc" ? value : "indices";
}

function levelText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

function changeText(value: number | null): string {
  return value == null ? "-" : formatPercentRaw(value);
}

function dayText(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return "-";
  return date.toISOString().slice(0, 10);
}

function useAdjacentClient(): AdjacentClient {
  const [pluginKey] = usePluginConfigState<string>(ADJACENT_API_KEY_CONFIG, "");
  const apiKey = pluginKey.trim();
  return useMemo(() => new AdjacentClient({
    apiKey: apiKey || resolveAdjacentApiKey(),
    userApiKey: apiKey || null,
  }), [apiKey]);
}

function LevelDetail({
  client,
  id,
  label,
  kind,
  width,
  height,
  focused,
}: {
  client: AdjacentClient;
  id: string;
  label: string;
  kind: "index" | "rate";
  width: number;
  height: number;
  focused: boolean;
}) {
  const loader = useCallback(async () => {
    const tier = client.requestApiKey ? "keyed" as const : "public" as const;
    const window = adjacentPriceWindow("1M", tier);
    const payload = kind === "index"
      ? await client.getIndexPrices(id, window)
      : await client.getRatePrices(id, window);
    return adjacentIndexPricesToPricePoints(normalizeAdjacentIndexPrices(payload.data ?? []));
  }, [client, id, kind]);
  const resource = useAsyncResource(loader);
  const points = resource.data ?? [];
  const series = useMemo(() => {
    if (points.length === 0) return [];
    const first = points[0]?.close ?? 0;
    const last = points.at(-1)?.close ?? first;
    return [pricePointsToResolvedSeries(points, {
      id,
      label,
      color: priceColor(last - first),
      unit: "index",
      unitGroup: "index",
      style: "line",
      panelId: "main",
    })];
  }, [id, label, points]);

  if (points.length === 0) {
    return (
      <PaneStatusBody
        loading={resource.loading}
        error={resource.error}
        subject="price history"
        empty={!resource.loading && !resource.error}
        emptyTitle="No prices in this window."
      />
    );
  }

  return (
    <CompositeChart
      series={series}
      panels={[{ id: "main" }]}
      width={width}
      height={Math.max(8, height)}
      focused={focused}
      showLegend={false}
    />
  );
}

function FilingDetail({ client, filing, width }: { client: AdjacentClient; filing: CftcFiling; width: number }) {
  const loader = useCallback(async () => client.getFilingDetail(filing.id), [client, filing.id]);
  const resource = useAsyncResource(loader);
  const detail = resource.data;
  const published = filingPublishedAt(filing);
  return (
    <Box flexDirection="column" width={width} gap={1}>
      <StatGrid
        width={width}
        items={[
          { id: "org", label: "Org", value: filing.orgCode || "-" },
          { id: "kind", label: "Kind", value: filingKindLabel(filing) },
          { id: "status", label: "Status", value: filing.status || "-" },
          { id: "date", label: "Filed", value: dayText(published) },
        ]}
      />
      {resource.loading && !detail ? <Text>Loading filing...</Text> : null}
      {detail?.markdown
        ? <MarkdownText text={detail.markdown} lineWidth={width} />
        : filing.description
          ? <MarkdownText text={filing.description} lineWidth={width} />
          : null}
    </Box>
  );
}

export function AdjacentPane({ width, height, focused }: PaneProps) {
  const colors = useThemeColors();
  const client = useAdjacentClient();
  const [defaultTab] = usePaneSettingValue<string>("defaultTabId", "indices");
  const [storedQuery] = usePaneSettingValue("query", "");
  const [storedTab, setTab] = usePluginPaneState<string>("tab", tabOf(String(defaultTab ?? "indices")));
  const tab = tabOf(storedTab);
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? ""));
  const [openId, setOpenId] = usePluginPaneState<string | null>("openId", null);
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedId", null);
  const [indexSort, setIndexSort] = usePluginPaneState<SortPreference<AdjacentIndexSortColumnId>>("indexSort", { columnId: "ticker", direction: "asc" });
  const [rateSort, setRateSort] = usePluginPaneState<SortPreference<AdjacentRateSortColumnId>>("rateSort", { columnId: "name", direction: "asc" });
  const { active: searching, focus: focusSearch, searchProps } = useQueryBarSearch();

  const listLoader = useCallback(async () => {
    if (tab === "rates") {
      const payload = await client.getRates();
      return (payload.data ?? []).map(normalizeAdjacentRate);
    }
    if (tab === "cftc") return (await loadCftcFilings(client, query, 50)).filings;
    const payload = await client.getIndices();
    return (payload.data ?? []).map(normalizeAdjacentIndex);
  }, [client, query, tab]);
  const list = useAsyncResource(listLoader);
  useAutoRefresh(list.updatedAt, list.load);
  usePaneRefreshKey(() => void list.reload(), { focused, enabled: !searching });

  const selectTab = useCallback((value: string) => {
    setTab(tabOf(value));
    setOpenId(null);
  }, [setOpenId, setTab]);
  const { strip: tabStrip, rows: tabRows } = usePaneTabs({
    tabs: TABS,
    activeValue: tab,
    onSelect: selectTab,
    focused: focused && !searching,
    compact: true,
    variant: "bare",
  });

  const indexRows = useMemo(() => {
    const rows = filterAdjacentRows(
      (list.data ?? []) as AdjacentIndexRow[],
      tab === "indices" ? query : "",
      (row) => `${row.ticker} ${row.name}`,
    );
    if (tab !== "indices" || !indexSort.columnId) return rows;
    const columnId = indexSort.columnId;
    return [...rows].sort((left, right) => compareSortValues(
      adjacentIndexSortValue(left, columnId),
      adjacentIndexSortValue(right, columnId),
      indexSort.direction,
    ));
  }, [indexSort, list.data, query, tab]);

  const rateRows = useMemo(() => {
    const rows = filterAdjacentRows(
      (list.data ?? []) as AdjacentRateRow[],
      tab === "rates" ? query : "",
      (row) => `${row.name} ${row.id}`,
    );
    if (tab !== "rates" || !rateSort.columnId) return rows;
    const columnId = rateSort.columnId;
    return [...rows].sort((left, right) => compareSortValues(
      adjacentRateSortValue(left, columnId),
      adjacentRateSortValue(right, columnId),
      rateSort.direction,
    ));
  }, [list.data, query, rateSort, tab]);

  const filingRows = (tab === "cftc" ? (list.data ?? []) : []) as CftcFiling[];
  const openKey = openId?.startsWith(`${tab}:`) ? openId.slice(tab.length + 1) : null;
  const openIndex = tab === "indices" ? indexRows.find((row) => row.id === openKey) ?? null : null;
  const openRate = tab === "rates" ? rateRows.find((row) => row.id === openKey) ?? null : null;
  const openFiling = tab === "cftc" ? filingRows.find((row) => String(row.id) === openKey) ?? null : null;
  const detailOpen = openIndex != null || openRate != null || openFiling != null;

  const freshness = tab === "cftc" ? "as filed" : client.isPublic ? "15m delayed" : "real-time";
  const info = useMemo<PaneFooterSegment[]>(
    () => [{ id: "tier", parts: [{ text: freshness }] }],
    [freshness],
  );
  usePaneStatusFooter({
    registrationId: "adjacent",
    loading: list.loading && list.data != null,
    error: list.data == null ? list.error : null,
    stale: list.data != null && !!list.error,
    info,
    hints: [{ id: "adjacent-search", key: "/", label: "search", onPress: focusSearch }],
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const queryBar = (
    <QueryBar
      width={width}
      search={{
        value: query,
        onChange: setQuery,
        placeholder: tab === "cftc" ? "organization or product" : "name or ticker",
        focused,
        debounceMs: 250,
        ...searchProps,
      }}
    />
  );
  const bodyHeight = Math.max(1, height - tabRows);
  const tabs = tabStrip && <Box height={1} flexShrink={0} overflow="hidden">{tabStrip}</Box>;

  if (list.data == null) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        {queryBar}
        <PaneStatusBody
          loading={list.loading}
          error={list.error}
          subject={tab === "cftc" ? "CFTC filings" : tab === "rates" ? "reference rates" : "indices"}
        />
      </Box>
    );
  }

  const tableProps = {
    focused: focused && !searching,
    rootWidth: width,
    rootHeight: bodyHeight,
    rootBefore: queryBar,
    onRootKeyDown: handleRootKeyDown,
    selectedTextOverridesCellColor: true as const,
    detailOpen,
    onBack: () => setOpenId(null),
  };

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      {tab === "indices" ? (
        <DataTableStackView<AdjacentIndexRow, DataTableColumn>
          {...tableProps}
          detailTitle={openIndex?.ticker ?? ""}
          detailContent={openIndex ? (
            <Box flexDirection="column" width={width}>
              <StatGrid
                width={width}
                items={[
                  { id: "level", label: "Level", value: levelText(openIndex.value) },
                  { id: "d1", label: "1D", value: changeText(openIndex.change1d), color: openIndex.change1d == null ? undefined : priceColor(openIndex.change1d, colors) },
                  { id: "d7", label: "7D", value: changeText(openIndex.change7d), color: openIndex.change7d == null ? undefined : priceColor(openIndex.change7d, colors) },
                ]}
              />
              <LevelDetail client={client} id={openIndex.id} label={openIndex.ticker} kind="index" width={width} height={Math.max(8, bodyHeight - 4)} focused={focused && !searching} />
            </Box>
          ) : null}
          columns={INDEX_COLUMNS}
          items={indexRows}
          getItemKey={(row) => row.id}
          selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setSelectedId }}
          onActivate={(row) => { setSelectedId(row.id); setOpenId(`indices:${row.id}`); }}
          sortColumnId={indexSort.columnId}
          sortDirection={indexSort.direction}
          onHeaderClick={(id) => setIndexSort((current) => nextHeaderSort(current, id as AdjacentIndexSortColumnId, { firstDirection: id === "ticker" || id === "name" ? "asc" : "desc" }))}
          renderCell={(row, column): DataTableCell => {
            if (column.id === "ticker") return { text: row.ticker, color: colors.textBright, attributes: TextAttributes.BOLD };
            if (column.id === "name") return { text: row.name };
            if (column.id === "value") return { text: levelText(row.value), value: row.value };
            const change = column.id === "chg1d" ? row.change1d : row.change7d;
            return { text: changeText(change), value: change, color: change == null ? colors.textMuted : priceColor(change, colors) };
          }}
          emptyStateTitle="No matching indices."
        />
      ) : tab === "rates" ? (
        <DataTableStackView<AdjacentRateRow, DataTableColumn>
          {...tableProps}
          detailTitle={openRate?.name ?? ""}
          detailContent={openRate ? (
            <Box flexDirection="column" width={width}>
              <StatGrid
                width={width}
                items={[
                  { id: "value", label: "Value", value: levelText(openRate.value) },
                  { id: "spread", label: "Spread", value: levelText(openRate.spread) },
                  { id: "d1", label: "1D", value: changeText(openRate.change1d), color: openRate.change1d == null ? undefined : priceColor(openRate.change1d, colors) },
                ]}
              />
              <LevelDetail client={client} id={openRate.id} label={openRate.name} kind="rate" width={width} height={Math.max(8, bodyHeight - 4)} focused={focused && !searching} />
            </Box>
          ) : null}
          columns={RATE_COLUMNS}
          items={rateRows}
          getItemKey={(row) => row.id}
          selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setSelectedId }}
          onActivate={(row) => { setSelectedId(row.id); setOpenId(`rates:${row.id}`); }}
          sortColumnId={rateSort.columnId}
          sortDirection={rateSort.direction}
          onHeaderClick={(id) => setRateSort((current) => nextHeaderSort(current, id as AdjacentRateSortColumnId, { firstDirection: id === "name" ? "asc" : "desc" }))}
          renderCell={(row, column): DataTableCell => {
            if (column.id === "name") return { text: row.name };
            if (column.id === "value") return { text: levelText(row.value), value: row.value };
            if (column.id === "spread") return { text: levelText(row.spread), value: row.spread };
            return { text: changeText(row.change1d), value: row.change1d, color: row.change1d == null ? colors.textMuted : priceColor(row.change1d, colors) };
          }}
          emptyStateTitle="No matching rates."
        />
      ) : (
        <DataTableStackView<CftcFiling, DataTableColumn>
          {...tableProps}
          detailTitle={openFiling?.title ?? ""}
          detailContent={openFiling ? <FilingDetail client={client} filing={openFiling} width={width} /> : null}
          columns={FILING_COLUMNS}
          items={filingRows}
          sortColumnId={null}
          sortDirection="asc"
          getItemKey={(row) => String(row.id)}
          selection={{ kind: "id", selectedId, getId: (row) => String(row.id), onChange: setSelectedId }}
          onActivate={(row) => { setSelectedId(String(row.id)); setOpenId(`cftc:${row.id}`); }}
          renderCell={(row, column): DataTableCell => {
            if (column.id === "org") return { text: row.orgCode || "-", color: colors.textBright };
            if (column.id === "kind") return { text: filingKindLabel(row), color: colors.textDim };
            if (column.id === "date") return { text: dayText(filingPublishedAt(row)), color: colors.textDim };
            return { text: row.title };
          }}
          emptyStateTitle="No matching filings."
        />
      )}
    </Box>
  );
}
