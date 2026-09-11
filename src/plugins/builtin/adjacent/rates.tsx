import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  DataTableView,
  EmptyState,
  Spinner,
  Tabs,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableColumn,
  type DataTableCell,
  type DataTableKeyEvent,
  type StackSortPreference,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { CompositeChart, pricePointsToResolvedSeries } from "../../../components/chart/composite";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import type { PaneProps } from "../../../types/plugin";
import { usePaneInstance } from "../../../state/app/context";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { openUrl } from "../../../components/ui/external-link";
import { graphFooterHint, useGraphChartPopOut } from "../shared/graph-pop-out";
import type { AdjacentClient } from "./client";
import type { AdjacentIndexPricePoint, AdjacentRateRow, AdjacentRateSource } from "./types";
import {
  adjacentIndexPricesToPricePoints,
  adjacentRateSortValue,
  normalizeAdjacentIndexPrices,
  normalizeAdjacentRate,
  type AdjacentRateSortColumnId,
} from "./normalize";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
type RateDetailTab = "overview" | "chart";

interface RateColumn extends DataTableColumn {
  id: AdjacentRateSortColumnId;
}

export function createRateColumns(): RateColumn[] {
  return [
    { id: "name", label: "RATE", width: 10, align: "left", flexGrow: 1 },
    { id: "value", label: "VALUE", width: 10, align: "right" },
    { id: "chg1d", label: "1D", width: 7, align: "right" },
    { id: "spread", label: "SPREAD", width: 8, align: "right" },
  ];
}

function renderRateCell(
  row: AdjacentRateRow,
  column: RateColumn,
  selected: boolean,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "name":
      return { text: row.name, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "value":
      if (row.value == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: row.value.toFixed(2), color: sel };
    case "chg1d":
      if (row.change1d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change1d), color: priceColor(row.change1d) };
    case "spread":
      if (row.spread == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.spread), color: priceColor(row.spread) };
  }
}

type SourceColumnId = "weight" | "kind" | "name";
interface SourceColumn extends DataTableColumn {
  id: SourceColumnId;
}

const SOURCE_COLUMNS: SourceColumn[] = [
  { id: "weight", label: "WEIGHT", width: 6, align: "right" },
  { id: "kind", label: "KIND", width: 4, align: "left" },
  { id: "name", label: "NAME", width: 10, align: "left", flexGrow: 1 },
];

function sourceKind(row: AdjacentRateSource): string {
  return row.platform === "kalshi" ? "K" : "P";
}

function sourceName(row: AdjacentRateSource): string {
  return row.question ?? row.display_ticker ?? row.market_id;
}

function sourceSortValue(row: AdjacentRateSource, columnId: SourceColumnId) {
  switch (columnId) {
    case "weight": return row.weight;
    case "kind": return sourceKind(row);
    case "name": return sourceName(row);
  }
}

function RateChart({
  prices,
  rateId,
  name,
  width,
  height,
  focused,
}: {
  prices: AdjacentIndexPricePoint[];
  rateId: string;
  name: string;
  width: number;
  height: number;
  focused: boolean;
}) {
  const pricePoints = useMemo(
    () => adjacentIndexPricesToPricePoints(prices),
    [prices],
  );
  const series = useMemo(
    () => pricePointsToResolvedSeries(pricePoints, {
      id: `ADJ:${rateId}`,
      label: name,
      color: colors.borderFocused,
      unit: "index",
      unitGroup: "level",
      style: "area",
      panelId: "price",
      providerId: "adjacent",
    }),
    [name, pricePoints, rateId],
  );
  if (pricePoints.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center">
        <EmptyState title="No price history yet." hint="Press [g] to open the chart pop-out." />
      </Box>
    );
  }
  const first = pricePoints[0]!;
  const last = pricePoints[pricePoints.length - 1]!;
  const delta = last.close - first.close;
  const deltaPct = first.close ? (delta / first.close) * 100 : 0;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" height={1} paddingX={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {last.close.toFixed(2)}
        </Text>
        <Box width={1} />
        <Text fg={priceColor(delta)}>
          {formatPercentRaw(deltaPct)}
        </Text>
      </Box>
      <CompositeChart
        width={width}
        height={Math.max(6, height - 2)}
        focused={focused}
        interactive
        series={[series]}
        panels={[{ id: "price" }]}
        axisWidth={8}
        showLegend={false}
      />
    </Box>
  );
}

