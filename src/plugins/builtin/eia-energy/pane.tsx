import { Box } from "../../../ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  PaneStatusBody,
  usePaneListSearch,
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
import { EiaEnergyClient, formatEiaValue, resolveEiaApiKey, type EiaDataPoint } from "./client";
import {
  DEFAULT_EIA_SERIES_ID,
  EIA_DEMO_KEY,
  EIA_ENERGY_PLUGIN_ID,
  EIA_SERIES,
  findEiaSeries,
  resolveEiaSeriesId,
  type EiaSeriesDef,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const HISTORY_LENGTH = 52;

const trimSearchValue = (value: string) => value.trim();

function toFeedItems(def: EiaSeriesDef, points: EiaDataPoint[], latestPeriod?: string): FeedDataTableItem[] {
  return points.map((point) => ({
    id: `${def.id}:${point.period}`,
    eyebrow: def.short,
    title: point.period === latestPeriod ? `${formatEiaValue(def, point.value)} — latest` : formatEiaValue(def, point.value),
    timestamp: point.date,
    timestampKind: "date",
    detailTitle: `${def.label} — ${point.period}`,
    detailMeta: [
      formatEiaValue(def, point.value),
      `${def.frequency} · ${def.facetSeries}`,
    ],
    detailBody: def.description,
  }));
}

export function buildEiaEnergySettingsDef() {
  return {
    title: "Energy Settings",
    fields: [
      {
        key: "seriesId",
        label: "Series",
        type: "select" as const,
        options: EIA_SERIES.map((entry) => ({
          value: entry.id,
          label: `${entry.label} (${entry.group})`,
        })),
      },
      {
        key: "apiKey",
        label: "EIA API key",
        type: "text" as const,
        placeholder: EIA_DEMO_KEY,
        description: "Free key at eia.gov/opendata. DEMO_KEY works out of the box with strict limits.",
      },
    ],
  };
}

export function EnergyPane({ width, height, focused }: PaneProps) {
  const [seriesIdSetting] = usePaneSettingValue<string>("seriesId", DEFAULT_EIA_SERIES_ID);
  const [apiKeySetting] = usePaneSettingValue<string>("apiKey", "");
  const seriesId = resolveEiaSeriesId(seriesIdSetting);
  const apiKey = (typeof apiKeySetting === "string" && apiKeySetting.trim())
    || resolveEiaApiKey();

  const client = useMemo(() => new EiaEnergyClient(apiKey), [apiKey]);
  const def: EiaSeriesDef = findEiaSeries(seriesId) ?? findEiaSeries(DEFAULT_EIA_SERIES_ID)!;

  const [query, setQuery] = usePluginPaneState("query", "");
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) =>
    client.listSeriesPoints(seriesId, HISTORY_LENGTH, signal), [client, seriesId]);
  const { data: summary, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(loader);

  useEffect(() => {
    setSelectedId(null);
    setOpenItemId(null);
  }, [seriesId, setSelectedId]);

  const points = useMemo(() => {
    const all = summary?.points ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return all;
    return all.filter((point) => (
      point.period.toLowerCase().includes(normalized)
      || String(point.value).includes(normalized)
      || formatEiaValue(def, point.value).toLowerCase().includes(normalized)
    ));
  }, [summary, query, def]);

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: `filter ${def.label.toLowerCase()} by week or value`,
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

  const loading = refreshing && !summary;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const items = useMemo(() => toFeedItems(def, points, summary?.points[0]?.period), [def, points, summary]);
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes" });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  usePaneStatusLinkFooter({
    registrationId: EIA_ENERGY_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: def.browserUrl,
    loading: refreshing,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: true,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
    ],
  });

  const handleRootKeyDown = useCallback((event: {
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
  }, [focusSearch, handleSearchKey, refresh]);

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;

  if (loading || (error && !summary)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Energy" onRetry={refresh} />
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
      selectedItemId={selectedItem?.id ?? null}
      onSelect={(index) => setSelectedId(items[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Series"
      titleLabel="Value"
      markdown
      emptyStateTitle={query.trim() ? `No weeks match ${query.trim()}.` : "No data points yet."}
    />
  );
}
