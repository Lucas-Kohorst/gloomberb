import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Text,
  TextAttributes,
} from "../../../ui";
import {
  DataTableStackView,
  DataTableView,
  EmptyState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableColumn,
  type DataTableCell,
  type FeedDataTableItem,
  type StackSortPreference,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { CompositeChart, pricePointsToResolvedSeries } from "../../../components/chart/composite";
import { usePluginAppActions, usePluginTickerActions } from "../../runtime";
import { searchRelatedNews } from "../news/wire/article-search";
import type { NewsArticle } from "../../../news/types";
import { useAppDispatch, usePaneInstance } from "../../../state/app/context";
import { getSharedRegistry } from "../../registry";
import { predictionTickerRecord } from "../../prediction-markets/collection-watchlist";
import { openUrl } from "../../../components/ui/external-link";
import { usePaneFooterHintBindings } from "../shared/pane-footer";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";

import { useShareTable } from "../shared/use-share-table";
import type { TableShareColumn } from "../../../shares/payload";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { useNewsReadState } from "../news/wire/read-state";
import type { AdjacentClient } from "./client";
import type {
  AdjacentConstituent,
  AdjacentIndexPricePoint,
  AdjacentIndexRow,
} from "./types";
import {
  adjacentIndexSortValue,
  constituentChartExpression,
  constituentImpliedPercent,
  constituentOpenSymbol,
  formatImpliedPercent,
  mergeIndexConstituents,
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
  id: "ticker" | "name" | "value" | "chg1d" | "chg7d";
}

export function createIndexColumns(): IndexColumn[] {
  return [
    { id: "ticker", label: "TICKER", width: 8, align: "left" },
    { id: "name", label: "NAME", width: 10, align: "left", flexGrow: 1 },
    { id: "value", label: "VALUE", width: 8, align: "right" },
    { id: "chg1d", label: "1D", width: 7, align: "right" },
    { id: "chg7d", label: "7D", width: 7, align: "right" },
  ];
}

const INDEX_SHARE_COLUMNS: TableShareColumn[] = [
  { id: "ticker", label: "Ticker" },
  { id: "name", label: "Name" },
  { id: "value", label: "Value", align: "right" },
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
    case "chg1d":
      if (row.change1d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change1d), color: priceColor(row.change1d) };
    case "chg7d":
      if (row.change7d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change7d), color: priceColor(row.change7d) };
  }
}

type ConstituentColumnId = "weight" | "kind" | "name" | "prob";
interface ConstituentColumn extends DataTableColumn {
  id: ConstituentColumnId;
}

const CONSTITUENT_COLUMNS: ConstituentColumn[] = [
  { id: "weight", label: "WEIGHT", width: 6, align: "right" },
  { id: "kind", label: "KIND", width: 6, align: "left" },
  { id: "name", label: "NAME", width: 10, align: "left", flexGrow: 1 },
  { id: "prob", label: "PROB", width: 6, align: "right" },
];

function constituentKind(row: AdjacentConstituent): string {
  if (row.kind === "index") return "IDX";
  const expression = constituentChartExpression(row);
  if (expression?.startsWith("KALSHI:")) return "K";
  if (expression?.startsWith("POLY:")) return "P";
  return "R";
}

function constituentName(row: AdjacentConstituent): string {
  return row.name ?? row.display_ticker ?? row.market_id;
}

function constituentProb(row: AdjacentConstituent): number | null {
  if (row.kind === "index") {
    return row.price == null ? null : row.price;
  }
  return constituentImpliedPercent(row);
}

function constituentSortValue(row: AdjacentConstituent, columnId: ConstituentColumnId) {
  switch (columnId) {
    case "weight": return row.weight;
    case "kind": return constituentKind(row);
    case "name": return constituentName(row);
    case "prob": return constituentProb(row);
  }
}

function toIndexNewsItems(articles: NewsArticle[]): FeedDataTableItem[] {
  return articles.map((article) => {
    const published = article.publishedAt
      ? article.publishedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
    return {
      id: article.id,
      eyebrow: article.source,
      title: article.title,
      timestamp: article.publishedAt,
      detailTitle: article.title,
      detailMeta: [[article.source, published].filter(Boolean).join(" · ")],
      detailBody: article.summary || article.body || article.title,
      detailNote: article.url,
    };
  });
}

