import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  EmptyState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
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
import { hnDiscussionUrl, WorkplaceSignalsClient } from "./client";
import {
  WORKPLACE_SIGNALS_PLUGIN_ID,
  WORKPLACE_THEMES,
  type WorkplaceSignal,
  type WorkplaceSort,
} from "./types";

const SEARCH_DEBOUNCE_MS = 400;
const REFRESH_INTERVAL_MINUTES = 30;
const SIGNAL_LIST_LIMIT = 40;

const trimSearchValue = (value: string) => value.trim();

function themeLabel(id: string): string {
  return WORKPLACE_THEMES.find((theme) => theme.id === id)?.label ?? "General";
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

function sentimentWord(sentiment: number): string {
  if (sentiment > 0) return "positive";
  if (sentiment < 0) return "negative";
  return "mixed";
}

function buildDetailMeta(signal: WorkplaceSignal): string[] {
  return [
    signal.themes.map(themeLabel).join(" · "),
    `${signal.points} points · ${signal.commentCount} comments · ${sentimentWord(signal.sentiment)}`,
    `Posted ${formatTime(signal.createdAt)} by ${signal.author || "unknown"}`,
  ];
}

function buildDetailBody(signal: WorkplaceSignal): string {
  if (signal.text) return signal.text;
  return "Discussion-only post — open the HN thread for the comment-level signals.";
}

function toFeedItems(signals: WorkplaceSignal[]): FeedDataTableItem[] {
  return signals.map((signal) => ({
    id: signal.id,
    eyebrow: themeLabel(signal.themes[0] ?? "culture"),
    title: signal.title,
    timestamp: signal.createdAt,
    detailTitle: signal.title,
    detailMeta: buildDetailMeta(signal),
    detailBody: buildDetailBody(signal),
  }));
}

export function WorkplaceSignalsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new WorkplaceSignalsClient(), []);

  const [storedQuery] = usePaneSettingValue("employer", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("employer", initialQuery);
  const [storedSort] = usePaneSettingValue("sort", "top");
  const sort: WorkplaceSort = storedSort === "recent" ? "recent" : "top";
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [signals, setSignals] = useState<WorkplaceSignal[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string, nextSort: WorkplaceSort) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (!nextQuery.trim()) {
        setSignals([]);
        setStatus("loaded");
        setError(null);
        return;
      }
      setStatus("loading");
      setError(null);
      void client
        .listSignals({ employer: nextQuery, sort: nextSort, limit: SIGNAL_LIST_LIMIT, signal: controller.signal })
        .then((page) => {
          if (abortRef.current !== controller) return;
          setSignals(page.signals);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setSignals([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query, sort);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query, sort]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (signals.length > 0 && selectedIdx >= signals.length) {
      setSelectedIdx(Math.max(0, signals.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, signals.length]);

  const selectedSignal = signals[selectedIdx] ?? null;
  const openSignal = openItemId
    ? signals.find((signal) => signal.id === openItemId) ?? null
    : null;
  const detailSignal = openSignal ?? selectedSignal;
  const detailUrl = detailSignal ? hnDiscussionUrl(detailSignal) : null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedIdx(0);
      setOpenItemId(null);
    },
    [setQuery, setSelectedIdx],
  );
  const refresh = useCallback(() => {
    load(query, sort);
  }, [load, query, sort]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
        updateQuery("");
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
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && signals.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(signals), [signals]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: WORKPLACE_SIGNALS_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailSignal ? "HN discussion" : undefined,
    label: "thread",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
    ],
  });

  const handleRootKeyDown = useCallback(
    (event: {
      name?: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }, context: { selectedIndex: number; itemCount: number }) => {
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
        refresh();
        return true;
      }
      return false;
    },
    [focusSearch, refresh],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="employer name"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={trimSearchValue}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner
            label={
              query.trim()
                ? `Searching HN for ${query.trim()}...`
                : "Search an employer to load signals."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && signals.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Workplace signals unavailable." message={error} hint="Press r to retry." />
        </Box>
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
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Theme"
      titleLabel="Story"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No HN stories match ${query.trim()}.`
          : "No stories loaded."
      }
      emptyStateHint={query.trim() ? undefined : "Press / to search an employer…"}
    />
  );
}
