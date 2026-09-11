import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  EmptyState,
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
import { EiaEnergyClient, formatEiaValue, type EiaDataPoint, type EiaSeriesSummary } from "./client";
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

function formatPeriod(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function toFeedItems(def: EiaSeriesDef, points: EiaDataPoint[]): FeedDataTableItem[] {
  return points.map((point, index) => ({
    id: `${def.id}:${point.period}`,
    eyebrow: def.short,
    title: index === 0 ? `${formatEiaValue(def, point.value)} — latest` : formatEiaValue(def, point.value),
    timestamp: point.date,
    detailTitle: `${def.label} — ${point.period}`,
    detailMeta: [
      formatEiaValue(def, point.value),
      `Week of ${point.period}`,
      `${def.frequency} · ${def.facetSeries}`,
    ],
    detailBody: [
      `**Value:** ${formatEiaValue(def, point.value)}`,
      `**Week:** ${point.period}`,
      `**Series:** ${def.facetSeries}`,
      `**Frequency:** ${def.frequency}`,
      "",
      def.description,
    ].join("\n"),
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
  const [apiKeySetting] = usePaneSettingValue<string>("apiKey", EIA_DEMO_KEY);
  const seriesId = resolveEiaSeriesId(seriesIdSetting);
  const apiKey = (typeof apiKeySetting === "string" && apiKeySetting.trim()) || EIA_DEMO_KEY;

  const client = useMemo(() => new EiaEnergyClient(apiKey), [apiKey]);
  const def: EiaSeriesDef = findEiaSeries(seriesId) ?? findEiaSeries(DEFAULT_EIA_SERIES_ID)!;

  const [query, setQuery] = usePluginPaneState("query", "");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [summary, setSummary] = useState<EiaSeriesSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextSeriesId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void client
      .listSeriesPoints(nextSeriesId, HISTORY_LENGTH, controller.signal)
      .then((next: EiaSeriesSummary) => {
        if (abortRef.current !== controller) return;
        setSummary(next);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setSummary(null);
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    setSelectedIdx(0);
    setOpenItemId(null);
    load(seriesId);
  }, [load, seriesId]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

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

  useEffect(() => {
    if (points.length > 0 && selectedIdx >= points.length) {
      setSelectedIdx(Math.max(0, points.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, points.length]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [setQuery, setSelectedIdx]);

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
      load(seriesId);
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && points.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(def, points), [def, points]);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(seriesId));

  const selectedPoint = points[selectedIdx] ?? null;
  const openPoint = openItemId
    ? points.find((point) => `${def.id}:${point.period}` === openItemId) ?? null
    : null;
  const detailPoint = openPoint ?? selectedPoint;

  usePaneStatusLinkFooter({
    registrationId: EIA_ENERGY_PLUGIN_ID,
    focused,
    url: error ? null : def.browserUrl,
    source: def.short,
    label: "series",
    loading,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(seriesId) },
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
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(seriesId);
      return true;
    }
    return false;
  }, [focusSearch, load, seriesId]);

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder={`filter ${def.label.toLowerCase()} by week or value`}
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
          <Spinner label={`Loading ${def.label.toLowerCase()}...`} />
        </Box>
      </Box>
    );
  }

  if (error && points.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Energy data unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Series"
      titleLabel={detailPoint ? `Value, week of ${formatPeriod(detailPoint.date)}` : "Value"}
      markdown
      emptyStateTitle={query.trim() ? `No weeks match ${query.trim()}.` : "No data points yet."}
      emptyStateHint="Press / to search"
    />
  );
}