function IndexDetail({
  client,
  index,
  width,
  height,
  focused,
  detailTab,
  onDetailTabChange,
  onOpenIndex,
}: {
  client: AdjacentClient;
  index: AdjacentIndexRow;
  width: number;
  height: number;
  focused: boolean;
  detailTab: IndexDetailTab;
  onDetailTabChange: (tab: IndexDetailTab) => void;
  onOpenIndex: () => void;
}) {
  const [constituents, setConstituents] = useState<AdjacentConstituent[]>([]);
  const [prices, setPrices] = useState<AdjacentIndexPricePoint[]>([]);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConstituentId, setSelectedConstituentId] = useState<string | null>(null);
  const [constituentSort, setConstituentSort] = useState<SortPreference<ConstituentColumnId>>({
    columnId: "weight",
    direction: "desc",
  });
  const [selectedNewsIdx, setSelectedNewsIdx] = useState(0);
  const [newsQuery, setNewsQuery] = useState("");
  const [newsSearchFocused, setNewsSearchFocused] = useState(false);
  const [newsFocusToken, setNewsFocusToken] = useState(0);
  const newsSearchRef = useRef<import("../../../ui").InputRenderable | null>(null);
  const genRef = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const popOutArticle = usePopOutNewsArticle();
  const { readArticleIds, markArticleRead } = useNewsReadState();

  const reloadDetail = useCallback(() => {
    setReloadNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setLoading(true);
    setError(null);

    const load = async () => {
      const constituentsTask = Promise.all([
        client.getIndexConstituents(index.id),
        client.getIndex(index.id).catch(() => null),
      ]).then(([constituents, detail]) => {
        if (genRef.current !== gen) return;
        setConstituents(mergeIndexConstituents(constituents.data ?? [], detail?.sleeves));
      });
      const pricesTask = client.getIndexPrices(index.id).then((response) => {
        if (genRef.current !== gen) return;
        setPrices(normalizeAdjacentIndexPrices(response.data ?? []));
      });
      const newsTask = searchRelatedNews(index.name).then((articles) => {
        if (genRef.current !== gen) return;
        setNews(articles);
      });

      const settled = await Promise.allSettled([constituentsTask, pricesTask, newsTask]);
      if (genRef.current !== gen) return;
      setLoading(false);
      if (settled.every((entry) => entry.status === "rejected")) {
        setError("Index detail unavailable.");
      }
    };
    void load();
  }, [client, index.id, index.name, reloadNonce]);

  const sortedConstituents = useMemo(
    () => applySortPreference(constituents, constituentSort, constituentSortValue),
    [constituents, constituentSort],
  );
  const visibleNews = useMemo(() => {
    const query = newsQuery.trim().toLowerCase();
    if (!query) return news;
    return news.filter((article) => `${article.title} ${article.source}`.toLowerCase().includes(query));
  }, [news, newsQuery]);
  const newsItems = useMemo(() => toIndexNewsItems(visibleNews), [visibleNews]);
  const selectedConstituent = sortedConstituents.find((row) => row.market_id === selectedConstituentId) ?? null;
  const popOutChart = useGraphChartPopOut();
  const { navigateTicker } = usePluginTickerActions();
  const dispatch = useAppDispatch();
  const graphExpression = detailTab === "overview"
    ? (selectedConstituent ? constituentChartExpression(selectedConstituent) : `ADJ:${index.id}`)
    : `ADJ:${index.id}`;
  const openSymbol = detailTab === "overview" && selectedConstituent
    ? constituentOpenSymbol(selectedConstituent)
    : null;
  const graphTarget = useCallback(() => {
    popOutChart(graphExpression);
  }, [graphExpression, popOutChart]);
  const openPredictionConstituent = useCallback((row: AdjacentConstituent) => {
    const symbol = constituentOpenSymbol(row);
    if (!symbol) {
      popOutChart(constituentChartExpression(row));
      return;
    }
    const venue = symbol.startsWith("KALSHI:") ? "kalshi" as const : "polymarket" as const;
    const marketId = symbol.replace(/^(KALSHI|POLY):/i, "");
    const registry = getSharedRegistry();
    void (async () => {
      const saved = registry ? await registry.tickerRepository.loadTicker(symbol).catch(() => null) : null;
      const ticker = predictionTickerRecord({
        venue,
        marketId,
        title: constituentName(row),
        url: "",
        key: `${venue}:${marketId}`,
      }, saved);
      if (registry) await registry.tickerRepository.saveTicker(ticker);
      dispatch({ type: "UPDATE_TICKER", ticker });
      registry?.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      navigateTicker(symbol);
    })();
  }, [dispatch, navigateTicker, popOutChart]);
  const openTarget = useCallback(() => {
    if (selectedConstituent && openSymbol) {
      openPredictionConstituent(selectedConstituent);
      return;
    }
    onOpenIndex();
  }, [onOpenIndex, openPredictionConstituent, openSymbol, selectedConstituent]);

  const selectedArticle = visibleNews[selectedNewsIdx] ?? null;
  const detailHints = useMemo(() => {
    if (detailTab === "news") {
      return [
        ...(selectedArticle?.url
          ? [{
            id: "open",
            key: "o",
            label: "pen",
            onPress: () => {
              markArticleRead(selectedArticle.id);
              void openUrl(selectedArticle.url);
            },
          }]
          : []),
        { id: "refresh", key: "r", label: "efresh", onPress: () => {
          setLoading(true);
          void searchRelatedNews(index.name).then((articles) => {
            setNews(articles);
            setLoading(false);
          }).catch(() => setLoading(false));
        } },
        ...(selectedArticle
          ? [{
            id: "pop-out",
            key: "p",
            label: "op out",
            onPress: () => {
              markArticleRead(selectedArticle.id);
              popOutArticle(selectedArticle);
            },
          }]
          : []),
      ];
    }
    return [
      { id: "graph", key: "g", label: "raph", onPress: graphTarget, disabled: !graphExpression },
      { id: "open", key: "o", label: "pen", onPress: openTarget },
      { id: "refresh", key: "r", label: "efresh", onPress: reloadDetail },
    ];
  }, [detailTab, graphExpression, graphTarget, index.name, markArticleRead, openTarget, popOutArticle, reloadDetail, selectedArticle]);
  usePaneFooter("adjacent-indices-detail", () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
    ],
    hints: detailHints,
  }), [detailHints, error, loading]);
  usePaneFooterHintBindings(focused, detailHints);

  useEffect(() => {
    if (sortedConstituents.length === 0) {
      setSelectedConstituentId(null);
      return;
    }
    if (!selectedConstituentId || !sortedConstituents.some((row) => row.market_id === selectedConstituentId)) {
      setSelectedConstituentId(sortedConstituents[0]!.market_id);
    }
  }, [selectedConstituentId, sortedConstituents]);

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
          <EmptyState title="Error loading index data." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const contentHeight = Math.max(4, height - 2);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      {detailTab === "overview" && (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <Box flexDirection="row" height={1} gap={4} paddingX={1}>
            <Box flexDirection="row" gap={1}>
              <Text fg={colors.textDim}>Value:</Text>
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                {index.value?.toFixed(1) ?? "—"}
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
          <DataTableView<AdjacentConstituent, ConstituentColumn>
            focused={focused}
            rootWidth={width}
            rootHeight={Math.max(4, contentHeight - 1)}
            selection={{
              kind: "id",
              selectedId: selectedConstituentId,
              getId: (row) => row.market_id,
              onChange: (id) => setSelectedConstituentId(id),
            }}
            columns={CONSTITUENT_COLUMNS}
            items={sortedConstituents}
            sortColumnId={constituentSort.columnId}
            sortDirection={constituentSort.direction}
            onHeaderClick={(columnId) => {
              const next = columnId as ConstituentColumnId;
              setConstituentSort((current) => nextSortPreference(current, next, {
                defaultDirection: next === "name" || next === "kind" ? "asc" : "desc",
              }));
            }}
            getItemKey={(row) => row.market_id}
            onActivate={(row) => openPredictionConstituent(row)}
            renderCell={(row, column, _index, rowState) => {
              const sel = rowState.selected ? colors.selectedText : undefined;
              const prob = constituentProb(row);
              switch (column.id) {
                case "weight":
                  return { text: `${(row.weight * 100).toFixed(0)}%`, color: sel ?? colors.textDim };
                case "kind":
                  return { text: constituentKind(row), color: sel ?? colors.textDim };
                case "name":
                  return { text: constituentName(row), color: sel ?? colors.text };
                case "prob":
                  return {
                    text: prob != null ? formatImpliedPercent(prob) : "—",
                    color: prob != null ? priceColor(prob - 50) : (sel ?? colors.textDim),
                  };
              }
            }}
            emptyStateTitle="No constituent data."
          />
        </Box>
      )}
      {detailTab === "chart" && (
        <IndexChart
          prices={prices}
          ticker={index.ticker}
          indexId={index.id}
          width={width}
          height={contentHeight}
          focused={focused}
        />
      )}
      {detailTab === "news" && (
        <FeedDataTableStackView
          width={width}
          height={contentHeight}
          focused={focused && !newsSearchFocused}
          items={newsItems}
          selectedIdx={selectedNewsIdx}
          onSelect={setSelectedNewsIdx}
          isItemRead={(item) => readArticleIds.has(item.id)}
          onItemRead={(item) => markArticleRead(item.id)}
          onPopOut={(item) => {
            const article = visibleNews.find((entry) => entry.id === item.id);
            if (article) popOutArticle(article);
          }}
          rootBefore={(
            <InputSearchBar
              value={newsQuery}
              focused={focused}
              active={newsSearchFocused}
              width={width}
              focusToken={newsFocusToken}
              inputRef={newsSearchRef}
              placeholder="headline or source"
              debounceMs={80}
              onFocus={() => setNewsSearchFocused(true)}
              onBlur={() => setNewsSearchFocused(false)}
              onNavigateDown={() => setNewsSearchFocused(false)}
              onQueryChange={setNewsQuery}
            />
          )}
          onRootKeyDown={(event) => {
            if (!isPlainKey(event, "/")) return false;
            event.preventDefault?.();
            event.stopPropagation?.();
            setNewsSearchFocused(true);
            setNewsFocusToken((value) => value + 1);
            return true;
          }}
          emptyStateTitle={newsQuery.trim() ? "No matching articles." : "No related news."}
        />
      )}
    </Box>
  );
}