function RateDetail({
  client,
  rate,
  sourceMarkets,
  loading,
  error,
  width,
  height,
  focused,
  detailTab,
  onDetailTabChange,
}: {
  client: AdjacentClient;
  rate: AdjacentRateRow;
  sourceMarkets: AdjacentRateSource[];
  loading: boolean;
  error: string | null;
  width: number;
  height: number;
  focused: boolean;
  detailTab: RateDetailTab;
  onDetailTabChange: (tab: RateDetailTab) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<SourceColumnId>>({
    columnId: "weight",
    direction: "desc",
  });
  const [prices, setPrices] = useState<AdjacentIndexPricePoint[]>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const priceGenRef = useRef(0);
  const sortedSources = useMemo(
    () => applySortPreference(sourceMarkets, sort, sourceSortValue),
    [sourceMarkets, sort],
  );

  useEffect(() => {
    priceGenRef.current += 1;
    const gen = priceGenRef.current;
    setPricesLoading(true);
    client.getRatePrices(rate.id)
      .then((response) => {
        if (priceGenRef.current !== gen) return;
        setPrices(normalizeAdjacentIndexPrices(response.data ?? []));
        setPricesLoading(false);
      })
      .catch(() => {
        if (priceGenRef.current !== gen) return;
        setPrices([]);
        setPricesLoading(false);
      });
  }, [client, rate.id]);

  useEffect(() => {
    if (sortedSources.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !sortedSources.some((row) => row.market_id === selectedId)) {
      setSelectedId(sortedSources[0]!.market_id);
    }
  }, [selectedId, sortedSources]);

  const tabs = (
    <Box paddingBottom={1}>
      <Tabs
        tabs={[
          { label: "Overview", value: "overview" },
          { label: "Chart", value: "chart" },
        ]}
        activeValue={detailTab}
        onSelect={(value) => onDetailTabChange(value as RateDetailTab)}
        compact
      />
    </Box>
  );
  const contentHeight = Math.max(4, height - 2);

  if (detailTab === "chart") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        {pricesLoading && prices.length === 0 ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Spinner label="Loading..." />
          </Box>
        ) : (
          <RateChart
            prices={prices}
            rateId={rate.id}
            name={rate.name}
            width={width}
            height={contentHeight - 1}
            focused={focused}
          />
        )}
      </Box>
    );
  }

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading rate detail..." />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Rate detail unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <Box flexDirection="row" height={1} gap={4} paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text fg={colors.textDim}>Value:</Text>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {rate.value?.toFixed(2) ?? "—"}
          </Text>
        </Box>
        {rate.change1d != null && (
          <Box flexDirection="row" gap={1}>
            <Text fg={colors.textDim}>1D:</Text>
            <Text fg={priceColor(rate.change1d)}>{formatPercentRaw(rate.change1d)}</Text>
          </Box>
        )}
        {rate.spread != null && (
          <Box flexDirection="row" gap={1}>
            <Text fg={colors.textDim}>Spread:</Text>
            <Text fg={priceColor(rate.spread)}>{formatPercentRaw(rate.spread)}</Text>
          </Box>
        )}
      </Box>
      <DataTableView<AdjacentRateSource, SourceColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={contentHeight - 1}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.market_id,
          onChange: (id) => setSelectedId(id),
        }}
        columns={SOURCE_COLUMNS}
        items={sortedSources}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as SourceColumnId;
          setSort((current) => nextSortPreference(current, next, {
            defaultDirection: next === "name" || next === "kind" ? "asc" : "desc",
          }));
        }}
        getItemKey={(row) => row.market_id}
        renderCell={(row, column, _index, rowState) => {
          const sel = rowState.selected ? colors.selectedText : undefined;
          switch (column.id) {
            case "weight":
              return { text: `${(row.weight * 100).toFixed(0)}%`, color: sel ?? colors.textDim };
            case "kind":
              return { text: sourceKind(row), color: sel ?? colors.textDim };
            case "name":
              return { text: sourceName(row), color: sel ?? colors.text };
          }
        }}
        emptyStateTitle="No source market data."
      />
    </Box>
  );
}

