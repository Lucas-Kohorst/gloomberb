import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  useExternalLinkFooter,
  useTableLoadMore,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { TickerBadgeList } from "../../../components/ticker/badge/list";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { Box, type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useAppSelector, usePaneSettingValue } from "../../../state/app/context";
import { usePluginPaneState } from "../../runtime";
import type { PaneProps } from "../../../types/plugin";
import type {
  CloudSavedSearch,
  CloudSearchHit,
} from "../../../api-client";
import { getSharedRegistry } from "../../registry";
import { CloudAuthNotice } from "../cloud/auth-actions";
import { useCloudPlanAction } from "../shared/cloud-upgrade";
import { canUseCloudSearch, needsEmailVerification, usePlanAccess } from "../shared/plan-access";
import {
  createSavedSearch,
  deleteSavedSearch,
  errorMessage,
  isAbortError,
  loadSavedSearches,
  loadSearchDocument,
  runDocumentSearch,
  statusOf,
  updateSavedSearch,
} from "./data";
import { useDocumentFocusRequest } from "./focus-handoff";
import { SearchFilterBar } from "./filter-bar";
import { SearchDocumentView } from "./document-view";
import { SavedSearchesView } from "./saved-view";
import {
  appendUniqueHits,
  buildResultColumns,
  buildSearchParams,
  DEFAULT_FILTERS,
  filtersFromSaved,
  filtersToSaved,
  formatHitDate,
  hitMatchCountLabel,
  hitTypeLabel,
  parseTickerFilter,
  RESEARCH_SEARCH_PANE_ID,
  savedSearchName,
  type SearchColumn,
  type SearchFilters,
  researchHitId,
  researchHitPublishedAt,
  researchHitSnippet,
  researchHitTicker,
  researchHitTitle,
  researchHitTypeLabel,
  type ResearchSearchDocument,
  type ResearchSearchHit,
  filterProviderDocumentHits,
} from "./model";
import { parseMarkedSnippet, snippetPlainText, truncateSegments } from "./snippet";
import { usePersistedReadIds } from "../shared/read-state";
import { SnippetText } from "./snippet-text";

const QUERY_DEBOUNCE_MS = 300;
const TICKER_FIELD_WIDTH = 22;
const RESEARCH_READ_ADAPTER = {
  getIds: (state: { hitIds: string[] }) => state.hitIds,
  withIds: (_state: { hitIds: string[] }, hitIds: string[]) => ({ hitIds }),
};

type PaneMode = "results" | "saved";
type LoadStatus = "idle" | "loading" | "loaded" | "error";
type ActiveField = "query" | "tickers" | null;

interface RequestFailure {
  message: string;
  status?: number;
}

