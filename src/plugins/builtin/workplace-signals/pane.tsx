import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  PaneListChrome,
  PaneStatusBody,
  usePaneListSearch,
  FeedDataTableStackView,
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
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
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
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.listSignals({ employer: query, sort, limit: SIGNAL_LIST_LIMIT, signal });
    return page.signals;
  }, [client, query, sort]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(query.trim() ? loader : null);
  const signals = data ?? [];
  const selectedSignal = signals.find((signal) => signal.id === selectedId) ?? signals[0] ?? null;
  const openSignal = openItemId
    ? signals.find((signal) => signal.id === openItemId) ?? null
    : null;
  const detailSignal = openSignal ?? selectedSignal;
  const detailUrl = detailSignal ? hnDiscussionUrl(detailSignal) : null;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: "employer name", debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && !data;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const items = useMemo(() => toFeedItems(signals), [signals]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  usePaneStatusLinkFooter({
    registrationId: WORKPLACE_SIGNALS_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
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
  if (loading || (error && !data)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Workplace signals" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedSignal?.id ?? null}
      onSelect={(index) => setSelectedId(signals[index]?.id ?? null)}
      openItemId={openItemId}
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
