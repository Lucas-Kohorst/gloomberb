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
import { LevelsFyiClient, formatComp } from "./client";
import {
  LEVELS_FYI_PLUGIN_ID,
  type CompanySalaryPage,
  type LevelBand,
} from "./types";

const SEARCH_DEBOUNCE_MS = 350;
const REFRESH_INTERVAL_MINUTES = 60;
const DEFAULT_COMPANY = "google";

const trimSearchValue = (value: string) => value.trim();

function yoeLabel(band: LevelBand): string {
  if (band.yoeMin != null && band.yoeMax != null) return `${band.yoeMin}-${band.yoeMax} yoe`;
  if (band.yoeMin != null) return `${band.yoeMin}+ yoe`;
  if (band.yoeMax != null) return `to ${band.yoeMax} yoe`;
  return "yoe n/a";
}

function samplesLabel(band: LevelBand): string {
  return band.count != null ? `n=${band.count}` : "n/a";
}

function bandTitle(band: LevelBand): string {
  return `${formatComp(band.totalCompensation)} total · ${yoeLabel(band)} · ${samplesLabel(band)}`;
}

function buildDetailMeta(page: CompanySalaryPage, band: LevelBand): string[] {
  const meta = [
    page.jobFamily,
    ...band.titles.filter((title) => title !== band.level),
    `Median total: ${formatComp(band.totalCompensation)}`,
    `Typical experience: ${yoeLabel(band)}`,
    `Samples: ${band.count != null ? band.count : "n/a"}`,
  ];
  return meta;
}

function buildDetailBody(page: CompanySalaryPage): string {
  const lines: string[] = [
    `**Role median total:** ${formatComp(page.medianTotal)}`,
    `**Role median base:** ${formatComp(page.medianBase)}`,
    ...(page.sampleCount != null ? [`**Page samples:** ${page.sampleCount}`] : []),
  ];
  return lines.join("\n");
}

function toFeedItems(page: CompanySalaryPage | null): FeedDataTableItem[] {
  if (!page) return [];
  return page.bands.map((band) => ({
    id: band.level,
    eyebrow: band.level,
    title: bandTitle(band),
    detailTitle: `${page.company} ${band.level}`,
    detailMeta: buildDetailMeta(page, band),
    detailBody: buildDetailBody(page),
    detailNote: page.url,
  }));
}

export function LevelsFyiPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new LevelsFyiClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || DEFAULT_COMPANY;
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) => client.fetchCompanySalaries(query, undefined, signal), [client, query]);
  const { data: page, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(query.trim() ? loader : null);
  const bands = page?.bands ?? [];
  const selectedBand = bands.find((band) => band.level === selectedId) ?? bands[0] ?? null;

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
    placeholder: "company, e.g. google or stripe", debounceMs: SEARCH_DEBOUNCE_MS,
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

  const loading = refreshing && !page;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const items = useMemo(() => toFeedItems(page), [page]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  const detailUrl = page?.url ?? null;

  usePaneStatusLinkFooter({
    registrationId: LEVELS_FYI_PLUGIN_ID,
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
  if (loading || (error && !page)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Salary bands" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedBand?.level ?? null}
      onSelect={(index) => setSelectedId(bands[index]?.level ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Level"
      titleLabel="Median comp"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No salary bands for ${query.trim()}.`
          : "Press / to search for a company."
      }
    />
  );
}
