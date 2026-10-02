import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type ScrollBoxRenderable } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  PaneListChrome,
  PaneStatusBody,
  SegmentedControl,
  usePaneListSearch,
  useTableLoadMore,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { useAppSelector, usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { usePluginPaneState } from "../../runtime";
import { useCloudUpgradeAction } from "../shared/cloud-upgrade";
import { useAutoRefresh } from "../shared/auto-refresh";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { usePlanAccess } from "../shared/plan-access";
import { useBoundTicker } from "../shared/ticker-request";
import { useQuoteBoard } from "../shared/use-quote-board";
import type { MnaDeal, MnaDealsPayload, MnaRegionFilter, MnaStatusFilter, MnaTargetFilter } from "../../../api-client/mna";
import { appendMnaDeals, fetchMnaDeals, isAccessDenied, loadMnaDeals, peekMnaDeals, type MnaResource } from "./client";
import { MnaDealDetail, mnaDealTitle } from "./detail";
import {
  dealSpread,
  expectedCloseDate,
  formatDealValue,
  formatExpectedClose,
  formatListDate,
  formatPercentShort,
  formatPrice,
  MISSING,
  partyCell,
  stageLabel,
  termsLabel,
} from "./model";

const STATUS_OPTIONS: { value: MnaStatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "talks", label: "Talks" },
  { value: "completed", label: "Completed" },
  { value: "terminated", label: "Terminated" },
  { value: "all", label: "All" },
];
const TARGET_OPTIONS: { value: MnaTargetFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];
const REGION_OPTIONS: { value: MnaRegionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "us", label: "US" },
  { value: "intl", label: "Intl" },
];

type ColumnId = "date" | "target" | "acquirer" | "terms" | "value" | "price" | "spread" | "annualized" | "close" | "stage";

const COLUMNS: Record<ColumnId, DataTableColumn> = {
  date: { id: "date", label: "DATE", width: 8, align: "left" },
  target: { id: "target", label: "TARGET", width: 16, align: "left", flexGrow: 1 },
  acquirer: { id: "acquirer", label: "ACQUIRER", width: 16, align: "left", flexGrow: 1 },
  terms: { id: "terms", label: "TERMS", width: 18, align: "left" },
  value: { id: "value", label: "VALUE", width: 8, align: "right" },
  price: { id: "price", label: "PRICE", width: 9, align: "right" },
  spread: { id: "spread", label: "SPREAD", width: 7, align: "right" },
  annualized: { id: "annualized", label: "ANN.", width: 7, align: "right" },
  close: { id: "close", label: "CLOSE", width: 7, align: "left" },
  stage: { id: "stage", label: "STAGE", width: 22, align: "left" },
};

const COLUMNS_BY_STATUS: Record<MnaStatusFilter, ColumnId[]> = {
  pending: ["date", "target", "acquirer", "terms", "value", "price", "spread", "annualized", "close", "stage"],
  talks: ["date", "target", "acquirer", "value", "stage"],
  completed: ["date", "target", "acquirer", "terms", "value", "close"],
  terminated: ["date", "target", "acquirer", "terms", "value", "close"],
  all: ["date", "target", "acquirer", "terms", "value", "spread", "stage"],
};

/** Drop these first when the pane is too narrow. Target stays. */
const DROP_ORDER: ColumnId[] = ["price", "close", "date", "value", "annualized", "terms", "stage", "acquirer", "spread"];

const TEXT_SORT = new Set<ColumnId>(["target", "acquirer", "stage", "close"]);
const NO_DEALS: MnaDeal[] = [];
const NO_SYMBOLS: string[] = [];
const NO_HINTS: PaneHint[] = [];
const NO_INFO: PaneFooterSegment[] = [];

function isColumnId(id: string): id is ColumnId {
  return Object.prototype.hasOwnProperty.call(COLUMNS, id);
}

function isStatus(value: string): value is MnaStatusFilter {
  return STATUS_OPTIONS.some((option) => option.value === value);
}

function isTarget(value: string): value is MnaTargetFilter {
  return TARGET_OPTIONS.some((option) => option.value === value);
}

function isRegion(value: string): value is MnaRegionFilter {
  return REGION_OPTIONS.some((option) => option.value === value);
}

