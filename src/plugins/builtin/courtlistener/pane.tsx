import { Box, type ScrollBoxRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  usePaneListSearch,
  PaneStatusBody,
  useTableLoadMore,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { CourtListenerClient } from "./client";
import {
  COURTLISTENER_PLUGIN_ID,
  type Lawsuit,
} from "./types";

const trimSearchValue = (value: string) => value.trim();

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;

function formatFiled(date: Date): string {
  return date.getTime() === 0 ? "—" : date.toISOString().slice(0, 10);
}

function toFeedItems(lawsuits: Lawsuit[]): FeedDataTableItem[] {
  return lawsuits.map((lawsuit) => ({
    id: lawsuit.id,
    eyebrow: lawsuit.courtCitation || lawsuit.court || "Court",
    title: lawsuit.caseName,
    timestamp: lawsuit.dateFiled.getTime() === 0 ? null : lawsuit.dateFiled,
    timestampKind: "date",
    detailTitle: lawsuit.caseName,
    detailMeta: [
      lawsuit.court || "Unknown court",
      `Filed ${formatFiled(lawsuit.dateFiled)}`,
      lawsuit.docketNumber ? `Docket ${lawsuit.docketNumber}` : "Docket —",
      ...(lawsuit.judge ? [`Judge ${lawsuit.judge}`] : []),
      ...(lawsuit.status ? [lawsuit.status] : []),
      lawsuit.kind === "docket" ? "PACER docket" : `Cited ${lawsuit.citeCount} time${lawsuit.citeCount === 1 ? "" : "s"}`,
    ],
    detailBody: lawsuit.snippet || "No excerpt available.",
    detailNote: lawsuit.downloadUrl || null,
  }));
}

export function CourtListenerPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new CourtListenerClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);

  const [lawsuits, setLawsuits] = useState<Lawsuit[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const tableScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const requestQueryRef = useRef(query);
  const abortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (value: string) => {
      abortRef.current?.abort();
      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      if (requestQueryRef.current !== value) {
        requestQueryRef.current = value;
        setLawsuits([]);
        setLastUpdated(null);
      }
      setStatus("loading");
      setError(null);
      setLoadMoreError(null);
      setNextUrl(null);
      setLoadingMore(false);
      void client
        .searchLawsuits(value, { signal: controller.signal })
        .then((page) => {
          if (abortRef.current !== controller || controller.signal.aborted) return;
          setLawsuits(page.lawsuits);
          setNextUrl(page.next);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller || controller.signal.aborted) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setNextUrl(null);
          setStatus("error");
        });
    },
    [client],
  );

  const loadMore = useCallback(() => {
    if (moreAbortRef.current || loadingMore || !nextUrl || status !== "loaded") return;
    const controller = new AbortController();
    moreAbortRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    void client.searchLawsuitsPage(nextUrl, { signal: controller.signal })
      .then((page) => {
        if (moreAbortRef.current !== controller) return;
        setLawsuits((current) => {
          const seen = new Set(current.map((lawsuit) => lawsuit.id));
          const extra = page.lawsuits.filter((lawsuit) => {
            if (seen.has(lawsuit.id)) return false;
            seen.add(lawsuit.id);
            return true;
          });
          return extra.length === 0 ? current : [...current, ...extra];
        });
        setNextUrl(page.next);
      })
      .catch((loadError) => {
        if (moreAbortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setLoadMoreError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (moreAbortRef.current === controller) {
          moreAbortRef.current = null;
          setLoadingMore(false);
        }
      });
  }, [client, loadingMore, nextUrl, status]);

  const onBodyScrollActivity = useTableLoadMore(
    tableScrollRef,
    !!nextUrl && !loadingMore && !loadMoreError && status === "loaded" && !openItemId,
    loadMore,
  );

  useEffect(() => {
    load(query);
  }, [load, query]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
    },
    [],
  );

  const selected = lawsuits.find((item) => item.id === selectedId) ?? lawsuits[0] ?? null;
  const openLawsuit = openItemId
    ? lawsuits.find((lawsuit) => lawsuit.id === openItemId) ?? null
    : null;
  const activeLawsuit = openLawsuit ?? selected;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery.trim());
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company or case, e.g. Kalshi",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut(
    (event) => {
      if (!focused || openItemId || searchFocused || event.targetEditable) return;
      if (isPlainKey(event, "r")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        load(query);
      }
    },
    { enabled: focused },
  );

  const loading = status === "loading";
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(lawsuits), [lawsuits]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    () => load(query), poll.intervalMinutes,
  );

  usePaneStatusLinkFooter({
    registrationId: COURTLISTENER_PLUGIN_ID,
    focused,
    url: activeLawsuit?.url || activeLawsuit?.downloadUrl || null,
    loading: loading || loadingMore,
    error,
    info: [
      ...(loadMoreError && !openItemId ? [{ id: "load-more-error", parts: [{ text: `More results: ${loadMoreError}`, tone: "warning" as const }] }] : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!(activeLawsuit?.url || activeLawsuit?.downloadUrl),
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
      ...(loadMoreError && !openItemId ? [{ id: "retry-page", key: "t", label: "try again", onPress: loadMore }] : []),
    ],
  });

  const handleRootKeyDown = useCallback(
    (
      event: {
        name?: string;
        preventDefault?: () => void;
        stopPropagation?: () => void;
      },
      context: { selectedIndex: number; itemCount: number },
    ) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (handleSearchKey(event)) return true;
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        load(query);
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, load, query],
  );

  const rootBefore = (
    <PaneListChrome width={width} focused={focused && !openItemId} search={search} />
  );

  if ((loading || error) && lawsuits.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Lawsuits" onRetry={() => load(query)} />
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selected?.id ?? null}
      onSelect={(index) => setSelectedId(lawsuits[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Court"
      titleLabel="Case"
      emptyStateTitle={
        query.trim() ? `No dockets match ${query.trim()}.` : "No recent federal dockets."
      }
      emptyStateHint="Press / to search"
      scrollRef={tableScrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
