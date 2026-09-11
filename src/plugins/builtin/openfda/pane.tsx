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
import { OpenFdaClient } from "./client";
import {
  OPENFDA_PLUGIN_ID,
  type OpenFdaDataset,
  type OpenFdaRecord,
} from "./types";

export const OPENFDA_PANE_ID = "adverse-events";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;
const DEFAULT_LIMIT = 30;

const DATASET_LABEL: Record<OpenFdaDataset, string> = {
  drug: "Drug",
  device: "Device",
  recall: "Recall",
};

const trimSearchValue = (value: string) => value.trim();

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

function buildDetailMeta(record: OpenFdaRecord): string[] {
  const meta = [record.flag, record.product];
  if (record.company) meta.push(record.company);
  meta.push(formatDate(record.date));
  return meta;
}

function buildDetailBody(record: OpenFdaRecord): string {
  const lines: string[] = [
    `**Product:** ${record.product}`,
    `**Date:** ${formatDate(record.date)}`,
    `**Severity:** ${record.flag}`,
  ];
  if (record.company) lines.push(`**Firm:** ${record.company}`);
  for (const entry of record.detail) lines.push(`**Finding:** ${entry}`);
  lines.push(`**Report ID:** ${record.id}`);
  return lines.join("\n");
}

function toFeedItems(records: OpenFdaRecord[]): FeedDataTableItem[] {
  return records.map((record) => ({
    id: record.id,
    eyebrow: DATASET_LABEL[record.dataset],
    title: record.title,
    timestamp: record.date,
    detailTitle: record.title,
    detailMeta: buildDetailMeta(record),
    detailBody: buildDetailBody(record),
  }));
}

export function OpenFdaPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenFdaClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [records, setRecords] = useState<OpenFdaRecord[]>([]);
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
      setStatus("loading");
      setError(null);
      void client
        .listRecords({ searchQuery: nextQuery, limit: DEFAULT_LIMIT })
        .then((page) => {
          if (abortRef.current !== controller) return;
          setRecords(page.records);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setRecords([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(
      () => load(query),
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (records.length > 0 && selectedIdx >= records.length) {
      setSelectedIdx(Math.max(0, records.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, records.length]);

  const selectedRecord = records[selectedIdx] ?? null;
  const openRecord = openItemId
    ? records.find((record) => record.id === openItemId) ?? null
    : null;
  const detailRecord = openRecord ?? selectedRecord;

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

  const loading = status === "loading" && records.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(records), [records]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    () => load(query),
    REFRESH_INTERVAL_MINUTES,
  );

  const detailUrl = detailRecord?.url || null;

  usePaneStatusLinkFooter({
    registrationId: OPENFDA_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailRecord?.company || undefined,
    label: "report",
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
      placeholder="drug, firm, or device, e.g. ibuprofen"
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
                ? `Searching reports for ${query.trim()}...`
                : "Loading reports..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && records.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="FDA reports unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Type"
      titleLabel="Report"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No reports match ${query.trim()}.`
          : "No recent reports."
      }
      emptyStateHint="Press / to search"
    />
  );
}