export function ResearchSearchPane({ focused, paneId, width, height }: PaneProps) {
  const access = usePlanAccess();
  const openPlan = useCloudPlanAction();
  const dialog = useDialog();
  const disabledDiscoveryKey = useAppSelector((state) => (
    `${state.config.disabledPlugins.join(",")}|${(state.config.disabledSources ?? []).join(",")}`
  ));

  const [seedQuery] = usePaneSettingValue("query", "");
  const [mode, setMode] = usePluginPaneState<PaneMode>("mode", "results");
  const [query, setQuery] = usePluginPaneState<string>("query", String(seedQuery ?? "").trim());
  const [filters, setFilters] = usePluginPaneState<SearchFilters>("filters", DEFAULT_FILTERS);

  const [hits, setHits] = useState<ResearchSearchHit[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const [openHit, setOpenHit] = useState<ResearchSearchHit | null>(null);
  const [document, setDocument] = useState<ResearchSearchDocument | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentFailure, setDocumentFailure] = useState<RequestFailure | null>(null);

  const [saved, setSaved] = useState<CloudSavedSearch[]>([]);
  const [savedStatus, setSavedStatus] = useState<LoadStatus>("idle");
  const [savedFailure, setSavedFailure] = useState<RequestFailure | null>(null);
  const [savedSelectedId, setSavedSelectedId] = useState<string | null>(null);
  const [savedBusy, setSavedBusy] = useState(false);

  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [fieldFocusToken, setFieldFocusToken] = useState(0);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const queryInputRef = useRef<InputRenderable | null>(null);
  const tickerInputRef = useRef<InputRenderable | null>(null);
  const tableScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);

  const trimmedQuery = query.trim();
  const { readIds, markRead } = usePersistedReadIds({
    key: "read-research-search",
    fallback: { hitIds: [] },
    schemaVersion: 1,
    adapter: RESEARCH_READ_ADAPTER,
  });

  const focusField = useCallback((field: Exclude<ActiveField, null>) => {
    setActiveField(field);
    setFieldFocusToken((current) => current + 1);
  }, []);
  const blurField = useCallback(() => setActiveField(null), []);

  const runSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    if (!trimmedQuery) {
      searchAbortRef.current = null;
      setHits([]);
      setStatus("idle");
      setFailure(null);
      setHasMore(false);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    setStatus("loading");
    setFailure(null);
    const registry = getSharedRegistry();
    const selectedSources = new Set(filters.sourceIds ?? []);
    const providers = (registry?.getAvailableDocumentSearchProviders() ?? []).filter((provider) => {
      if (selectedSources.size > 0 && !selectedSources.has(provider.id)) return false;
      if (filters.docTypes.length === 0 || !provider.documentTypes?.length) return true;
      return provider.documentTypes.some((type) => filters.docTypes.includes(type as import("../../../api-client").CloudSearchDocType));
    });
    const cloudSelected = selectedSources.size === 0 || selectedSources.has("cloud");
    const cloudSearch = canUseCloudSearch(access) && cloudSelected
      ? runDocumentSearch(buildSearchParams(trimmedQuery, filters), controller.signal)
      : Promise.resolve({ hits: [] as CloudSearchHit[], hasMore: false, nextOffset: 0 });
    void Promise.allSettled([
      cloudSearch,
      ...providers.map((provider) => provider.search(trimmedQuery, controller.signal)),
    ]).then((results) => {
        // A newer query already took over; this answer is for text nobody is reading.
        if (searchAbortRef.current !== controller) return;
        const cloudResult = results[0];
        const cloudResponse = cloudResult?.status === "fulfilled" ? cloudResult.value : null;
        const combined: ResearchSearchHit[] = (cloudResponse?.hits ?? []).map((hit) => ({ kind: "cloud", hit }));
        providers.forEach((provider, index) => {
          const result = results[index + 1];
          if (result?.status === "fulfilled") {
            const providerHits = result.value as import("../../../types/plugin").DocumentSearchHit[];
            combined.push(...filterProviderDocumentHits(providerHits, filters).map((hit) => ({ kind: "plugin" as const, providerId: provider.id, hit })));
          }
        });
        setHits(combined);
        setHasMore(cloudResponse?.hasMore === true);
        setNextOffset(cloudResponse?.nextOffset ?? (cloudResponse?.hits?.length ?? 0));
        const rejected = results.find((result) => result.status === "rejected");
        setFailure(rejected ? { message: errorMessage(rejected.reason), status: statusOf(rejected.reason) } : null);
        setStatus(rejected && combined.length === 0 ? "error" : "loaded");
      });
  }, [access.emailVerified, access.hasProAccess, disabledDiscoveryKey, filters, trimmedQuery]);

  useEffect(() => {
    runSearch();
    return () => {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
    };
  }, [runSearch]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || status !== "loaded" || !trimmedQuery) return;
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    moreAbortRef.current = controller;
    setLoadingMore(true);
    void runDocumentSearch(
      buildSearchParams(trimmedQuery, filters, { offset: nextOffset }),
      controller.signal,
    )
      .then((response) => {
        if (moreAbortRef.current !== controller) return;
        setHits((current) => {
          const pluginHits = current.filter((hit) => hit.kind === "plugin");
          const cloudHits = current.flatMap((hit) => hit.kind === "cloud" ? [hit.hit] : []);
          return [...appendUniqueHits(cloudHits, response.hits ?? []).map((hit) => ({ kind: "cloud" as const, hit })), ...pluginHits];
        });
        setHasMore(response.hasMore === true);
        setNextOffset(response.nextOffset ?? nextOffset + (response.hits?.length ?? 0));
      })
      .catch((error: unknown) => {
        if (moreAbortRef.current !== controller || isAbortError(error)) return;
        setFailure({ message: errorMessage(error), status: statusOf(error) });
      })
      .finally(() => {
        if (moreAbortRef.current === controller) setLoadingMore(false);
      });
  }, [filters, hasMore, loadingMore, nextOffset, status, trimmedQuery]);

  const loadMoreFromScroll = useTableLoadMore(
    tableScrollRef,
    hasMore && !loadingMore && status === "loaded",
    loadMore,
  );

  useEffect(() => {
    if (!openHit) {
      setDocument(null);
      setDocumentFailure(null);
      return;
    }
    const controller = new AbortController();
    setDocumentLoading(true);
    setDocumentFailure(null);
    setDocument(null);
    const load = openHit.kind === "cloud"
      ? loadSearchDocument(openHit.hit.docType, openHit.hit.sourceId, controller.signal).then((loaded) => ({ kind: "cloud" as const, document: loaded }))
      : (() => {
          const provider = getSharedRegistry()?.getAvailableDocumentSearchProviders()
            .find((candidate) => candidate.id === openHit.providerId);
          if (!provider) return Promise.reject(new Error("Document provider is unavailable."));
          return provider.load(openHit.hit.id, controller.signal).then((loaded) => ({ kind: "plugin" as const, document: loaded }));
        })();
    void load
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setDocument(loaded);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setDocumentFailure({ message: errorMessage(error), status: statusOf(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentLoading(false);
      });
    return () => controller.abort();
  }, [disabledDiscoveryKey, openHit]);

  const refreshSaved = useCallback(() => {
    if (!canUseCloudSearch(access)) return;
    setSavedStatus((current) => (current === "loaded" ? current : "loading"));
    setSavedFailure(null);
    void loadSavedSearches()
      .then((searches) => {
        setSaved(searches);
        // Alerts and delete act on the cursor row, so the list must start on one.
        setSavedSelectedId((current) => (
          current && searches.some((search) => search.id === current)
            ? current
            : searches[0]?.id ?? null
        ));
        setSavedStatus("loaded");
      })
      .catch((error: unknown) => {
        setSavedFailure({ message: errorMessage(error), status: statusOf(error) });
        setSavedStatus("error");
      });
  }, [access.emailVerified, access.hasProAccess]);

  useEffect(() => {
    if (mode !== "saved") return;
    refreshSaved();
  }, [mode, refreshSaved]);

  const saveCurrentSearch = useCallback(() => {
    const sourceRestricted = (filters.sourceIds?.length ?? 0) > 0 && !filters.sourceIds?.includes("cloud");
    if (!trimmedQuery || savedBusy || sourceRestricted) return;
    setSavedBusy(true);
    void createSavedSearch({
      name: savedSearchName(trimmedQuery, filters),
      query: trimmedQuery,
      filters: filtersToSaved(filters),
    })
      .then((search) => {
        setSaved((current) => [search, ...current.filter((entry) => entry.id !== search.id)]);
        setSavedSelectedId(search.id);
        setSavedStatus("loaded");
        setSavedFailure(null);
        setMode("saved");
      })
      .catch((error: unknown) => {
        setSavedFailure({ message: errorMessage(error), status: statusOf(error) });
      })
      .finally(() => setSavedBusy(false));
  }, [filters, savedBusy, setMode, trimmedQuery]);

  const toggleAlert = useCallback((search: CloudSavedSearch) => {
    const next = !search.alertEnabled;
    // Optimistic: the switch has to answer the click, and a failure puts it back.
    setSaved((current) => current.map((entry) => (
      entry.id === search.id ? { ...entry, alertEnabled: next } : entry
    )));
    void updateSavedSearch(search.id, { alertEnabled: next })
      .then((updated) => {
        setSaved((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        setSavedFailure(null);
      })
      .catch((error: unknown) => {
        setSaved((current) => current.map((entry) => (
          entry.id === search.id ? { ...entry, alertEnabled: search.alertEnabled } : entry
        )));
        setSavedFailure({ message: errorMessage(error), status: statusOf(error) });
      });
  }, []);

  const removeSaved = useCallback(async (search: CloudSavedSearch) => {
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title="Delete saved search?"
          body={[
            `Delete "${search.name || search.query}"?`,
            search.alertEnabled ? "Its keyword alert stops with it." : "",
          ].filter((line) => line.length > 0)}
          confirmLabel="Delete"
          width={44}
        />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;

    const previous = saved;
    setSaved((current) => current.filter((entry) => entry.id !== search.id));
    try {
      await deleteSavedSearch(search.id);
      setSavedFailure(null);
    } catch (error) {
      setSaved(previous);
      setSavedFailure({ message: errorMessage(error), status: statusOf(error) });
    }
  }, [dialog, saved]);

  const runSavedSearch = useCallback((search: CloudSavedSearch) => {
    setQuery(search.query);
    setFilters(filtersFromSaved(search));
    setSelectedHitId(null);
    setMode("results");
  }, [setFilters, setMode, setQuery]);

  const columns = useMemo(() => buildResultColumns(), []);
  const sourceOptions = useMemo(() => [
    { value: "cloud", label: "Gloom Cloud" },
    ...(getSharedRegistry()?.getAvailableDocumentSearchProviders() ?? []).map((provider) => ({
      value: provider.id,
      label: provider.name,
    })),
  ], [disabledDiscoveryKey]);

  const renderCell = useCallback((
    hit: ResearchSearchHit,
    column: SearchColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "ticker":
        return {
          text: researchHitTicker(hit),
          color: selectedColor ?? colors.textBright,
          content: (
            <TickerBadgeList
              symbols={researchHitTicker(hit) ? [researchHitTicker(hit)] : []}
              width={column.width}
              fallbackColor={selectedColor ?? colors.textBright}
              liveQuote={false}
            />
          ),
        };
      case "type":
        return { text: researchHitTypeLabel(hit), color: selectedColor ?? colors.textMuted };
      case "date":
        return { text: formatHitDate(researchHitPublishedAt(hit)), color: selectedColor ?? colors.textDim };
      case "title": {
        const id = researchHitId(hit);
        const read = readIds.has(id);
        return { text: researchHitTitle(hit), color: read ? colors.textMuted : (selectedColor ?? colors.text) };
      }
      case "match": {
        // The count leads so collapsing chunks into one row stays visible even
        // where the snippet behind it is cut off.
        const count = hit.kind === "cloud" ? hitMatchCountLabel(hit.hit) : "";
        const snippet = researchHitSnippet(hit);
        const segments = truncateSegments(
          [...(count ? [{ text: count, marked: false }] : []), ...parseMarkedSnippet(snippet)],
          column.width,
        );
        return {
          text: `${count}${snippetPlainText(snippet)}`,
          content: (
            <SnippetText
              segments={segments}
              color={selectedColor ?? colors.text}
              dimColor={selectedColor ?? colors.textDim}
            />
          ),
        };
      }
    }
  }, [readIds]);

  const closeDetail = useCallback(() => setOpenHit(null), []);

  // Opened straight onto a hit from the command bar, ahead of its own results.
  const focusRequestedHit = useCallback((hit: ResearchSearchHit) => {
    setSelectedHitId(researchHitId(hit));
    setOpenHit(hit);
  }, []);
  useDocumentFocusRequest(paneId, focusRequestedHit);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if ((event as { targetEditable?: boolean }).targetEditable) return false;
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusField("query");
      return true;
    }
    if (isPlainKey(event, "/")) {
      stopSearchFocusNavigation(event);
      focusField("query");
      return true;
    }
    if (isPlainKey(event, "t")) {
      stopSearchFocusNavigation(event);
      focusField("tickers");
      return true;
    }
    if (isPlainKey(event, "r")) {
      stopSearchFocusNavigation(event);
      runSearch();
      return true;
    }
    if (event.ctrl && event.name === "s") {
      stopSearchFocusNavigation(event);
      saveCurrentSearch();
      return true;
    }
    return false;
  }, [focusField, runSearch, saveCurrentSearch]);

  // Saved-mode r refreshes the list; results-mode r retries the search via the
  // table handler above. Both need a global binding because the footer hints it.
  useShortcut((event) => {
    if (!focused || mode !== "saved") return;
    if ((event as { targetEditable?: boolean }).targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    refreshSaved();
  }, { enabled: focused && mode === "saved" });

  // Search is free and uncapped, so nothing is gated up front: the upsell only
  // appears if the server itself refuses the query.
  const proRequired = failure?.status === 402;
  const signInRequired = !access.signedIn || failure?.status === 401 || savedFailure?.status === 401;
  const verificationRequired = needsEmailVerification(access, failure?.status);

  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const info: PaneFooterSegment[] = [];
    if (status === "loading" || documentLoading || savedStatus === "loading") {
      info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    }
    if (loadingMore) {
      info.push({ id: "loading-more", parts: [{ text: "loading more", tone: "muted" }] });
    }
    if (proRequired) {
      info.push({ id: "pro", parts: [{ text: "pro required", tone: "warning" }] });
    }
    // The results table and the document view each show their own failure, so
    // only a status token belongs here. Saved-search writes have nowhere else.
    if (failure) {
      info.push({
        id: "error",
        parts: [{ text: status === "error" ? "error" : "source error", tone: "warning" }],
      });
    }
    if (savedFailure) {
      info.push({ id: "saved-error", parts: [{ text: savedFailure.message, tone: "warning" }] });
    }
    return info;
  }, [
    documentLoading,
    failure,
    loadingMore,
    proRequired,
    savedFailure,
    savedStatus,
    status,
  ]);

  const footerHints = useMemo<PaneHint[]>(() => {
    if (mode === "saved") {
      const selected = saved.find((entry) => entry.id === savedSelectedId);
      const hints: PaneHint[] = [
        { id: "refresh", key: "r", label: "efresh", onPress: refreshSaved },
      ];
      if (!selected) return hints;
      return [
        ...hints,
        { id: "alert", key: "a", label: "lerts", onPress: () => toggleAlert(selected) },
        { id: "delete", key: "d", label: "elete", onPress: () => { void removeSaved(selected); } },
      ];
    }
    if (openHit) return [];
    const hints: PaneHint[] = [
      { id: "search", key: "/", label: "search", onPress: () => focusField("query") },
      { id: "refresh", key: "r", label: "efresh", onPress: runSearch },
    ];
    const sourceRestricted = (filters.sourceIds?.length ?? 0) > 0 && !filters.sourceIds?.includes("cloud");
    if (!trimmedQuery || sourceRestricted) return hints;
    return [...hints, { id: "save", key: "Ctrl+S", label: "save search", onPress: saveCurrentSearch }];
  }, [
    focusField,
    mode,
    openHit,
    refreshSaved,
    removeSaved,
    runSearch,
    saved,
    savedSelectedId,
    saveCurrentSearch,
    toggleAlert,
    trimmedQuery,
    filters.docTypes,
    filters.sourceIds,
  ]);

  // The stack title already names the open document, so the footer carries what
  // the title cannot: which company, when, what kind, and how long it is.
  const documentIdentity = useMemo(() => {
    if (!openHit) return null;
    const sections = document?.kind === "cloud" ? document.document.chunks.length : 0;
    return [
      formatHitDate(researchHitPublishedAt(openHit)),
      // The type leads the footer when the document has no ticker, so repeating
      // it here would say the same thing twice on one row.
      researchHitTicker(openHit) ? researchHitTypeLabel(openHit) : null,
      sections ? `${sections} section${sections === 1 ? "" : "s"}` : null,
    ].filter((part): part is string => !!part).join(" \u00b7 ");
  }, [document, openHit]);

  useExternalLinkFooter({
    registrationId: RESEARCH_SEARCH_PANE_ID,
    focused,
    url: openHit
      ? (openHit.kind === "cloud" ? openHit.hit.url : document?.kind === "plugin" ? document.document.sourceUrl : openHit.hit.url) ?? null
      : null,
    source: documentIdentity,
    // Never a fixed word: the row is led by whichever of these the document
    // actually has, because a footer is for what changes as you move between
    // documents, not for saying "document".
    label: openHit ? (researchHitTicker(openHit) || researchHitTypeLabel(openHit)) : "",
    info: footerInfo,
    hints: footerHints,
    showHint: !!(openHit && (openHit.kind === "cloud" ? openHit.hit.url : document?.kind === "plugin" ? document.document.sourceUrl : openHit.hit.url)),
    onOpen: openHit ? () => markRead(researchHitId(openHit)) : undefined,
  });

  if (signInRequired && mode === "saved") {
    return <CloudAuthNotice message="Sign in to search transcripts, news, and filings." />;
  }
  if (verificationRequired && mode === "saved") {
    return (
      <CloudAuthNotice
        needsVerification
        message="Verify your email to search transcripts, news, and filings."
      />
    );
  }

  const tabs = (
    <Tabs
      tabs={[
        { label: "Results", value: "results" },
        { label: "Saved", value: "saved" },
      ]}
      activeValue={mode}
      onSelect={(value) => setMode(value as PaneMode)}
      focused={focused && !openHit && activeField === null && !typePickerOpen}
    />
  );

  if (mode === "saved") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <SavedSearchesView
          searches={saved}
          selectedId={savedSelectedId}
          onSelect={setSavedSelectedId}
          onRun={runSavedSearch}
          onToggleAlert={toggleAlert}
          onDelete={(search) => { void removeSaved(search); }}
          focused={focused}
          width={width}
          height={Math.max(1, height - 1)}
          emptyTitle={savedStatus === "loading"
            ? "Loading saved searches..."
            : "Run a search, then press Ctrl+S to save it and get keyword alerts."}
        />
      </Box>
    );
  }

  if (proRequired) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexDirection="column" paddingX={1}>
          <EmptyState
            title="This search needs Gloom Cloud Pro."
            message="It indexes earnings call transcripts, news wires, and SEC filings so one query reaches across all three."
          />
          <Box flexDirection="row" marginTop={1}>
            <Button label="Manage account" variant="secondary" onPress={openPlan} />
          </Box>
        </Box>
      </Box>
    );
  }

  const compact = width < 76;
  const searchBars = (
    <Box flexDirection={compact ? "column" : "row"}>
      <InputSearchBar
        value={query}
        focused={focused && !openHit && !typePickerOpen}
        active={activeField === "query"}
        width={compact ? width : Math.max(20, width - TICKER_FIELD_WIDTH)}
        focusToken={fieldFocusToken}
        inputRef={queryInputRef}
        placeholder="words or phrase across calls, news, and filing metadata"
        debounceMs={QUERY_DEBOUNCE_MS}
        onFocus={() => focusField("query")}
        onBlur={blurField}
        onNavigateDown={blurField}
        onQueryChange={setQuery}
      />
      <InputSearchBar
        value={filters.tickers.join(" ")}
        focused={focused && !openHit && !typePickerOpen}
        active={activeField === "tickers"}
        width={compact ? width : TICKER_FIELD_WIDTH}
        focusToken={fieldFocusToken}
        inputRef={tickerInputRef}
        placeholder="tickers"
        glyph="#"
        debounceMs={QUERY_DEBOUNCE_MS}
        onFocus={() => focusField("tickers")}
        onBlur={blurField}
        onNavigateDown={blurField}
        onQueryChange={(value) => setFilters({ ...filters, tickers: parseTickerFilter(value) })}
      />
    </Box>
  );

  const emptyTitle = !trimmedQuery
    ? "Type a query to search transcripts, news, and filing metadata."
    : failure
      ? "Search failed."
      : "No documents matched.";

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableStackView<ResearchSearchHit, SearchColumn>
        focused={focused && activeField === null && !typePickerOpen}
        detailOpen={!!openHit}
        onBack={closeDetail}
        detailContent={openHit ? (
          <SearchDocumentView
            hit={openHit}
            document={document}
            loading={documentLoading}
            error={documentFailure?.status === 402
              ? "This document is part of Gloom Cloud Pro."
              : documentFailure?.message ?? null}
            width={width}
          />
        ) : (
          <Box flexGrow={1} />
        )}
        rootBefore={(
          <Box flexDirection="column">
            {searchBars}
            <SearchFilterBar
              filters={filters}
              onChange={setFilters}
              onDialogOpenChange={setTypePickerOpen}
              width={width}
              sourceOptions={sourceOptions}
            />
          </Box>
        )}
        onRootKeyDown={handleRootKeyDown}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        scrollRef={tableScrollRef}
        onBodyScrollActivity={loadMoreFromScroll}
        resetScrollKey={`${trimmedQuery}:${filters.sort}:${filters.range}:${filters.tickers.join(",")}:${filters.docTypes.join(",")}:${(filters.sourceIds ?? []).join(",")}`}
        columns={columns}
        items={hits}
        selection={{
          kind: "id",
          selectedId: selectedHitId,
          getId: researchHitId,
          onChange: setSelectedHitId,
        }}
        onActivate={(hit) => {
          blurField();
          markRead(researchHitId(hit));
          setOpenHit(hit);
        }}
        sortColumnId={filters.sort === "relevance" ? "match" : "date"}
        sortDirection={filters.sort === "oldest" ? "asc" : "desc"}
        onHeaderClick={(columnId) => {
          if (columnId === "match") {
            setFilters({ ...filters, sort: "relevance" });
            return;
          }
          if (columnId !== "date") return;
          setFilters({ ...filters, sort: filters.sort === "newest" ? "oldest" : "newest" });
        }}
        getItemKey={researchHitId}
        getRowRevision={(hit) => `${researchHitId(hit)}:${readIds.has(researchHitId(hit)) ? 1 : 0}`}
        renderCell={renderCell}
        showHorizontalScrollbar={false}
        emptyContent={status === "loading" && hits.length === 0
          ? <Spinner label="Searching..." />
          : undefined}
        emptyStateTitle={emptyTitle}
        emptyStateHint={failure?.message ? `${failure.message} Press r to retry.` : undefined}
      />
    </Box>
  );
}
