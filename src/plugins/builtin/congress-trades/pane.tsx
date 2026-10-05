import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useRendererHost, type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import {
  DataTableStackView,
  InputSearchBar,
  PaneStatusBody,
  Tabs,
  useTableLoadMore,
} from "../../../components";
import type { SelectControl } from "../../../components/ui/select-button";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { useAutoRefresh } from "../shared/auto-refresh";
import { useInlineTickerOpener } from "../../../state/hooks/inline-tickers";
import {
  apiClient,
  type CloudCongressHousePayload,
  type CloudCongressMemberPayload,
  type CloudCongressTradePayload,
} from "../../../api-client";
import { withConnectionRequest } from "../connections/register";
import { CONGRESS_CONNECTION_ID } from "./connection";
import type { PaneProps } from "../../../types/plugin";
import {
  CONGRESS_FILING_LIMIT,
  CONGRESS_MEMBER_FILING_LIMIT,
  CONGRESS_TRADE_LIMIT,
  canLoadMoreCongress,
  congressPageAfterEmpty,
  mergeCongressPages,
  nextCongressPage,
  buildMemberColumns,
  buildTradeColumns,
  nextSort,
  selectedIndexById,
  sortedMembers,
  sortedTrades,
  type CongressTab,
  type DetailMode,
  type LoadStatus,
  type MemberColumn,
  type MemberColumnId,
  type SortDirection,
  type TradeColumn,
  type TradeColumnId,
} from "./model";
import { MemberTradesDetail, TradeDetail } from "./detail";
import { CongressFilterBar, type CongressFilters } from "./filters";
import { useCongressTradesFooter } from "./footer";
import { useCongressTradesKeyboard } from "./keyboard";
import { useMineTickers } from "../shared/mine-tickers";
import {
  renderCongressMemberCell,
  renderCongressTradeCell,
} from "./table";

export { CONGRESS_TRADES_PANE_ID } from "./model";

