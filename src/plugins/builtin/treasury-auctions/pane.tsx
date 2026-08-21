import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { formatCompact } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { fetchTreasuryAuctions } from "./client";
import {
  AUCTION_FILTERS,
  DEFAULT_AUCTION_SORT,
  buildAuctionColumns,
  filterAuctions,
  filterAuctionsByQuery,
  indirectPct,
  nextFilter,
  rateValue,
  sortedAuctions,
  type AuctionColumn,
  type AuctionColumnId,
  type AuctionFilter,
  type AuctionSortPreference,
} from "./model";
import {
  TREASURY_AUCTIONS_PANE_ID,
  type LoadStatus,
  type TreasuryAuction,
} from "./types";

function formatShortDate(value: string): string {
  const ts = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ts)) return "--";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatRate(value: number | null): string {
  if (value == null) return "--";
  return `${value.toFixed(3)}%`;
}

function formatBtc(value: number | null): string {
  if (value == null) return "--";
  return value.toFixed(2);
}

function formatPct(value: number | null): string {
  if (value == null) return "--";
  return `${value.toFixed(1)}%`;
}

function secTypeColor(secType: string, selected: boolean): string {
  if (selected) return colors.selectedText;
  const lower = secType.toLowerCase();
  if (lower === "bill" || lower === "cmb") return colors.positive;
  if (lower === "note" || lower === "frn") return colors.textBright;
  if (lower === "bond" || lower === "tips") return colors.warning;
  return colors.text;
}

function renderAuctionCell(
  auction: TreasuryAuction,
  column: AuctionColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const sel = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "date":
      return { text: formatShortDate(auction.auctionDate), color: sel ?? colors.textDim };
    case "type":
      return {
        text: auction.secType,
        color: secTypeColor(auction.secType, rowState.selected),
        attributes: TextAttributes.BOLD,
      };
    case "term":
      return { text: auction.securityTerm, color: sel ?? colors.text };
    case "rate":
      return { text: formatRate(rateValue(auction)), color: sel ?? colors.textBright };
    case "btc":
      return { text: formatBtc(auction.bidToCoverRatio), color: sel ?? colors.text };
    case "indirect":
      return { text: formatPct(indirectPct(auction)), color: sel ?? colors.text };
  }
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const labelWidth = 18;
  return (
    <Box flexDirection="row" height={1} gap={2}>
      <Box width={labelWidth}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text fg={color ?? colors.textBright} wrapMode="ellipsis">{value}</Text>
      </Box>
    </Box>
  );
}

function TreasuryAuctionDetail({ auction, width }: { auction: TreasuryAuction; width: number }) {
  const pct = indirectPct(auction);
  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1} width={width}>
        <Box flexDirection="row" height={1} gap={2}>
          <Text fg={secTypeColor(auction.secType, false)} attributes={TextAttributes.BOLD}>
            {auction.secType}
          </Text>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {auction.securityTerm}
          </Text>
          <Text fg={colors.textDim}>{formatShortDate(auction.auctionDate)}</Text>
        </Box>
        <Box height={1} />
        <DetailRow label="High rate" value={formatRate(rateValue(auction))} />
        {auction.highYield != null && (
          <DetailRow label="High yield" value={formatRate(auction.highYield)} />
        )}
        <DetailRow label="Bid-to-cover" value={formatBtc(auction.bidToCoverRatio)} />
        <DetailRow label="Indirect %" value={formatPct(pct)} />
        <Box height={1} />
        <DetailRow label="High price" value={auction.highPrice != null ? auction.highPrice.toFixed(3) : "--"} />
        <DetailRow label="Avg/med price" value={auction.avgMedPrice != null ? auction.avgMedPrice.toFixed(3) : "--"} />
        <DetailRow label="Low price" value={auction.lowPrice != null ? auction.lowPrice.toFixed(3) : "--"} />
        <Box height={1} />
        <DetailRow
          label="Competitive accepted"
          value={auction.competitiveAccepted != null ? formatCompact(auction.competitiveAccepted) : "--"}
        />
        <DetailRow
          label="Indirect accepted"
          value={auction.indirectAccepted != null ? formatCompact(auction.indirectAccepted) : "--"}
        />
        <DetailRow
          label="Total accepted"
          value={auction.totalAccepted != null ? formatCompact(auction.totalAccepted) : "--"}
        />
      </Box>
    </ScrollBox>
  );
}

