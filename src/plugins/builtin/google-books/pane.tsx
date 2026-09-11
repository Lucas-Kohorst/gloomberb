import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PaneProps,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
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
import { GoogleBooksClient } from "./client";
import type { BookVolume } from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_MAX_RESULTS = 20;
const DESCRIPTION_PREVIEW_CHARS = 1500;

const trimSearchValue = (value: string) => value.trim();

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown";
  if (authors.length === 1) return authors[0]!;
  return `${authors[0]} et al.`;
}

function buildDetailMeta(volume: BookVolume): string[] {
  const meta: string[] = [];
  meta.push(`By ${volume.authors.length > 0 ? volume.authors.join(", ") : "unknown author"}`);
  meta.push(`Published ${volume.publishedDate || "unknown date"}`);
  if (volume.publisher) meta.push(volume.publisher);
  if (volume.pageCount) meta.push(`${volume.pageCount} pages`);
  if (volume.categories.length > 0) meta.push(volume.categories.join(", "));
  return meta;
}

function buildDetailBody(volume: BookVolume): string {
  if (!volume.description) return "No description available.";
  const trimmed = volume.description.trim();
  if (trimmed.length <= DESCRIPTION_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd()}…`;
}

function toFeedItems(volumes: BookVolume[]): FeedDataTableItem[] {
  return volumes.map((volume) => ({
    id: volume.id,
    eyebrow: formatAuthors(volume.authors),
    title: volume.title,
    timestamp: volume.publishedTime,
    detailTitle: volume.title,
    detailMeta: buildDetailMeta(volume),
    detailBody: buildDetailBody(volume),
  }));
}

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

export function createBooksPaneInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

export function BooksPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new GoogleBooksClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [volumes, setVolumes] = useState<BookVolume[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setVolumes([]);
        setStatus("loaded");
        setError(null);
        return;
      }
      setStatus("loading");
      setError(null);
      void client
        .searchVolumes({ query: trimmed, maxResults: DEFAULT_MAX_RESULTS })
        .then((page) => {
          if (abortRef.current !== controller) return;
          setVolumes(page.volumes);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setVolumes([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (volumes.length > 0 && selectedIdx >= volumes.length) {
      setSelectedIdx(Math.max(0, volumes.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, volumes.length]);

  const selectedVolume = volumes[selectedIdx] ?? null;
  const openVolume = openItemId
    ? volumes.find((volume) => volume.id === openItemId) ?? null
    : null;
  const detailVolume = openVolume ?? selectedVolume;

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
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && volumes.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(volumes), [volumes]);

  const detailUrl = detailVolume?.infoLink || null;

  usePaneStatusLinkFooter({
    registrationId: "google-books",
    focused,
    url: error ? null : detailUrl,
    source: detailVolume ? formatAuthors(detailVolume.authors) : undefined,
    label: "book",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
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
      placeholder="company or person, e.g. Tesla or Curie"
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
          <Spinner label={`Searching books for ${query.trim()}...`} />
        </Box>
      </Box>
    );
  }

  if (error && volumes.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Books unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Author"
      titleLabel="Book"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No matches for ${query.trim()}.`
          : "Press / to search."
      }
    />
  );
}
