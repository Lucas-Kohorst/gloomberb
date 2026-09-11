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
import { CourtListenerClient } from "./client";
import {
  COURTLISTENER_PLUGIN_ID,
  type Lawsuit,
} from "./types";

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
    detailTitle: lawsuit.caseName,
    detailMeta: [
      lawsuit.court || "Unknown court",
      `Filed ${formatFiled(lawsuit.dateFiled)}`,
      lawsuit.docketNumber ? `Docket ${lawsuit.docketNumber}` : "Docket —",
      ...(lawsuit.judge ? [`Judge ${lawsuit.judge}`] : []),
      ...(lawsuit.status ? [lawsuit.status] : []),
      `Cited ${lawsuit.citeCount} time${lawsuit.citeCount === 1 ? "" : "s"}`,
    ],
    detailBody: [
      `Court: ${lawsuit.court || "—"}`,
      `Filed: ${formatFiled(lawsuit.dateFiled)}`,
      `Docket: ${lawsuit.docketNumber || "—"}`,
      `Judge: ${lawsuit.judge || "—"}`,
      `Status: ${lawsuit.status || "—"}`,
      "",
      "Excerpt:",
      lawsuit.snippet || "No excerpt available.",
      ...(lawsuit.downloadUrl ? ["", lawsuit.downloadUrl] : []),
    ].join("\n"),
  }));
}

export function CourtListenerPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new CourtListenerClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [lawsuits, setLawsuits] = useState<Lawsuit[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (value: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      if (!value.trim()) {
        setLawsuits([]);
        setStatus("loaded");
        return;
      }
      void client
        .searchLawsuits(value)
        .then((page) => {
          if (abortRef.current !== controller) return;
          setLawsuits(page.lawsuits);
          setSelectedIdx(0);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLawsuits([]);
          setStatus("error");
        });
    },
    [client, setSelectedIdx],
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const selected = lawsuits[selectedIdx] ?? null;
  const openLawsuit = openItemId
    ? lawsuits.find((lawsuit) => lawsuit.id === openItemId) ?? null
    : null;
  const activeLawsuit = openLawsuit ?? selected;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery.trim());
      setSelectedIdx(0);
      setOpenItemId(null);
    },
    [setQuery, setSelectedIdx],
  );

  useShortcut(
    (event) => {
      if (!focused || openItemId || searchFocused || event.targetEditable) return;
      if (isPlainKey(event, "/")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        focusSearch();
      }
      if (isPlainKey(event, "r")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        load(query);
      }
    },
    { enabled: focused },
  );

  const loading = status === "loading";
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(lawsuits), [lawsuits]);
  useAutoRefresh(
    status === "loaded" && query.trim() ? lastUpdated : null,
    () => load(query),
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: COURTLISTENER_PLUGIN_ID,
    focused,
    url: activeLawsuit?.url || activeLawsuit?.downloadUrl || null,
    source: activeLawsuit?.courtCitation || activeLawsuit?.court,
    label: "opinion",
    loading,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !!activeLawsuit?.url,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
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
    },
    [focusSearch, load, query],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="company, e.g. Apple or Tesla"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={(value) => value.trim()}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (loading && lawsuits.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner
            label={
              query.trim()
                ? `Searching lawsuits involving ${query.trim()}...`
                : "Loading lawsuits..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && lawsuits.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Lawsuits unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Court"
      titleLabel="Case"
      emptyStateTitle={
        query.trim() ? `No lawsuits match ${query.trim()}.` : "Search lawsuits by company."
      }
      emptyStateHint="Press / to search"
    />
  );
}