export function CongressTradesPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const [payload, setPayload] = useState<CloudCongressHousePayload | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const tradeScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [activeTab, setActiveTab] = usePluginPaneState<CongressTab>("activeTab", "trades");
  const [selectedTradeId, setSelectedTradeId] = useDebouncedPluginPaneState<string | null>("selectedTradeId", null);
  const [selectedMemberId, setSelectedMemberId] = useDebouncedPluginPaneState<string | null>("selectedMemberId", null);
  const [detailMode, setDetailMode] = useState<DetailMode>(null);
  const [tradeSort, setTradeSort] = useState<{ columnId: TradeColumnId; direction: SortDirection }>({
    columnId: "filed",
    direction: "desc",
  });
  const [memberSort, setMemberSort] = useState<{ columnId: MemberColumnId; direction: SortDirection }>({
    columnId: "trades",
    direction: "desc",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const focusSearch = useCallback(() => { setSearchFocused(true); setSearchFocusToken((value) => value + 1); }, []);
  const [filters, setFilters] = usePluginPaneState<CongressFilters>("filters", {});
  const [mine, setMine] = usePluginPaneState("mine", false);
  const mineTickers = useMineTickers();
  const chamberControl = useRef<SelectControl | null>(null);
  const sideControl = useRef<SelectControl | null>(null);
  const ownerControl = useRef<SelectControl | null>(null);
  const assetControl = useRef<SelectControl | null>(null);
  const amountControl = useRef<SelectControl | null>(null);
  const fetchGenRef = useRef(0);
  const congressQuery = {
    chamber: filters.chamber ?? "all" as const,
    side: filters.side,
    owner: filters.owner,
    assetType: filters.assetType,
    minAmount: filters.minAmount,
  };

  const load = useCallback((refresh = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus((current) => (current === "loaded" && !refresh ? "loaded" : "loading"));
    setError(null);
    setLoadingMore(false);
    withConnectionRequest(CONGRESS_CONNECTION_ID, "house", () => apiClient.getCloudCongressHouse({
      ...congressQuery,
      limit: CONGRESS_TRADE_LIMIT,
      filingLimit: CONGRESS_FILING_LIMIT,
      refresh,
    }))
      .then((nextPayload) => {
        if (fetchGenRef.current !== gen) return;
        setPayload((current) => (
          refresh && current ? mergeCongressPages(nextPayload, current) : nextPayload
        ));
        setStatus("loaded");
        setLastLoadedAt(Date.now());
      })
      .catch((loadError) => {
        if (fetchGenRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, [congressQuery.assetType, congressQuery.chamber, congressQuery.minAmount, congressQuery.owner, congressQuery.side]);

  const loadMore = useCallback(() => {
    if (!payload || loadingMore || status !== "loaded") return;
    const nextRequest = nextCongressPage(payload);
    if (!nextRequest) return;
    const gen = fetchGenRef.current;
    setLoadingMore(true);
    withConnectionRequest(CONGRESS_CONNECTION_ID, "house", () => apiClient.getCloudCongressHouse({
      ...congressQuery,
      ...nextRequest,
      limit: CONGRESS_TRADE_LIMIT,
      filingLimit: CONGRESS_FILING_LIMIT,
    }))
      .then((nextPayload) => {
        if (fetchGenRef.current !== gen) return;
        setPayload((current) => {
          if (!current) return nextPayload;
          const merged = mergeCongressPages(current, nextPayload);
          return merged.trades.length > current.trades.length
            ? merged
            : congressPageAfterEmpty(merged);
        });
      })
      .catch((loadError) => {
        if (fetchGenRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (fetchGenRef.current !== gen) return;
        setLoadingMore(false);
      });
  }, [congressQuery, loadingMore, payload, status]);

  const onTradeScroll = useTableLoadMore(
    tradeScrollRef,
    !!payload && status === "loaded" && !loadingMore && canLoadMoreCongress(payload),
    loadMore,
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Filings would otherwise age indefinitely in an open pane.
  const refresh = useCallback(() => {
    load(true);
  }, [load]);
  useAutoRefresh(lastLoadedAt, refresh);

  const trades = payload?.trades ?? [];
  const members = payload?.members ?? [];
  const visibleTrades = useMemo(
    () => mine ? trades.filter((trade) => trade.ticker && mineTickers.has(trade.ticker.trim().toUpperCase())) : trades,
    [mine, mineTickers, trades],
  );
  const visibleMembers = useMemo(() => {
    if (!mine) return members;
    const names = new Set(visibleTrades.map((trade) => `${trade.memberName}|${trade.stateDistrict}`));
    return members.filter((member) => names.has(`${member.memberName}|${member.stateDistrict}`));
  }, [members, mine, visibleTrades]);
  const query = searchQuery.trim().toLowerCase();
  const tradeRows = useMemo(() => sortedTrades(visibleTrades.filter((trade) => !query || `${trade.ticker ?? ""} ${trade.memberName} ${trade.filingDate}`.toLowerCase().includes(query)), tradeSort), [query, tradeSort, visibleTrades]);
  const memberRows = useMemo(() => sortedMembers(visibleMembers.filter((member) => !query || `${member.memberName} ${member.id}`.toLowerCase().includes(query)), memberSort), [memberSort, query, visibleMembers]);
  const tradeColumns = useMemo(() => buildTradeColumns(), []);
  const memberColumns = useMemo(() => buildMemberColumns(), []);
  const selectedTradeIndex = selectedIndexById(tradeRows, selectedTradeId);
  const selectedMemberIndex = selectedIndexById(memberRows, selectedMemberId);
  const selectedTrade = tradeRows[selectedTradeIndex] ?? null;
  const selectedMember = memberRows[selectedMemberIndex] ?? null;
  const detailTrade = detailMode?.kind === "trade"
    ? trades.find((trade) => trade.id === detailMode.tradeId) ?? null
    : null;
  const detailMember = detailMode?.kind === "member"
    ? members.find((member) => member.id === detailMode.memberId) ?? null
    : null;
  const detailMemberTrades = useMemo(() => (
    detailMember
      ? sortedTrades(
        trades.filter((trade) => trade.memberName === detailMember.memberName && trade.stateDistrict === detailMember.stateDistrict),
        { columnId: "filed", direction: "desc" },
      )
      : []
  ), [detailMember, trades]);

  const openTicker = useInlineTickerOpener();

  useEffect(() => {
    if (tradeRows.length === 0) {
      if (selectedTradeId !== null) setSelectedTradeId(null);
      return;
    }
    if (!selectedTrade || !selectedTradeId) {
      setSelectedTradeId(tradeRows[0]!.id);
    }
  }, [selectedTrade, selectedTradeId, setSelectedTradeId, tradeRows]);

  useEffect(() => {
    if (memberRows.length === 0) {
      if (selectedMemberId !== null) setSelectedMemberId(null);
      return;
    }
    if (!selectedMember || !selectedMemberId) {
      setSelectedMemberId(memberRows[0]!.id);
    }
  }, [memberRows, selectedMember, selectedMemberId, setSelectedMemberId]);

  useEffect(() => {
    if (detailMode?.kind === "trade" && !detailTrade) setDetailMode(null);
    if (detailMode?.kind === "member" && !detailMember) setDetailMode(null);
  }, [detailMember, detailMode, detailTrade]);

  const selectTab = useCallback((tab: string) => {
    setActiveTab(tab === "members" ? "members" : "trades");
    setDetailMode(null);
  }, [setActiveTab]);

  const openSelectedTradeSource = useCallback(() => {
    const trade = detailTrade ?? selectedTrade;
    if (!trade?.sourceUrl) return;
    void rendererHost.openExternal(trade.sourceUrl);
  }, [detailTrade, rendererHost, selectedTrade]);

  const openSelectedTicker = useCallback(() => {
    const ticker = detailTrade?.ticker ?? selectedTrade?.ticker;
    if (ticker) openTicker(ticker);
  }, [detailTrade?.ticker, openTicker, selectedTrade?.ticker]);

  const openSelectedTradeMember = useCallback(() => {
    const trade = detailTrade ?? selectedTrade;
    if (!trade) return;
    const member = members.find((entry) => entry.memberName === trade.memberName && entry.stateDistrict === trade.stateDistrict);
    if (!member) return;
    setSelectedMemberId(member.id, { immediate: true });
    setDetailMode({ kind: "member", memberId: member.id });
  }, [detailTrade, members, selectedTrade, setSelectedMemberId]);

  const { handleDetailKeyDown, handleRootKeyDown } = useCongressTradesKeyboard({
    activeTab,
    detailMode,
    focused,
    load,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    selectTab,
    focusSearch,
  });

  useCongressTradesFooter({
    activeTab,
    detailMode,
    detailTrade,
    error,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    payload,
    selectedTrade,
    status,
    lastUpdated: lastLoadedAt,
    focusSearch,
  });

  const detailContent = detailTrade ? (
    <TradeDetail trade={detailTrade} width={width} />
  ) : detailMember ? (
    <MemberTradesDetail
      focused={focused}
      member={detailMember}
      initialTrades={detailMemberTrades}
      width={width}
      filingLimit={payload?.filingCount ?? CONGRESS_MEMBER_FILING_LIMIT}
    />
  ) : null;
  const detailTitle = detailTrade
    ? `${detailTrade.memberName} ${detailTrade.ticker ?? "trade"}`
    : detailMember
      ? detailMember.memberName
      : undefined;
  const filterBar = (
    <CongressFilterBar
      filters={filters}
      onChange={setFilters}
      mine={mine}
      onMine={setMine}
      width={width}
      controls={{
        chamber: chamberControl,
        side: sideControl,
        owner: ownerControl,
        assetType: assetControl,
        minAmount: amountControl,
      }}
    />
  );
  const filingsSubject = filters.chamber === "senate"
    ? "Senate PTR filings"
    : filters.chamber === "house"
      ? "House PTR filings"
      : "Congress PTR filings";

  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={[
          { label: "Trades", value: "trades" },
          { label: "Members", value: "members" },
        ]}
        activeValue={activeTab}
        onSelect={selectTab}
        compact
        variant="pill"
        focused={focused && !detailMode}
      />
    </Box>
  );

  if (!payload && (status === "loading" || error)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        {filterBar}
        <PaneStatusBody loading={status === "loading"} error={error} subject={filingsSubject} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <InputSearchBar value={searchQuery} focused={focused && !detailMode} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder="ticker, member, or date" debounceMs={80} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setSearchQuery} />
      {activeTab === "trades" ? (
        <DataTableStackView<CloudCongressTradePayload, TradeColumn>
          focused={focused && !searchFocused}
          detailOpen={detailMode !== null}
          onBack={() => setDetailMode(null)}
          detailTitle={detailTitle}
          detailContent={detailContent}
          selection={{
            kind: "id",
            selectedId: selectedTradeId,
            getId: (trade) => trade.id,
            onChange: (id) => setSelectedTradeId(id),
          }}
          onActivate={(trade) => {
            setSelectedTradeId(trade.id, { immediate: true });
            setDetailMode({ kind: "trade", tradeId: trade.id });
          }}
          onRootKeyDown={handleRootKeyDown}
          onDetailKeyDown={handleDetailKeyDown}
          rootBefore={filterBar}
          rootWidth={width}
          rootHeight={Math.max(1, height - 2)}
          columns={tradeColumns}
          items={tradeRows}
          sortColumnId={tradeSort.columnId}
          sortDirection={tradeSort.direction}
          onHeaderClick={(columnId) => setTradeSort((current) => nextSort(current, columnId as TradeColumnId, columnId === "member" || columnId === "ticker" ? "asc" : "desc"))}
          getItemKey={(trade) => trade.id}
          renderCell={renderCongressTradeCell}
          emptyStateTitle="No House PTR trades."
          scrollRef={tradeScrollRef}
          onBodyScrollActivity={onTradeScroll}
        />
      ) : (
        <DataTableStackView<CloudCongressMemberPayload, MemberColumn>
          focused={focused && !searchFocused}
          detailOpen={detailMode !== null}
          onBack={() => setDetailMode(null)}
          detailTitle={detailTitle}
          detailContent={detailContent}
          selection={{
            kind: "id",
            selectedId: selectedMemberId,
            getId: (member) => member.id,
            onChange: (id) => setSelectedMemberId(id),
          }}
          onActivate={(member) => {
            setSelectedMemberId(member.id, { immediate: true });
            setDetailMode({ kind: "member", memberId: member.id });
          }}
          onRootKeyDown={handleRootKeyDown}
          onDetailKeyDown={handleDetailKeyDown}
          rootBefore={filterBar}
          rootWidth={width}
          rootHeight={Math.max(1, height - 2)}
          columns={memberColumns}
          items={memberRows}
          sortColumnId={memberSort.columnId}
          sortDirection={memberSort.direction}
          onHeaderClick={(columnId) => setMemberSort((current) => nextSort(current, columnId as MemberColumnId, columnId === "member" || columnId === "district" ? "asc" : "desc"))}
          getItemKey={(member) => member.id}
          renderCell={renderCongressMemberCell}
          emptyStateTitle="No House PTR members."
        />
      )}
    </Box>
  );
}
