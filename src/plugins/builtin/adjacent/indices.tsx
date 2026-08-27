import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ScrollBox,
  Text,
  TextAttributes,
  type ScrollBoxRenderable,
} from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableColumn,
  type DataTableCell,
  type StackSortPreference,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { applySortPreference } from "../../../utils/sort-values";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";

import { useShareTable } from "../shared/use-share-table";
import type { TableShareColumn } from "../../../shares/payload";
import type { AdjacentClient } from "./client";
import type {
  AdjacentConstituent,
  AdjacentIndexPricePoint,
  AdjacentIndexRow,
  AdjacentNewsArticle,
} from "./types";
import {
  adjacentIndexSortValue,
  normalizeAdjacentIndex,
  normalizeAdjacentIndexPrices,
  adjacentIndexPricesToPricePoints,
  type AdjacentIndexSortColumnId,
} from "./normalize";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import { paneSearchHint } from "../shared/pane-footer";

export type AdjacentTab = "indices" | "rates";
export type IndexDetailTab = "overview" | "chart" | "news";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface IndexColumn extends DataTableColumn {
  id: "ticker" | "name" | "value" | "prob" | "chg1d" | "chg7d";
}

export function createIndexColumns(width: number): IndexColumn[] {
  const tickerWidth = width >= 40 ? 8 : 6;
  const valueWidth = 8;
  const probWidth = 7;
  const chg1dWidth = 7;
  const chg7dWidth = 7;
  const showValue = width >= 28;
  const showChg1d = width >= 38;
  const showChg7d = width >= 64;
  const showProb = width >= 56;
  const fixedColumns = [
    { id: "ticker", label: "TICKER", width: tickerWidth, align: "left" },
    ...(showValue ? [{ id: "value" as const, label: "VALUE", width: valueWidth, align: "right" as const }] : []),
    ...(showProb ? [{ id: "prob" as const, label: "PROB%", width: probWidth, align: "right" as const }] : []),
    ...(showChg1d ? [{ id: "chg1d" as const, label: "1D", width: chg1dWidth, align: "right" as const }] : []),
    ...(showChg7d ? [{ id: "chg7d" as const, label: "7D", width: chg7dWidth, align: "right" as const }] : []),
  ] satisfies IndexColumn[];
  const tableChromeWidth = fixedColumns.length + 1 + 2;
  const fixedWidth = fixedColumns.reduce((sum, column) => sum + column.width, 0);
  return [
    fixedColumns[0]!,
    { id: "name", label: "NAME", width: Math.max(1, width - fixedWidth - tableChromeWidth), align: "left", flexGrow: 1 },
    ...fixedColumns.slice(1),
  ];
}

/**
 * Fixed for shares, unlike the on-screen columns which drop out as the pane
 * narrows: a link created from a half-width pane should still carry the whole
 * table.
 */
const INDEX_SHARE_COLUMNS: TableShareColumn[] = [
  { id: "ticker", label: "Ticker" },
  { id: "name", label: "Name" },
  { id: "value", label: "Value", align: "right" },
  { id: "prob", label: "Prob %", align: "right" },
  { id: "chg1d", label: "1D", align: "right" },
  { id: "chg7d", label: "7D", align: "right" },
];

function renderIndexCell(
  row: AdjacentIndexRow,
  column: IndexColumn,
  selected: boolean,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "ticker":
      return { text: row.ticker, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "name":
      return { text: row.name, color: sel ?? colors.text };
    case "value":
      if (row.value == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: row.value.toFixed(1), color: sel };
    case "prob": {
      if (row.probabilityPct == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: `${row.probabilityPct.toFixed(1)}`, color: sel ?? priceColor(row.probabilityPct) };
    }
    case "chg1d":
      if (row.change1d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change1d), color: sel ?? priceColor(row.change1d) };
    case "chg7d":
      if (row.change7d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change7d), color: sel ?? priceColor(row.change7d) };
  }
}

