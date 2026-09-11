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
import { FoiaLogsClient } from "./client";
import {
  FOIA_LOGS_PLUGIN_ID,
  type FoiaLogEntry,
  type FoiaLogPage,
  type FoiaSignal,
} from "./types";

const SEARCH_DEBOUNCE_MS = 400;
const REFRESH_INTERVAL_MINUTES = 60;

const trimSearchValue = (value: string) => value.trim();

const SIGNAL_TAG: Record<FoiaSignal, string> = {
  high: "B7A",
  medium: "ENF",
  watch: "watch",
};

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

function entryTime(entry: FoiaLogEntry): Date {
  for (const date of [entry.closedDate, entry.dateReceived, entry.dateOfRequest]) {
    if (date.getTime() > 0) return date;
  }
  return entry.dateOfRequest;
}

const SIGNAL_EXPLAIN: Record<FoiaSignal, string> = {
  high: "Withheld under FOIA Exemption 7(A) — the SEC treats the records as relating to an ongoing enforcement proceeding. The classic undisclosed-investigation flag.",
  medium: "Seeks enforcement/investigative records (Wells notice, subpoena, probe) without an explicit 7(A) cite.",
  watch: "Company named in a routine request. Check the disposition — a \"no records\" response is evidence against undisclosed activity.",
};

function buildDetailMeta(entry: FoiaLogEntry): string[] {
  return [
    `Signal ${SIGNAL_TAG[entry.signal]} · ${entry.sourceMonth}${entry.fromB7AFile ? " (B7A file)" : ""}`,
    entry.matchReason || undefined,
    entry.disposition ? `Disposition: ${entry.disposition}` : undefined,
    entry.status ? `Status: ${entry.status}` : undefined,
    entry.requesterOrganization || entry.requesterName
      ? `Requested by ${entry.requesterOrganization || entry.requesterName}`
      : undefined,
    `Received ${formatTime(entry.dateReceived)} · Closed ${formatTime(entry.closedDate)}`,
  ].filter((value): value is string => !!value);
}

function buildDetailBody(entry: FoiaLogEntry): string {
  const lines = [
    `**${SIGNAL_EXPLAIN[entry.signal]}**`,
    "",
    "Request description:",
    entry.description || "No description published.",
  ];
  if (entry.disposition) {
    lines.push("", `**Final disposition:** ${entry.disposition}`);
  }
  lines.push(
    "",
    "A 7(A) withholding is a signal, not a finding — read the request description before drawing conclusions.",
  );
  return lines.join("\n");
}

function toFeedItems(entries: FoiaLogEntry[]): FeedDataTableItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    eyebrow: SIGNAL_TAG[entry.signal],
    title: entry.description
      ? entry.description.replace(/\s+/g, " ").trim()
      : `FOIA request ${entry.requestId}`,
    timestamp: entryTime(entry),
    detailTitle: `FOIA request ${entry.requestId}`,
    detailMeta: buildDetailMeta(entry),
    detailBody: buildDetailBody(entry),
  }));
}

export function FoiaLogsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new FoiaLogsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [entries, setEntries] = useState<FoiaLogEntry[]>([]);
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
      if (!nextQuery.trim()) {
        setEntries([]);
        setStatus("loaded");
        setError(null);
        return;
      }
      setStatus("loading");
      setError(null);
      void client
        .searchLogs(nextQuery, { signal: controller.signal })
        .then((page: FoiaLogPage) => {
          if (abortRef.current !== controller) return;
          setEntries(page.entries);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setEntries([]);
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
    if (entries.length > 0 && selectedIdx >= entries.length) {
      setSelectedIdx(Math.max(0, entries.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, entries.length]);

  const selectedEntry = entries[selectedIdx] ?? null;
  const openEntry = openItemId
    ? entries.find((entry) => entry.id === openItemId) ?? null
    : null;
  const detailEntry = openEntry ?? selectedEntry;

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
    load(query);
  }, [load, query]);

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

  const loading = status === "loading" && entries.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(entries), [entries]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: FOIA_LOGS_PLUGIN_ID,
    focused,
    url: error ? null : detailEntry?.url ?? null,
    source: detailEntry ? `source CSV · ${detailEntry.sourceMonth}` : undefined,
    label: "source",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailEntry?.url,
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
      placeholder="company or ticker"
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
                ? `Searching FOIA logs for ${query.trim()}...`
                : "Loading FOIA logs..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && entries.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="FOIA logs unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Signal"
      titleLabel="Request"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No FOIA requests match ${query.trim()}.`
          : "No FOIA requests loaded."
      }
      emptyStateHint={query.trim() ? undefined : "Press / to search a company or ticker…"}
    />
  );
}
