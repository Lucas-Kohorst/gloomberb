import { Box, ScrollBox, Text, TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  PaneProps,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import type { NewsArticle } from "../../../news/types";
import {
  DataTableStackView,
  EmptyState,
  PaneListChrome,
  Spinner,
  nextStackSortPreference,
  sortStackItems,
  useTableLoadMore,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type StackSortPreference,
} from "../../../components";
import { MarkdownText } from "../../../components/markdown-text";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { colors } from "../../../theme/colors";
import { usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { newsArticleSharePayload, useCopyShareLink } from "../shared/article-share";
import { useNewsReadState } from "../news/wire/read-state";
import { formatTimeAgo } from "../../../utils/format";
import { wrapTextLines } from "../../../utils/text-wrap";
import type { AdjacentClient } from "./client";
import { cftcPageHasMore, loadCftcFilings } from "./client";
import {
  buildDetailBody,
  buildDetailMeta,
  feedLabel,
  filingKindLabel,
  filingListTimestamp,
  filingPublishedAt,
  filingRelativeTimeRevision,
  filingSeenAt,
  formatFilingDay,
  stripLeadingHeading,
} from "./filings-format";
import {
  renderCftcSummary,
  useCftcFilingSummary,
} from "./filings-summary";
import {
  type CftcFiling,
  type CftcFilingDetail,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const DETAIL_DEBOUNCE_MS = 300;
const CFTC_PAGE_SIZE = 100;

const trimSearchValue = (value: string) => value.trim();

function cftcFilingToArticle(filing: CftcFiling, detail: CftcFilingDetail | null): NewsArticle {
  const label = feedLabel(filing);
  return {
    id: `cftc:${filing.id}`,
    title: filing.title,
    url: detail?.sourceUrl ?? "",
    source: "CFTC",
    publishedAt: filingListTimestamp(filing),
    summary: [filing.orgCode, filing.status, label].filter(Boolean).join(" · "),
    topic: "filing",
    topics: ["filing", "cftc", filing.feed],
    sectors: [],
    categories: ["CFTC", label],
    tickers: [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "cftc",
    body: detail ? stripLeadingHeading(detail.markdown) || undefined : undefined,
  };
}

type FilingColumnId = "seen" | "published" | "org" | "type" | "status" | "filing";
type FilingColumn = DataTableColumn & { id: FilingColumnId };

const DEFAULT_FILING_SORT: StackSortPreference<FilingColumnId> = {
  columnId: "seen",
  direction: "desc",
};

function createFilingColumns(): FilingColumn[] {
  return [
    { id: "seen", label: "SEEN", width: 8, align: "left" },
    { id: "published", label: "DAY", width: 8, align: "left" },
    { id: "org", label: "ORG", width: 8, align: "left" },
    { id: "type", label: "TYPE", width: 13, align: "left" },
    { id: "status", label: "STATUS", width: 14, align: "left" },
    { id: "filing", label: "FILING", width: 16, align: "left", flexGrow: 1 },
  ];
}

function filingSortValue(filing: CftcFiling, columnId: FilingColumnId): string | number | null {
  switch (columnId) {
    case "seen":
      return filingSeenAt(filing)?.getTime() ?? 0;
    case "published":
      return filingPublishedAt(filing)?.getTime() ?? 0;
    case "org":
      return filing.orgCode;
    case "type":
      return filingKindLabel(filing);
    case "status":
      return filing.status;
    case "filing":
      return filing.title;
  }
}

function compareFilings(left: CftcFiling, right: CftcFiling, columnId: FilingColumnId): number {
  const leftValue = filingSortValue(left, columnId);
  const rightValue = filingSortValue(right, columnId);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }
  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
    sensitivity: "base",
  });
}

function filingId(filing: CftcFiling): string {
  return String(filing.id);
}

function renderFilingCell(
  filing: CftcFiling,
  column: FilingColumn,
  selected: boolean,
  read = false,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "seen": {
      const seen = filingSeenAt(filing);
      return { text: seen ? formatTimeAgo(seen) : "—", color: sel ?? colors.textDim };
    }
    case "published": {
      const published = formatFilingDay(filingPublishedAt(filing));
      return { text: published ?? "—", color: sel ?? colors.textDim };
    }
    case "org":
      return { text: filing.orgCode, color: sel ?? colors.textMuted };
    case "type":
      return { text: filingKindLabel(filing), color: sel ?? colors.textDim };
    case "status":
      return { text: filing.status.trim() || "—", color: sel ?? colors.textDim };
    case "filing":
      return {
        text: filing.title,
        color: read ? colors.textMuted : (sel ?? colors.text),
        attributes: read ? TextAttributes.NONE : TextAttributes.BOLD,
      };
  }
}

