import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataTableStackView,
  DetailScrollBody,
  KeyValueRow,
  PaneStatusBody,
  QueryBar,
  usePaneStatusLinkFooter, usePaneLoadingSignal,
  useQueryBarSearch,
  useTableLoadMore,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
  type PaneHint,
  type QueryBarFilter,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useRefreshPollTrailing, useUpdatedFooterInfo } from "../../../components/layout/pane/freshness-footer";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { useResolvedEntryValue, useSecFilingsQuery } from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useAutoRefresh, usePaneSettingValue, usePaneTitle, usePluginPaneState } from "../../../public/react";
import { usePaneTickerIdentity } from "../../../state/hooks/pane-ticker";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, type ScrollBoxRenderable } from "../../../ui";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { SEC_FILING_FETCH_LIMIT } from "../sec/forms";
import { formatAccepted, formatAcceptedDetail } from "./client";
import {
  filterFilingRows,
  formChoices,
  formLabel,
  FUND_FORMS,
  issuerFilingRow,
  normalizeFilingForm,
  ROLE_OPTIONS,
  sortFilingRows,
  feedForm,
  type FilingSort,
} from "./filters";
import { useEdgarFilings } from "./stream";
import { EDGAR_FILINGS_PANE_ID, type EdgarFiling } from "./types";

const SEARCH_DEBOUNCE_MS = 350;
const ISSUER_PAGE = 100;

type ColumnId = "accepted" | "form" | "company" | "role" | "items";
type FilingColumn = DataTableColumn & { id: ColumnId };

function filingColumns(width: number): FilingColumn[] {
  return [
    { id: "accepted", label: "Accepted", width: 11, align: "left" },
    { id: "form", label: "Form", width: 14, align: "left" },
    { id: "company", label: "Company", width: 18, align: "left", flexGrow: 1 },
    ...(width >= 64 ? [{ id: "role" as const, label: "Role", width: 10, align: "left" as const }] : []),
    ...(width >= 96 ? [{ id: "items" as const, label: "Items", width: 18, align: "left" as const, flexGrow: 1 }] : []),
  ];
}

