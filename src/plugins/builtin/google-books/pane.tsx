import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type {
  PaneProps,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  usePaneListSearch,
  PaneStatusBody,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { GoogleBooksClient } from "./client";
import type { BookVolume } from "./types";

const EMPTY_VOLUMES: BookVolume[] = [];

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_MAX_RESULTS = 20;

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
  return volume.description.trim() || "No description available.";
}

function toFeedItems(volumes: BookVolume[]): FeedDataTableItem[] {
  return volumes.map((volume) => ({
    id: volume.id,
    eyebrow: formatAuthors(volume.authors),
    title: volume.title,
    timestamp: volume.publishedTime,
    timestampKind: "date",
    datePrecision: volume.publishedDate.length === 4 ? "year" : volume.publishedDate.length === 7 ? "month" : "day",
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
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.searchVolumes({ query, maxResults: DEFAULT_MAX_RESULTS, signal });
    return page.volumes;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(query.trim() ? loader : null);
  const volumes = data ?? EMPTY_VOLUMES;

  const selectedVolume = volumes.find((volume) => volume.id === selectedId) ?? volumes[0] ?? null;
  const openVolume = openItemId
    ? volumes.find((volume) => volume.id === openItemId) ?? null
    : null;
  const detailVolume = openVolume ?? selectedVolume;

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company or person, e.g. Tesla or Curie",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { enabled: focused });

  const loading = refreshing && volumes.length === 0;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const items = useMemo(() => toFeedItems(volumes), [volumes]);

  const detailUrl = detailVolume?.infoLink || null;

  usePaneStatusLinkFooter({
    registrationId: "google-books",
    focused: focused && !searchFocused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !!detailUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
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
      if (handleSearchKey(event)) return true;
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh],
  );

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;

  if (loading || (error && volumes.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Books" onRetry={refresh} />
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
      selectedItemId={selectedVolume?.id ?? null}
      onSelect={(index) => setSelectedId(volumes[index]?.id ?? null)}
      openItemId={openItemId}
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