function FilingDetail({
  filing,
  detail,
  loading,
  summaryMarkdown,
  summarizing,
  width,
  scrollRef,
}: {
  filing: CftcFiling;
  detail: CftcFilingDetail | null;
  loading: boolean;
  summaryMarkdown?: string | null;
  summarizing?: boolean;
  width: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const lineWidth = Math.max(width - 2, 12);
  const meta = buildDetailMeta(filing);
  const body = buildDetailBody(filing, detail, loading);
  const summaryText = summarizing
    ? "Summarizing with AI..."
    : summaryMarkdown ?? "";
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      overflow="hidden"
      paddingX={1}
      paddingY={1}
    >
      <ScrollBox
        ref={scrollRef}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        focusable={false}
      >
        <Box flexDirection="column" width={lineWidth}>
          {meta.flatMap((entry) => wrapTextLines(entry, lineWidth, 2)).map((line, index) => (
            <Box key={`meta-${index}`} height={1}>
              <Text fg={colors.textMuted}>{line}</Text>
            </Box>
          ))}
          {summaryText ? (
            <>
              <Box height={1} />
              <MarkdownText text={summaryText} lineWidth={lineWidth} textColor={colors.text} selectable />
            </>
          ) : null}
          <Box height={1} />
          <MarkdownText text={body} lineWidth={lineWidth} textColor={colors.text} selectable />
        </Box>
      </ScrollBox>
    </Box>
  );
}