export function AdjacentRatesPane({
  client,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
} & PaneProps) {
  const [rates, setRates] = useState<AdjacentRateRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<RateDetailTab>("overview");
  const [sortPreference, setSortPreference] = useState<StackSortPreference<AdjacentRateSortColumnId>>({
    columnId: "chg1d",
    direction: "desc",
  });
  const [sourceMarkets, setSourceMarkets] = useState<AdjacentRateSource[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetryNonce, setDetailRetryNonce] = useState(0);
  const genRef = useRef(0);
  const detailGenRef = useRef(0);
  const paneInstance = usePaneInstance();
  const seedQuery = typeof paneInstance?.params?.query === "string" ? paneInstance.params.query.trim() : "";
  const seededRef = useRef(false);

  const load = useCallback(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);

    client.getRates()
      .then((response) => {
        if (genRef.current !== gen) return;
        setRates((response.data ?? []).map(normalizeAdjacentRate));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    return runAfterStartupBackground(() => {
      load();
    });
  }, [load]);

  const columns = useMemo(() => createRateColumns(), []);
  const sortedRates = useMemo(
    () => applySortPreference(rates, sortPreference, adjacentRateSortValue),
    [rates, sortPreference],
  );
  const selectedRate = sortedRates.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (sortedRates.length === 0) return;
    if (!selectedId || !sortedRates.some((row) => row.id === selectedId)) {
      setSelectedId(sortedRates[0]!.id);
    }
  }, [selectedId, sortedRates]);

  useEffect(() => {
    if (seededRef.current || !seedQuery || rates.length === 0) return;
    const query = seedQuery.toLowerCase();
    const match = rates.find((row) => (
      row.id.toLowerCase() === query || row.name.toLowerCase().includes(query)
    ));
    if (!match) return;
    seededRef.current = true;
    setSelectedId(match.id);
    setDetailOpen(true);
  }, [rates, seedQuery]);

  useEffect(() => {
    if (!selectedRate) {
      setSourceMarkets([]);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    detailGenRef.current += 1;
    const gen = detailGenRef.current;
    setDetailLoading(true);
    setDetailError(null);
    setSourceMarkets([]);
    client.getRate(selectedRate.id)
      .then((rateDetail) => {
        if (detailGenRef.current !== gen) return;
        setSourceMarkets(rateDetail.sources ?? []);
        setDetailLoading(false);
      })
      .catch((err) => {
        if (detailGenRef.current !== gen) return;
        setDetailError(err instanceof Error ? err.message : String(err));
        setDetailLoading(false);
      });
  }, [client, detailRetryNonce, selectedRate?.id]);

  const renderCell = useCallback(
    (row: AdjacentRateRow, column: RateColumn, _index: number, rowState: { selected: boolean }) =>
      renderRateCell(row, column, rowState.selected),
    [],
  );
  const getRowRevision = useCallback(
    (row: AdjacentRateRow) => `${row.id}:${row.value ?? ""}:${row.change1d ?? ""}:${row.spread ?? ""}`,
    [],
  );

  const firstKalshiSource = sourceMarkets.find((s) => s.platform === "kalshi");
  const rateUrl = firstKalshiSource
    ? `https://kalshi.com/markets/${firstKalshiSource.display_ticker ?? firstKalshiSource.market_id}`
    : null;
  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selectedRate) return;
    popOutChart(`ADJ:${selectedRate.id}`);
  }, [popOutChart, selectedRate]);
  const reloadDetail = useCallback(() => {
    setDetailRetryNonce((value) => value + 1);
  }, []);
  const handleRefresh = useCallback(() => {
    load();
    if (detailOpen) reloadDetail();
  }, [detailOpen, load, reloadDetail]);

  useShortcut((event) => {
    if (!focused) return;
    if (isPlainKey(event, "g") && selectedRate) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      handleRefresh();
      return;
    }
    if (isPlainKey(event, "o") && rateUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openUrl(rateUrl);
    }
  }, { enabled: focused });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "g") && selectedRate) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    handleRefresh();
    return true;
  }, [graphSelected, handleRefresh, selectedRate]);

  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, load, poll.intervalMinutes);

  usePaneFooter("adjacent-rates", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: [
      graphFooterHint(graphSelected, !!selectedRate),
      { id: "refresh", key: "r", label: "efresh", onPress: handleRefresh },
      ...(rateUrl ? [{ id: "open", key: "o", label: "pen", onPress: () => openUrl(rateUrl) }] : []),
    ],
  }), [detailOpen, error, graphSelected, handleRefresh, poll.segment, rateUrl, selectedRate, status, updatedAgo]);

  if (status === "loading" && rates.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading rates..." />
        </Box>
      </Box>
    );
  }

  if (error && rates.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="Adjacent rates unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const detailContent = selectedRate ? (
    <RateDetail
      client={client}
      rate={selectedRate}
      sourceMarkets={sourceMarkets}
      loading={detailLoading}
      error={detailError}
      width={width}
      height={Math.max(height - 1, 1)}
      focused={focused}
      detailTab={detailTab}
      onDetailTabChange={setDetailTab}
    />
  ) : null;
  const detailTitle = selectedRate?.name;

  return (
    <DataTableStackView<AdjacentRateRow, RateColumn>
      focused={focused}
      detailOpen={detailOpen && !!selectedRate}
      onBack={() => setDetailOpen(false)}
      detailContent={detailContent}
      detailTitle={detailTitle}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => setDetailOpen(true)}
      onRootKeyDown={handleRootKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={sortedRates}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as AdjacentRateSortColumnId;
        setSortPreference((current) => nextStackSortPreference(
          current,
          next,
          next === "name" ? "asc" : "desc",
        ));
      }}
      getItemKey={(row) => row.id}
      getRowRevision={getRowRevision}
      renderCell={renderCell}
      emptyStateTitle="No reference rates."
      emptyStateHint="Press r to refresh."
    />
  );
}