export function EdgarFilingsPane({ width, height, focused }: PaneProps) {
  const [storedForm] = usePaneSettingValue("form", "");
  const [form, setForm] = usePluginPaneState("form", normalizeFilingForm(String(storedForm ?? "")));
  const { symbol: boundSymbol } = usePaneTickerIdentity();
  const [tickerOverride, setTickerOverride] = usePluginPaneState<string | null>("tickerOverride", null);
  const [role, setRole] = usePluginPaneState("role", "");
  const [sort, setSort] = usePluginPaneState<FilingSort>("sort", "accepted");
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = usePluginPaneState<string | null>("openItemId", null);
  const [visibleCount, setVisibleCount] = useState(ISSUER_PAGE);
  const { active: searchFocused, focus: focusSearch, searchProps } = useQueryBarSearch();
  const tickerSearch = useQueryBarSearch();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const ticker = (tickerOverride ?? boundSymbol ?? "").trim().toUpperCase();
  const feed = feedForm(form);
  const tape = useEdgarFilings(feed, ticker.length === 0);
  const instrument = useMemo(() => (ticker ? instrumentFromTicker(null, ticker) : null), [ticker]);
  const issuerEntry = useSecFilingsQuery(instrument ? { instrument, count: SEC_FILING_FETCH_LIMIT } : null);
  const issuerFilings = useResolvedEntryValue(issuerEntry);
  const issuerSource = useMemo(
    () => (issuerFilings ?? []).map((item) => issuerFilingRow(item, ticker)),
    [issuerFilings, ticker],
  );

  const scope = [ticker, form ? formLabel(form) : ""].filter(Boolean).join(" ");
  usePaneTitle(scope ? `Filings ${scope}` : "Latest Filings");

  const filtered = useMemo(() => {
    const source = ticker ? issuerSource : tape.rows;
    return sortFilingRows(filterFilingRows(source, form, role), sort);
  }, [form, issuerSource, role, sort, tape.rows, ticker]);
  const rows = ticker ? filtered.slice(0, visibleCount) : filtered;

  useEffect(() => {
    setVisibleCount(ISSUER_PAGE);
  }, [ticker, form, role, sort]);

  const loadMoreRows = useCallback(() => {
    setVisibleCount((current) => current + ISSUER_PAGE);
  }, []);
  const loadMore = useTableLoadMore(
    scrollRef,
    (ticker ? visibleCount < filtered.length : tape.hasMore) && !openItemId,
    ticker ? loadMoreRows : tape.loadMore,
  );
  const columns = useMemo(() => filingColumns(width), [width]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const openFiling = openItemId ? filtered.find((row) => row.id === openItemId) ?? null : null;
  const issuerError = ticker
    ? (getSharedMarketDataCoordinator()
      ? issuerEntry?.error && issuerEntry.error.reasonCode !== "NO_DATA" ? issuerEntry.error.message : null
      : "Filings unavailable.")
    : null;
  const issuerLoading = !!ticker && filtered.length === 0 && !issuerError && issuerEntry?.phase !== "ready" && issuerEntry?.phase !== "error";
  const loading = ticker ? issuerLoading : tape.loading && rows.length === 0;
  const error = ticker ? issuerError : tape.error?.message ?? null;

  useEffect(() => {
    if (!openItemId || openFiling || loading || tape.loadingMore) return;
    setOpenItemId(null);
  }, [loading, openFiling, openItemId, setOpenItemId, tape.loadingMore]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setOpenItemId(null);
  }, [setOpenItemId, setSelectedId]);
  const updateForm = useCallback((next: string) => {
    setForm(normalizeFilingForm(next));
    clearSelection();
  }, [clearSelection, setForm]);
  const updateTicker = useCallback((next: string) => {
    setTickerOverride(next.trim().toUpperCase());
    clearSelection();
  }, [clearSelection, setTickerOverride]);

  const reloadIssuer = useCallback(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator || !instrument) return;
    void coordinator.loadSecFilings({ instrument, count: SEC_FILING_FETCH_LIMIT }, { forceRefresh: true });
  }, [instrument]);
  const searching = searchFocused || tickerSearch.active;
  const reload = ticker ? reloadIssuer : tape.reload;
  usePaneRefreshKey(reload, { focused, enabled: !searching });
  const updatedAt = ticker ? issuerEntry?.fetchedAt ?? null : tape.updatedAt;
  useAutoRefresh(updatedAt, reload);

  const link = openFiling ?? selected;
  const updatedInfo = useUpdatedFooterInfo(updatedAt);
  const trailingInfo = useRefreshPollTrailing(updatedAt != null);
  const info = useMemo<PaneFooterSegment[]>(() => [
    ...updatedInfo,
    ...(tape.moreError ? [{ id: "more-error", parts: [{ text: tape.moreError.message, tone: "warning" as const }] }] : []),
  ], [tape.loadingMore, tape.moreError, updatedInfo]);
  const hints = useMemo<PaneHint[]>(
    () => (openItemId ? [] : [{ id: "search", key: "/", label: "form", title: "Filter by form", onPress: focusSearch }]),
    [focusSearch, openItemId],
  );
  usePaneLoadingSignal((tape.loadingMore));
  usePaneStatusLinkFooter({
    registrationId: EDGAR_FILINGS_PANE_ID,
    focused,
    url: link?.filingUrl,
    label: "filing",
    loading,
    error: rows.length > 0 ? error : null,
    info,
    hints,
    trailingInfo,
    showOpenHint: !!link?.filingUrl,
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const renderCell = useCallback((filing: EdgarFiling, column: FilingColumn): DataTableCell => {
    switch (column.id) {
      case "accepted":
        return { text: formatAccepted(filing.acceptedAt, new Date()), value: filing.acceptedAt, color: colors.textMuted };
      case "form":
        return { text: filing.form, color: colors.textBright };
      case "company":
        return { text: filing.companyName, color: colors.text };
      case "role":
        return { text: filing.role, color: colors.textDim };
      case "items":
        return { text: filing.items.join("; "), color: colors.textDim };
    }
  }, []);

  const filters = useMemo<QueryBarFilter[]>(() => [
    {
      id: "form",
      label: "Form",
      value: normalizeFilingForm(form),
      defaultValue: "",
      options: formChoices(form),
      onChange: updateForm,
    },
    {
      id: "role",
      label: "Role",
      value: role,
      defaultValue: "",
      options: ROLE_OPTIONS,
      onChange: (value: string) => {
        setRole(value);
        clearSelection();
      },
    },
    {
      id: "ticker",
      kind: "text",
      label: "Ticker",
      value: ticker,
      placeholder: "AAPL",
      focused,
      width: 8,
      debounceMs: SEARCH_DEBOUNCE_MS,
      ...tickerSearch.searchProps,
      onChange: updateTicker,
    },
  ], [clearSelection, focused, form, role, setRole, ticker, tickerSearch.searchProps, updateForm, updateTicker]);

  const searchBar = (
    <QueryBar
      width={width}
      search={{
        value: form === FUND_FORMS ? "" : form,
        onChange: updateForm,
        placeholder: "form",
        focused: focused && !openItemId,
        debounceMs: SEARCH_DEBOUNCE_MS,
        normalizeValue: normalizeFilingForm,
        ...searchProps,
      }}
      filters={filters}
      view={{
        value: sort,
        options: [
          { value: "accepted", label: "Newest" },
          { value: "company", label: "Company" },
        ],
        onChange: (value: FilingSort) => setSort(value),
      }}
    />
  );

  const emptyTitle = ticker
    ? `No ${form ? `${formLabel(form)} ` : ""}filings for ${ticker}.`
    : form ? `No ${formLabel(form)} filings.` : "No filings.";

  if (loading || (error && rows.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <PaneStatusBody loading={loading} error={error} subject="filings" errorTitle="Filings unavailable." />
      </Box>
    );
  }

  const detailWidth = Math.max(0, width - 2);
  const detail = openFiling ? (
    <DetailScrollBody ref={detailScrollRef} resetScrollKey={openFiling.id}>
      <KeyValueRow label="Accepted" value={formatAcceptedDetail(openFiling.acceptedAt)} width={detailWidth} />
      <KeyValueRow label="Filed" value={openFiling.filedDate} width={detailWidth} />
      <KeyValueRow label="Role" value={openFiling.role} width={detailWidth} />
      <KeyValueRow label="CIK" value={String(Number(openFiling.cik))} width={detailWidth} />
      <KeyValueRow label="Accession" value={openFiling.accessionNumber} width={detailWidth} />
      {openFiling.size ? <KeyValueRow label="Size" value={openFiling.size} width={detailWidth} /> : null}
      {openFiling.items.length > 0 ? (
        <KeyValueRow label="Items" value={openFiling.items.join("; ")} width={detailWidth} />
      ) : null}
    </DetailScrollBody>
  ) : null;

  return (
    <DataTableStackView<EdgarFiling, FilingColumn>
      focused={focused && !searching}
      detailOpen={!!openFiling}
      onBack={() => setOpenItemId(null)}
      detailContent={detail}
      detailTitle={openFiling ? `${openFiling.form} · ${openFiling.companyName}` : undefined}
      detailScrollRef={detailScrollRef}
      rootBefore={searchBar}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      getItemKey={(filing) => filing.id}
      renderCell={renderCell}
      selection={{
        kind: "id",
        selectedId: selected?.id ?? null,
        getId: (filing) => filing.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={(filing) => setOpenItemId(filing.id)}
      onRootKeyDown={handleRootKeyDown}
      sortColumnId={null}
      sortDirection="desc"
      scrollRef={scrollRef}
      onBodyScrollActivity={loadMore}
      selectedTextOverridesCellColor
      emptyStateTitle={emptyTitle}
    />
  );
}