export function createCftcBrowserInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
  return {
    instanceId: query ? `${prefix}:${encodeURIComponent(query.toUpperCase()).replace(/%/g, "~")}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query.toUpperCase()}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

export function AdjacentFilingsPane({
  width,
  height,
  focused,
  client,
}: PaneProps & { client: AdjacentClient }) {
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [filings, setFilings] = useState<CftcFiling[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<StackSortPreference<FilingColumnId>>(DEFAULT_FILING_SORT);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [detail, setDetail] = useState<CftcFilingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailCacheRef = useRef<Map<number, CftcFilingDetail>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const tableScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const resetSelectionOnLoadRef = useRef(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const columns = useMemo(() => createFilingColumns(), []);
  const sortedFilings = useMemo(
    () => sortStackItems(filings, sortPreference, compareFilings, (left, right) => left.id - right.id),
    [filings, sortPreference],
  );

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    setLoadingMore(false);
    setHasMore(false);
    setPage(1);
    void loadCftcFilings(client, nextQuery, CFTC_PAGE_SIZE, 1)
      .then((result) => {
        if (abortRef.current !== controller) return;
        setFilings(result.filings);
        setPage(result.meta.page);
        setHasMore(cftcPageHasMore(result.meta, result.filings.length));
        setStatus("loaded");
        setLastUpdated(Date.now());
        if (resetSelectionOnLoadRef.current) {
          resetSelectionOnLoadRef.current = false;
          setSelectedId(null);
          setOpenItemId(null);
        }
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setFilings([]);
        setHasMore(false);
        setStatus("error");
      });
  }, [client]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || status !== "loaded") return;
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    moreAbortRef.current = controller;
    const nextPage = page + 1;
    setLoadingMore(true);
    void loadCftcFilings(client, query, CFTC_PAGE_SIZE, nextPage)
      .then((result) => {
        if (moreAbortRef.current !== controller) return;
        if (result.filings.length === 0) {
          setHasMore(false);
          return;
        }
        setFilings((current) => {
          const seen = new Set(current.map((filing) => filing.id));
          const extra = result.filings.filter((filing) => !seen.has(filing.id));
          return extra.length === 0 ? current : [...current, ...extra];
        });
        setPage(result.meta.page || nextPage);
        setHasMore(cftcPageHasMore(result.meta, result.filings.length));
      })
      .catch((loadError) => {
        if (moreAbortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setHasMore(false);
      })
      .finally(() => {
        if (moreAbortRef.current === controller) setLoadingMore(false);
      });
  }, [client, hasMore, loadingMore, page, query, status]);

  const onFilingsScroll = useTableLoadMore(
    tableScrollRef,
    hasMore && !loadingMore && status === "loaded" && !openItemId,
    loadMore,
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
    moreAbortRef.current?.abort();
  }, []);

  const openFiling = openItemId
    ? filings.find((filing) => filingId(filing) === openItemId) ?? null
    : null;
  const selectedFiling = sortedFilings.find((filing) => filingId(filing) === selectedId)
    ?? sortedFilings[0]
    ?? null;
  const selectedFilingId = selectedFiling ? filingId(selectedFiling) : null;
  const detailFiling = openFiling ?? selectedFiling;
  const detailFilingId = detailFiling?.id;

  useEffect(() => {
    if (detailFilingId == null) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const cached = detailCacheRef.current.get(detailFilingId);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    const timeoutId = setTimeout(() => {
      void client.getFilingDetail(detailFilingId)
        .then((next) => {
          if (cancelled) return;
          if (next) detailCacheRef.current.set(detailFilingId, next);
          setDetail(next);
          setDetailLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setDetail(null);
          setDetailLoading(false);
        });
    }, DETAIL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [client, detailFilingId]);

  const loading = status === "loading" && filings.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), poll.intervalMinutes);

  const { readArticleIds, markArticleRead } = useNewsReadState();
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const copyShareLink = useCopyShareLink();
  const filingSummary = useCftcFilingSummary();
  const markFilingRead = useCallback((filing: CftcFiling) => {
    markArticleRead(filingId(filing));
  }, [markArticleRead]);
  const popOutSelected = useCallback(() => {
    if (!detailFiling) return;
    markFilingRead(detailFiling);
    popOutArticle(cftcFilingToArticle(detailFiling, detail));
  }, [detail, detailFiling, markFilingRead, popOutArticle]);
  const shareSelected = useCallback(() => {
    if (!detailFiling) return;
    void copyShareLink(newsArticleSharePayload(cftcFilingToArticle(detailFiling, detail)));
  }, [copyShareLink, detail, detailFiling]);
  const handleSummarize = useCallback(() => {
    if (!openFiling || detailLoading) return;
    void filingSummary.summarize(openFiling, buildDetailBody(openFiling, detail, false));
  }, [detail, detailLoading, filingSummary, openFiling]);
  const openSummary = openFiling ? filingSummary.summaries.get(openFiling.id) : undefined;

  useEffect(() => {
    if (selectedFilingId !== selectedId) setSelectedId(selectedFilingId);
  }, [selectedFilingId, selectedId]);

  useEffect(() => {
    if (openItemId && !openFiling) setOpenItemId(null);
  }, [openFiling, openItemId]);

  useEffect(() => {
    if (!openItemId) return;
    const scrollBox = detailScrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [openItemId]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    resetSelectionOnLoadRef.current = true;
    setQuery(nextQuery);
    setOpenItemId(null);
  }, [setQuery]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
      }
      return;
    }
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
      return;
    }
    if (isPlainKey(event, "y") && detailFiling) {
      event.stopPropagation?.();
      event.preventDefault?.();
      shareSelected();
    }
  }, { allowEditable: true, enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: "adjacent-cftc",
    focused,
    url: error ? null : detail?.sourceUrl || null,
    source: detailFiling ? feedLabel(detailFiling) : undefined,
    label: "filing",
    loading: loading || loadingMore || filingSummary.summarizingId != null,
    error: error ?? filingSummary.summaryError,
    info: [
      ...(client.isPublic
        ? [{ id: "tier", parts: [{ text: "public, last 90d", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !error && !!detail?.sourceUrl,
    onOpen: () => {
      if (detailFiling) markFilingRead(detailFiling);
    },
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      ...(detailFiling
        ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutSelected }]
        : []),
      ...(detailFiling && !openFiling
        ? [{ id: "share", key: "s", label: "hare", onPress: shareSelected }]
        : []),
      ...(openFiling && !detailLoading
        ? [{ id: "summarize", key: "s", label: "ummarize", onPress: handleSummarize }]
        : []),
    ],
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(query);
      return true;
    }
    return false;
  }, [focusSearch, load, query]);

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "j", "down")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(1);
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(-1);
      return true;
    }
    if (isPlainKey(event, "p") && detailFiling) {
      event.stopPropagation?.();
      event.preventDefault?.();
      popOutSelected();
      return true;
    }
    if (isPlainKey(event, "s") && openFiling && !detailLoading) {
      event.stopPropagation?.();
      event.preventDefault?.();
      handleSummarize();
      return true;
    }
    return false;
  }, [detailFiling, detailLoading, handleSummarize, openFiling, popOutSelected, scrollDetailBy]);

  const rootBefore = (
    <PaneListChrome
      width={width}
      focused={focused && !openItemId}
      search={{
        value: query,
        active: searchFocused,
        focusToken: searchFocusToken,
        inputRef: searchInputRef,
        placeholder: "organization, product, or description",
        debounceMs: SEARCH_DEBOUNCE_MS,
        normalizeValue: trimSearchValue,
        onFocus: focusSearch,
        onBlur: blurSearch,
        onNavigateDown: blurSearch,
        onQueryChange: updateQuery,
      }}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={
            query.trim() ? `Searching CFTC filings for ${query.trim()}...` : "Loading CFTC filings..."
          } />
        </Box>
      </Box>
    );
  }

  if (error && filings.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="CFTC filings unavailable."
            message={error}
            hint="Press r to retry."
          />
        </Box>
      </Box>
    );
  }

  return (
    <DataTableStackView<CftcFiling, FilingColumn>
      focused={focused && !searchFocused}
      detailOpen={!!openFiling}
      onBack={() => setOpenItemId(null)}
      detailContent={openFiling ? (
        <FilingDetail
          filing={openFiling}
          detail={detail}
          loading={detailLoading}
          summaryMarkdown={openSummary ? renderCftcSummary(openSummary) : null}
          summarizing={openFiling != null && filingSummary.summarizingId === openFiling.id}
          width={width}
          scrollRef={detailScrollRef}
        />
      ) : (
        <Box flexGrow={1} />
      )}
      detailTitle={openFiling?.title}
      onDetailKeyDown={handleDetailKeyDown}
      selection={{
        kind: "id",
        selectedId: selectedFilingId,
        getId: filingId,
        onChange: (id) => {
          setSelectedId(id);
        },
      }}
      onActivate={(filing) => {
        markFilingRead(filing);
        setOpenItemId(filingId(filing));
      }}
      onRootKeyDown={handleRootKeyDown}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={sortedFilings}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as FilingColumnId;
        setSortPreference((current) => nextStackSortPreference(
          current,
          next,
          next === "seen" || next === "published" ? "desc" : "asc",
        ));
      }}
      resetScrollKey={query}
      scrollRef={tableScrollRef}
      onBodyScrollActivity={onFilingsScroll}
      getItemKey={filingId}
      getRowRevision={(filing) =>
        `${filingId(filing)}:${filing.title}:${readArticleIds.has(filingId(filing)) ? 1 : 0}:${filingRelativeTimeRevision(filing)}`
      }
      renderCell={(filing, column, _index, rowState) =>
        renderFilingCell(filing, column, rowState.selected, readArticleIds.has(filingId(filing)))
      }
      emptyStateTitle={
        query.trim()
          ? `No CFTC filings match ${query.trim()}.`
          : "No recent CFTC filings."
      }
    />
  );
}