export function TreasuryAuctionsPane({ focused, width, height }: PaneProps) {
  const [auctions, setAuctions] = useState<TreasuryAuction[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuctionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState<AuctionSortPreference>(DEFAULT_AUCTION_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const fetchGenRef = useRef(0);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((c) => c + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);

  const load = useCallback(() => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus((current) => (current === "loaded" ? "loaded" : "loading"));
    setError(null);
    fetchTreasuryAuctions()
      .then((next) => {
        if (fetchGenRef.current !== gen) return;
        setAuctions(next);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (fetchGenRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const byFilter = filterAuctions(auctions, filter);
    const byQuery = filterAuctionsByQuery(byFilter, searchQuery);
    return sortedAuctions(byQuery, sortPreference);
  }, [auctions, filter, searchQuery, sortPreference]);

  const selected = filtered.find((a) => a.id === selectedId) ?? null;

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedId || !filtered.some((a) => a.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  const cycleFilter = useCallback(() => {
    setFilter((current) => nextFilter(current));
    setDetailOpen(false);
  }, []);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
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
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        load();
        return true;
      }
      if (isPlainKey(event, "f")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        cycleFilter();
        return true;
      }
      return false;
    },
    [cycleFilter, focusSearch, load],
  );

  const handleDetailKeyDown = useCallback(
    (event: DataTableKeyEvent) => {
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        load();
        return true;
      }
      if (isPlainKey(event, "f")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        cycleFilter();
        return true;
      }
      return false;
    },
    [cycleFilter, load],
  );

  useShortcut(
    (event) => {
      if (!focused || detailOpen || searchFocused) return;
      if (event.name === "s" || event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
      }
    },
    { enabled: focused && !detailOpen && !searchFocused },
  );

  const columns = useMemo(() => buildAuctionColumns(width), [width]);
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, load);
  const renderCell = useCallback(
    (
      auction: TreasuryAuction,
      column: AuctionColumn,
      index: number,
      rowState: { selected: boolean },
    ) => renderAuctionCell(auction, column, index, rowState),
    [],
  );

  const activeFilterLabel = AUCTION_FILTERS.find((f) => f.value === filter)?.label ?? "All";

  usePaneFooter(
    TREASURY_AUCTIONS_PANE_ID,
    () => ({
      info: [
        ...(status === "loading"
          ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }]
          : []),
        ...(error
          ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }]
          : []),
        ...(filter !== "all"
          ? [{ id: "filter", parts: [{ text: activeFilterLabel, tone: "value" as const }] }]
          : []),
        ...(searchQuery.trim()
          ? [{ id: "search", parts: [{ text: `search: ${searchQuery.trim()}`, tone: "value" as const }] }]
          : []),
        ...(updatedAgo
          ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
          : []),
      ],
      hints: detailOpen
        ? [
            { id: "filter", key: "f", label: "ilter", onPress: cycleFilter },
            { id: "refresh", key: "r", label: "efresh", onPress: load },
          ]
        : [
            { id: "search", key: "/", label: "search", onPress: focusSearch },
            { id: "filter", key: "f", label: "ilter", onPress: cycleFilter },
            { id: "refresh", key: "r", label: "efresh", onPress: load },
          ],
    }),
    [
      activeFilterLabel,
      cycleFilter,
      detailOpen,
      error,
      filter,
      focusSearch,
      load,
      searchQuery,
      status,
      updatedAgo,
    ],
  );

  const tabs = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <Tabs
        tabs={AUCTION_FILTERS.map((f) => ({ label: f.label, value: f.value }))}
        activeValue={filter}
        onSelect={(value) => {
          setFilter(value as AuctionFilter);
          setDetailOpen(false);
        }}
        compact
        variant="bare"
        focused={focused && !detailOpen && !searchFocused}
      />
    </Box>
  );

  const searchBar = (
    <InputSearchBar
      value={searchQuery}
      focused={focused && !detailOpen}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="type or term"
      debounceMs={80}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={setSearchQuery}
    />
  );

  if (status === "loading" && auctions.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading Treasury auctions..." />
        </Box>
      </Box>
    );
  }

  if (error && auctions.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Treasury auctions unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableStackView<TreasuryAuction, AuctionColumn>
        focused={focused && !searchFocused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={
          selected ? (
            <TreasuryAuctionDetail auction={selected} width={width} />
          ) : null
        }
        detailTitle={selected ? `${selected.secType} ${selected.securityTerm}` : undefined}
        rootBefore={searchBar}
        onRootKeyDown={handleRootKeyDown}
        onDetailKeyDown={handleDetailKeyDown}
        selection={{
          kind: "id",
          selectedId,
          getId: (auction) => auction.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={() => {
          blurSearch();
          setDetailOpen(true);
        }}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        columns={columns}
        items={filtered}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as AuctionColumnId;
          setSortPreference((current) =>
            nextStackSortPreference(
              current,
              next,
              next === "type" || next === "term" ? "asc" : "desc",
            ),
          );
        }}
        getItemKey={(auction) => auction.id}
        renderCell={renderCell}
        emptyStateTitle={
          searchQuery.trim() ? "No matching auctions." : "No recent auctions."
        }
        emptyStateHint={
          searchQuery.trim() ? "Clear search or press r to refresh." : "Press r to refresh."
        }
      />
    </Box>
  );
}