function IndexDetail({
  client,
  index,
  width,
  height,
  detailTab,
  onDetailTabChange,
}: {
  client: AdjacentClient;
  index: AdjacentIndexRow;
  width: number;
  height: number;
  detailTab: IndexDetailTab;
  onDetailTabChange: (tab: IndexDetailTab) => void;
}) {
  const [constituents, setConstituents] = useState<AdjacentConstituent[]>([]);
  const [prices, setPrices] = useState<AdjacentIndexPricePoint[]>([]);
  const [news, setNews] = useState<AdjacentNewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const tasks: Promise<unknown>[] = [];
        if (detailTab === "overview") {
          tasks.push(
            client.getIndexConstituents(index.id).then((r) => setConstituents(r.data ?? [])),
          );
        }
        if (detailTab === "chart") {
          tasks.push(
            client.getIndexPrices(index.id).then((r) => {
              setPrices(normalizeAdjacentIndexPrices(r.data ?? []));
            }),
          );
        }
        if (detailTab === "news") {
          tasks.push(
            client.getIndexNews(index.id).then((r) => setNews(r.news ?? [])),
          );
        }
        await Promise.allSettled(tasks);
        if (genRef.current !== gen) return;
        setLoading(false);
      } catch (err) {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };
    void load();
  }, [client, index.id, detailTab]);

  const tabs = (
    <Box paddingBottom={1}>
      <Tabs
        tabs={[
          { label: "Overview", value: "overview" },
          { label: "Chart", value: "chart" },
          { label: "News", value: "news" },
        ]}
        activeValue={detailTab}
        onSelect={(v) => onDetailTabChange(v as IndexDetailTab)}
        compact
      />
    </Box>
  );

  if (loading && constituents.length === 0 && prices.length === 0 && news.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading..." />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Error loading index data." message={error} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      {detailTab === "overview" && (
        <ScrollBox flexGrow={1} scrollY>
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Box flexDirection="row" height={1} gap={4}>
              <Box flexDirection="row" gap={1}>
                <Text fg={colors.textDim}>Value:</Text>
                <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                  {index.value?.toFixed(1) ?? "—"}
                </Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text fg={colors.textDim}>Prob:</Text>
                <Text fg={index.probabilityPct != null ? priceColor(index.probabilityPct) : colors.textDim}>
                  {index.probabilityPct != null ? `${index.probabilityPct.toFixed(1)}%` : "—"}
                </Text>
              </Box>
              {index.change1d != null && (
                <Box flexDirection="row" gap={1}>
                  <Text fg={colors.textDim}>1D:</Text>
                  <Text fg={priceColor(index.change1d)}>{formatPercentRaw(index.change1d)}</Text>
                </Box>
              )}
              {index.change7d != null && (
                <Box flexDirection="row" gap={1}>
                  <Text fg={colors.textDim}>7D:</Text>
                  <Text fg={priceColor(index.change7d)}>{formatPercentRaw(index.change7d)}</Text>
                </Box>
              )}
            </Box>
            <Box height={1}>
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                Constituents
              </Text>
            </Box>
            {constituents.length === 0 ? (
              <Text fg={colors.textDim}>No constituent data.</Text>
            ) : (
              constituents.map((c) => {
                const label = c.name ?? c.display_ticker ?? c.market_id;
                const prob = c.price != null
                  ? (c.kind === "index" ? c.price - 50 : c.price)
                  : null;
                return (
                  <Box key={c.market_id} flexDirection="row" height={1} gap={2}>
                    <Box width={6}>
                      <Text fg={colors.textDim}>{(c.weight * 100).toFixed(0)}%</Text>
                    </Box>
                    <Box width={6}>
                      <Text fg={colors.textDim}>
                        {c.kind === "index" ? "IDX" : c.platform === "kalshi" ? "K" : "P"}
                      </Text>
                    </Box>
                    <Box flexGrow={1}>
                      <Text fg={colors.text} wrapMode="ellipsis">
                        {label}
                      </Text>
                    </Box>
                    <Box width={6}>
                      <Text fg={prob != null ? priceColor(prob - 50) : colors.textDim}>
                        {prob != null ? `${prob.toFixed(0)}%` : "—"}
                      </Text>
                    </Box>
                  </Box>
                );
              })
            )}
          </Box>
        </ScrollBox>
      )}
      {detailTab === "chart" && <IndexChart prices={prices} width={width} height={Math.max(height - 2, 4)} />}
      {detailTab === "news" && (
        <ScrollBox flexGrow={1} scrollY>
          <Box flexDirection="column" paddingX={1} gap={1}>
            {news.length === 0 ? (
              <Text fg={colors.textDim}>No related news.</Text>
            ) : (
              news.map((article) => (
                <Box key={article.id} flexDirection="column" height={2}>
                  <Text fg={colors.text} wrapMode="ellipsis">{article.title}</Text>
                  <Text fg={colors.textDim}>
                    {article.source} · {new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </ScrollBox>
      )}
    </Box>
  );
}

function IndexChart({
  prices,
  width,
  height,
}: {
  prices: AdjacentIndexPricePoint[];
  width: number;
  height: number;
}) {
  const pricePoints = useMemo(
    () => adjacentIndexPricesToPricePoints(prices),
    [prices],
  );

  if (pricePoints.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center">
        <EmptyState title="No price history." hint="No index price data available." />
      </Box>
    );
  }

  const first = pricePoints[0]!;
  const last = pricePoints[pricePoints.length - 1]!;
  const delta = last.close - first.close;
  const deltaPct = first.close ? (delta / first.close) * 100 : 0;

  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {last.close.toFixed(1)}
        </Text>
        <Box width={1} />
        <Text fg={priceColor(delta)}>
          {formatPercentRaw(deltaPct)}
        </Text>
      </Box>
      <Box flexGrow={1} justifyContent="center">
        <EmptyState title="Graph this index." hint="Press [g] to open the chart pop-out." />
      </Box>
    </Box>
  );
}

export function AdjacentIndicesPane({
  client,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
} & PaneProps) {
  const [indices, setIndices] = useState<AdjacentIndexRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<IndexDetailTab>("overview");
  const [sortPreference, setSortPreference] = useState<StackSortPreference<AdjacentIndexSortColumnId>>({
    columnId: "chg1d",
    direction: "desc",
  });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<import("../../../ui").InputRenderable | null>(null);
  const genRef = useRef(0);

  const load = useCallback(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);

    client.getIndices()
      .then((response) => {
        if (genRef.current !== gen) return;
        const rows = (response.data ?? []).map(normalizeAdjacentIndex);
        setIndices(rows);
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

  const columns = useMemo(() => createIndexColumns(width), [width]);
  const visibleIndices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return applySortPreference(indices.filter((row) => !query || `${row.ticker} ${row.name}`.toLowerCase().includes(query)), sortPreference, adjacentIndexSortValue);
  }, [indices, searchQuery, sortPreference]);
  const selectedIndex = visibleIndices.findIndex((i) => i.id === selectedId);
  const selectedIndexRow = selectedIndex >= 0 ? visibleIndices[selectedIndex]! : null;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, load, poll.intervalMinutes);

  useEffect(() => {
    if (visibleIndices.length === 0) return;
    if (!selectedId || !visibleIndices.some((row) => row.id === selectedId)) {
      setSelectedId(visibleIndices[0]!.id);
    }
  }, [selectedId, visibleIndices]);

  const renderCell = useCallback(
    (row: AdjacentIndexRow, column: IndexColumn, _index: number, rowState: { selected: boolean }) =>
      renderIndexCell(row, column, rowState.selected),
    [],
  );
  const getRowRevision = useCallback(
    (row: AdjacentIndexRow) =>
      `${row.id}:${row.value ?? ""}:${row.change1d ?? ""}:${row.change7d ?? ""}`,
    [],
  );

  const shareTable = useShareTable();
  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selectedIndexRow) return;
    popOutChart(`ADJ:${selectedIndexRow.id}`);
  }, [popOutChart, selectedIndexRow]);
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((value) => value + 1);
  }, []);
  const shareIndices = useCallback(() => {
    void shareTable({
      title: "Adjacent Indices",
      subtitle: "Prediction-market indices",
      columns: INDEX_SHARE_COLUMNS,
      items: visibleIndices,
      cell: (row, columnId) => renderIndexCell(row, { id: columnId } as IndexColumn, false),
      paneTemplateId: "adjacent-indices-pane",
    });
  }, [shareTable, visibleIndices]);

  useShortcut((event) => {
    if (!focused || detailOpen) return;
    if (isPlainKey(event, "g") && selectedIndexRow) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return;
    }
    if (isPlainKey(event, "/")) {
      event.preventDefault?.(); event.stopPropagation?.(); focusSearch(); return;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load();
      return;
    }
    if (isPlainKey(event, "y")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      shareIndices();
    }
  }, { enabled: focused && !detailOpen });

  usePaneFooter("adjacent-indices", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !selectedIndexRow },
      { id: "refresh", key: "r", label: "efresh", onPress: load },
      { id: "share", key: "y", label: "share", onPress: shareIndices },
      paneSearchHint(focusSearch),
    ],
  }), [error, focusSearch, graphSelected, load, poll.segment, selectedIndexRow, shareIndices, status, updatedAgo]);

  if (status === "loading" && indices.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading indices..." />
        </Box>
      </Box>
    );
  }

  if (error && indices.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="Adjacent indices unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const detailContent = selectedIndexRow ? (
    <IndexDetail
      client={client}
      index={selectedIndexRow}
      width={width}
      height={Math.max(height - 1, 1)}
      detailTab={detailTab}
      onDetailTabChange={setDetailTab}
    />
  ) : null;
  const detailTitle = selectedIndexRow
    ? `${selectedIndexRow.ticker}  ${selectedIndexRow.name}`
    : undefined;

  return (
    <DataTableStackView<AdjacentIndexRow, IndexColumn>
      focused={focused && !searchFocused}
      detailOpen={detailOpen && !!selectedIndexRow}
      onBack={() => setDetailOpen(false)}
      detailContent={detailContent}
      detailTitle={detailTitle}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => {
        setDetailOpen(true);
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={visibleIndices}
      rootBefore={<InputSearchBar value={searchQuery} focused={focused} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder="ticker or name" debounceMs={80} onFocus={focusSearch} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setSearchQuery} />}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as AdjacentIndexSortColumnId;
        setSortPreference((current) => nextStackSortPreference(
          current,
          next,
          next === "ticker" || next === "name" ? "asc" : "desc",
        ));
      }}
      getItemKey={(row) => row.id}
      getRowRevision={getRowRevision}
      renderCell={renderCell}
      emptyStateTitle="No indices."
      emptyStateHint="Press r to refresh."
    />
  );
}
