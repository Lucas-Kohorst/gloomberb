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
    `${page.company} · ${page.jobFamily}`,
    band.titles.length > 1 ? `${band.level} (${band.titles.slice(1).join(", ")})` : band.level,
    `Median total: ${formatComp(band.totalCompensation)}`,
    `Typical experience: ${yoeLabel(band)}`,
    `Samples: ${band.count != null ? band.count : "n/a"}`,
  ];
  if (page.medianBase != null) {
    meta.push(`Role median base: ${formatComp(page.medianBase)}`);
  }
  return meta;
}

function buildDetailBody(page: CompanySalaryPage, band: LevelBand): string {
  const lines: string[] = [
    `**Level:** ${band.level}`,
    `**Titles:** ${band.titles.length > 0 ? band.titles.join(", ") : band.level}`,
    `**Median total comp:** ${formatComp(band.totalCompensation)}`,
    `**Typical experience:** ${yoeLabel(band)}`,
    `**Samples:** ${band.count != null ? band.count : "n/a"}`,
    `**Role median total:** ${formatComp(page.medianTotal)}`,
    `**Role median base:** ${formatComp(page.medianBase)}`,
    ...(page.sampleCount != null ? [`**Page samples:** ${page.sampleCount}`] : []),
    "",
    `Source: ${page.url}`,
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
    detailBody: buildDetailBody(page, band),
  }));
}

export function LevelsFyiPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new LevelsFyiClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || DEFAULT_COMPANY;
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [page, setPage] = useState<CompanySalaryPage | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string) => {
      const company = nextQuery.trim();
      abortRef.current?.abort();
      if (!company) {
        setPage(null);
        setError(null);
        setStatus("loaded");
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      void client
        .fetchCompanySalaries(company)
        .then((nextPage) => {
          if (abortRef.current !== controller) return;
          setPage(nextPage);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setPage(null);
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
    if (page && page.bands.length > 0 && selectedIdx >= page.bands.length) {
      setSelectedIdx(Math.max(0, page.bands.length - 1));
    }
  }, [page, selectedIdx, setSelectedIdx]);

  const bands = page?.bands ?? [];
  const selectedBand = bands[selectedIdx] ?? null;
  const openBand = openItemId ? bands.find((band) => band.level === openItemId) ?? null : null;
  const detailBand = openBand ?? selectedBand;

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

  const loading = status === "loading" && bands.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(page), [page]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    () => load(query),
    REFRESH_INTERVAL_MINUTES,
  );

  const detailUrl = page?.url ?? null;

  usePaneStatusLinkFooter({
    registrationId: LEVELS_FYI_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: page?.company,
    label: "levels.fyi",
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
      placeholder="company, e.g. google or stripe"
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
                ? `Loading ${query.trim()} salary bands...`
                : "Loading salary bands..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && bands.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Salary bands unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Level"
      titleLabel="Median comp"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No salary bands for ${query.trim()}.`
          : "Press / to search for a company."
      }
      emptyStateHint="Press / to search for a company."
    />
  );
}