function mnaColumns(status: MnaStatusFilter, width: number): DataTableColumn[] {
  let ids = [...COLUMNS_BY_STATUS[status]];
  const need = (list: ColumnId[]) => list.reduce((sum, id) => sum + COLUMNS[id].width + 1, 0);
  for (const drop of DROP_ORDER) {
    if (need(ids) <= width) break;
    ids = ids.filter((id) => id !== drop);
  }
  const ended = status === "completed" || status === "terminated";
  return ids.map((id) => ({
    ...COLUMNS[id],
    ...(id === "close" && ended ? { label: "CLOSED" } : {}),
  }));
}

interface ListState {
  key: string;
  resource: MnaResource<MnaDealsPayload> | null;
  loading: boolean;
  error: string | null;
}

/** `MA`, or `MA ACVA` with the ticker kept in pane settings. */
export function MnaPane({ focused, width, height }: PaneProps) {
  const [ticker] = usePaneSettingValue("ticker", "");
  const symbol = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
  return <MnaDealsView key={symbol} focused={focused} width={width} height={height} symbol={symbol || null} />;
}

export function MnaTickerTab({ focused, width, height }: TickerResearchTabProps) {
  const { symbol } = useBoundTicker();
  if (!symbol) return <EmptyState title="Select a ticker." />;
  return <MnaDealsView key={symbol} focused={focused} width={width} height={height} symbol={symbol} />;
}