function IndexChart({
  prices,
  ticker,
  indexId,
  width,
  height,
  focused,
}: {
  prices: AdjacentIndexPricePoint[];
  ticker: string;
  indexId: string;
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
      id: `ADJ:${indexId}`,
      label: ticker,
      color: colors.borderFocused,
      unit: "index",
      unitGroup: "level",
      style: "area",
      panelId: "price",
      providerId: "adjacent",
    }),
    [indexId, pricePoints, ticker],
  );

  if (pricePoints.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center">
        <EmptyState
          title="No price history yet."
          hint="New indices may only have a day of prints. Press [g] to open the chart pop-out."
        />
      </Box>
    );
  }

  const first = pricePoints[0]!;
  const last = pricePoints[pricePoints.length - 1]!;
  const delta = last.close - first.close;
  const deltaPct = first.close ? (delta / first.close) * 100 : 0;
  const chartHeight = Math.max(6, height - 1);

  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection="row" height={1} paddingX={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {last.close.toFixed(1)}
        </Text>
        <Box width={1} />
        <Text fg={priceColor(delta)}>
          {formatPercentRaw(deltaPct)}
        </Text>
      </Box>
      <CompositeChart
        width={width}
        height={chartHeight}
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
  const { createPaneFromTemplate } = usePluginAppActions();
  const paneInstance = usePaneInstance();
  const seedQuery = typeof paneInstance?.params?.query === "string" ? paneInstance.params.query.trim() : "";
  const [searchQuery, setSearchQuery] = useState(seedQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<import("../../../ui").InputRenderable | null>(null);
  const genRef = useRef(0);
  const seededRef = useRef(false);

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

  const columns = useMemo(() => createIndexColumns(), []);
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

  useEffect(() => {
    if (seededRef.current || !seedQuery || indices.length === 0) return;
    const query = seedQuery.toLowerCase();
    const match = indices.find((row) => (
      row.ticker.toLowerCase() === query
      || row.id.toLowerCase() === query
      || row.name.toLowerCase().includes(query)
    )) ?? indices.find((row) => `${row.ticker} ${row.name}`.toLowerCase().includes(query));
    if (!match) return;
    seededRef.current = true;
    setSelectedId(match.id);
    setSearchQuery(match.ticker);
    setDetailOpen(true);
  }, [indices, seedQuery]);

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
      ...(!detailOpen
        ? [{ id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !selectedIndexRow }]
        : []),
      { id: "refresh", key: "r", label: "efresh", onPress: load },
      { id: "share", key: "y", label: "share", onPress: shareIndices },
      paneSearchHint(focusSearch),
    ],
  }), [detailOpen, error, focusSearch, graphSelected, load, poll.segment, selectedIndexRow, shareIndices, status, updatedAgo]);

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
      focused={focused}
      detailTab={detailTab}
      onDetailTabChange={setDetailTab}
      onOpenIndex={() => createPaneFromTemplate("adjacent-indices-pane", { arg: selectedIndexRow.ticker })}
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