function MnaDealsView({ focused, width, height, symbol }: {
  focused: boolean;
  width: number;
  height: number;
  /** Deals where this company is the target or the buyer. */
  symbol: string | null;
}) {
  const pro = usePlanAccess().hasProAccess;
  const openUpgrade = useCloudUpgradeAction();
  const refreshMinutes = useAppSelector((state) => state.config.refreshIntervalMinutes);
  const prefix = symbol ? "ticker." : "";
  const [status, setStatus] = usePluginPaneState<MnaStatusFilter>(`${prefix}status`, symbol ? "all" : "pending");
  // Listed targets first. The spread is what makes the pending list worth opening.
  const [target, setTarget] = usePluginPaneState<MnaTargetFilter>(`${prefix}target`, "public");
  const [region, setRegion] = usePluginPaneState<MnaRegionFilter>(`${prefix}region`, "all");
  const [storedSelected, setStoredSelected] = usePluginPaneState<string>(`${prefix}selected`, "");
  // A closed detail is stored as "". Pane state treats null as unset.
  const [storedOpen, setStoredOpen] = usePluginPaneState<string>(`${prefix}open`, "");
  const openId = storedOpen || null;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortPreference<ColumnId>>({ columnId: null, direction: "desc" });
  const [list, setList] = useState<ListState>({ key: "", resource: null, loading: true, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  const [paged, setPaged] = useState<{ owner: MnaDealsPayload; payload: MnaDealsPayload } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const forceRef = useRef(false);
  const pageRequest = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const listSearch = usePaneListSearch({
    focused,
    enabled: !openId,
    value: query,
    onQueryChange: setQuery,
    placeholder: symbol ? "company" : "company or ticker",
    debounceMs: 250,
  });

  const params = useMemo(() => ({
    status,
    target: symbol ? undefined : target,
    region: symbol ? undefined : region,
    symbol: symbol ?? undefined,
    query: query.trim() || undefined,
  }), [query, region, status, symbol, target]);
  const paramsKey = JSON.stringify(params);

  const reload = useCallback((force: boolean) => {
    forceRef.current = force;
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    const force = forceRef.current;
    forceRef.current = false;
    let cancelled = false;
    const peeked = force ? null : peekMnaDeals(params, pro);
    if (peeked && !peeked.stale) {
      setList({ key: paramsKey, resource: peeked, loading: false, error: null });
      return;
    }
    setList((current) => ({
      key: paramsKey,
      resource: peeked ?? (current.key === paramsKey ? current.resource : null),
      loading: true,
      error: null,
    }));
    void loadMnaDeals(params, pro, { force })
      .then((resource) => {
        if (cancelled) return;
        setList({ key: paramsKey, resource, loading: false, error: resource.refreshError });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setList((current) => ({
          key: paramsKey,
          resource: isAccessDenied(error) || current.key !== paramsKey ? null : current.resource,
          loading: false,
          error: message,
        }));
      });
    return () => { cancelled = true; };
  }, [params, paramsKey, pro, reloadToken]);

  const ready = list.key === paramsKey;
  const resource = ready ? list.resource : null;
  const loading = !ready || list.loading;
  const error = ready ? list.error : null;
  const first = resource?.payload ?? null;
  const data = paged && paged.owner === first ? paged.payload : first;
  const deals = data?.deals ?? NO_DEALS;

  useAutoRefresh(openId ? null : resource?.fetchedAt ?? null, () => reload(true));
  useEffect(() => () => pageRequest.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (!data?.hasMore || !first || loadingMore || openId) return;
    pageRequest.current?.abort();
    const request = new AbortController();
    pageRequest.current = request;
    setLoadingMore(true);
    void fetchMnaDeals({ ...params, offset: data.nextOffset }, request.signal)
      .then((page) => {
        if (pageRequest.current !== request) return;
        setPaged({ owner: first, payload: appendMnaDeals(data, page) });
      })
      .catch(() => {})
      .finally(() => {
        if (pageRequest.current === request) setLoadingMore(false);
      });
  }, [data, first, loadingMore, openId, params]);
  const onScroll = useTableLoadMore(scrollRef, !!data?.hasMore && !loadingMore && !openId, loadMore);

  const quoteKey = useMemo(() => {
    const symbols = new Set<string>();
    for (const deal of deals) {
      if (deal.status !== "pending" || !deal.target.symbol) continue;
      symbols.add(deal.target.symbol);
      if (deal.terms.exchangeRatio != null && deal.terms.ratioSymbol) symbols.add(deal.terms.ratioSymbol);
    }
    return [...symbols].sort().join("\n");
  }, [deals]);
  const quoteSymbols = useMemo(() => (quoteKey ? quoteKey.split("\n") : NO_SYMBOLS), [quoteKey]);
  const { quotes } = useQuoteBoard(quoteSymbols, Math.max(1, refreshMinutes || 1) * 60_000);
  const spreadOf = useCallback((deal: MnaDeal) => {
    const quote = deal.target.symbol ? quotes.get(deal.target.symbol)?.quote ?? null : null;
    const ratio = deal.terms.ratioSymbol ? quotes.get(deal.terms.ratioSymbol)?.quote ?? null : null;
    return dealSpread(deal, quote, ratio);
  }, [quotes]);

  const sorted = useMemo(() => applySortPreference(deals, sort, (deal, columnId) => {
    switch (columnId) {
      case "date": return deal.announced;
      case "target": return partyCell(deal.target, true);
      case "acquirer": return deal.acquirer?.name ?? null;
      case "terms": return termsLabel(deal.terms);
      case "value": return deal.valueUsd;
      case "price": return spreadOf(deal)?.price ?? null;
      case "spread": return spreadOf(deal)?.spread ?? null;
      case "annualized": return spreadOf(deal)?.annualized ?? null;
      case "close": return deal.closed ?? expectedCloseDate(deal.expectedClose)?.toISOString().slice(0, 10) ?? null;
      case "stage": return stageLabel(deal);
      default: return null;
    }
  }), [deals, sort, spreadOf]);

  const selected = deals.find((deal) => deal.id === storedSelected) ?? deals[0] ?? null;
  const locked = data?.access === "delayed" ? data.lockedDeals : 0;
  const columns = useMemo(() => mnaColumns(status, width), [status, width]);
  const staleInfo = useMemo<PaneFooterSegment[]>(
    () => (resource?.stale ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" }] }] : NO_INFO),
    [resource?.stale],
  );

  useEffect(() => {
    if (openId) listSearch.blurSearch();
  }, [listSearch.blurSearch, openId]);

  const onRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (openId) return false;
    if (listSearch.handleSearchKey(event)) return true;
    if (listSearch.searchFocused || !isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload(true);
    return true;
  }, [listSearch.handleSearchKey, listSearch.searchFocused, openId, reload]);

  useShortcut((event) => {
    if (!focused || openId || listSearch.searchFocused || event.targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    reload(true);
  }, { enabled: focused && !openId && !listSearch.searchFocused });

  usePaneStatusFooter({
    registrationId: "mna",
    focused: focused && !openId && !listSearch.searchFocused,
    enabled: !openId,
    loading: loading || loadingMore,
    error,
    info: staleInfo,
    hints: NO_HINTS,
  });

  const onHeaderClick = useCallback((id: string) => {
    if (!isColumnId(id)) return;
    setSort((current) => nextSortPreference(current, id, {
      defaultDirection: (columnId) => (TEXT_SORT.has(columnId) ? "asc" : "desc"),
      resetTo: { columnId: null, direction: "desc" },
    }));
  }, []);

  const renderCell = useCallback((deal: MnaDeal, column: DataTableColumn, _index: number, state: { selected: boolean }): DataTableCell => {
    const base = state.selected ? colors.selectedText : colors.text;
    const muted = state.selected ? colors.selectedText : colors.textMuted;
    switch (column.id) {
      case "date": return { text: formatListDate(deal.announced), color: muted };
      case "target": return { text: partyCell(deal.target, true), color: base };
      case "acquirer": return deal.acquirer
        ? { text: deal.acquirer.name, color: base }
        : { text: "Undisclosed", color: muted };
      case "terms": {
        const text = termsLabel(deal.terms);
        return { text, color: text === MISSING ? muted : base };
      }
      case "value": return { text: formatDealValue(deal.value, deal.valueCurrency), color: base };
      case "price": {
        const spread = spreadOf(deal);
        return { text: spread ? formatPrice(spread.price) : MISSING, color: spread ? base : muted };
      }
      case "spread": {
        const spread = spreadOf(deal);
        if (!spread) return { text: MISSING, color: muted };
        // Negative: the market expects better terms than the ones on the table.
        return { text: formatPercentShort(spread.spread), color: spread.spread < 0 && !state.selected ? colors.warning : base };
      }
      case "annualized": {
        const annualized = spreadOf(deal)?.annualized ?? null;
        return { text: annualized == null ? MISSING : formatPercentShort(annualized), color: annualized == null ? muted : base };
      }
      case "close": {
        const ended = deal.status === "completed" || deal.status === "terminated";
        return ended
          ? { text: deal.closed ? formatListDate(deal.closed) : MISSING, color: muted }
          : { text: formatExpectedClose(deal.expectedClose), color: deal.expectedClose ? base : muted };
      }
      case "stage": {
        const tone = state.selected ? colors.selectedText
          : deal.status === "completed" ? colors.positive
            : deal.status === "terminated" ? colors.negative
              : deal.status === "talks" || deal.stale ? colors.textMuted
                : deal.hostile ? colors.warning
                  : colors.text;
        return { text: stageLabel(deal), color: tone };
      }
      default: return { text: "" };
    }
  }, [spreadOf]);

  const openDeal = deals.find((deal) => deal.id === openId) ?? null;
  const chrome = (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" paddingX={1} gap={2} overflow="hidden" alignItems="center">
        <SegmentedControl
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => { if (isStatus(value)) setStatus(value); }}
        />
        {symbol ? null : (
          <>
            <SegmentedControl
              options={TARGET_OPTIONS}
              value={target}
              onChange={(value) => { if (isTarget(value)) setTarget(value); }}
            />
            <SegmentedControl
              options={REGION_OPTIONS}
              value={region}
              onChange={(value) => { if (isRegion(value)) setRegion(value); }}
            />
          </>
        )}
      </Box>
      {locked > 0 ? (
        <Box paddingX={1} onMouseDown={openUpgrade} cursor="pointer">
          <Text fg={colors.warning}>
            {locked === 1 ? "1 newer deal needs Gloom Pro" : `${locked} newer deals need Gloom Pro`}
          </Text>
        </Box>
      ) : null}
      <PaneListChrome width={width} focused={focused && !openId} search={listSearch.search} />
    </Box>
  );

  if (!data && !openId) {
    return (
      <Box width={width} height={height} flexDirection="column">
        {chrome}
        <PaneStatusBody loading={loading} error={error} subject="M&A deals" empty={false} />
      </Box>
    );
  }

  return (
    <DataTableStackView<MnaDeal>
      focused={focused && !listSearch.searchFocused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={chrome}
      columns={columns}
      items={sorted}
      getItemKey={(deal) => deal.id}
      selection={{
        kind: "id",
        selectedId: selected?.id ?? null,
        getId: (deal) => deal.id,
        onChange: (id) => setStoredSelected(id),
      }}
      onActivate={(deal) => setStoredOpen(deal.id)}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={onHeaderClick}
      renderCell={renderCell}
      scrollRef={scrollRef}
      onBodyScrollActivity={onScroll}
      resetScrollKey={paramsKey}
      onRootKeyDown={onRootKeyDown}
      emptyStateTitle={query.trim() ? "No matching deals." : symbol ? `No deals involving ${symbol}.` : "No deals."}
      detailOpen={!!openId}
      onBack={() => setStoredOpen("")}
      detailTitle={openDeal ? mnaDealTitle(openDeal) : undefined}
      detailContent={openId ? (
        <MnaDealDetail
          key={openId}
          id={openId}
          seed={openDeal}
          focused={focused}
          width={width}
          height={Math.max(4, height - 1)}
        />
      ) : null}
    />
  );
}
