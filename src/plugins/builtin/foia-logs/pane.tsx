import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
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
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { FoiaLogsClient } from "./client";
import {
  FOIA_LOGS_PLUGIN_ID,
  type FoiaLogEntry,
  type FoiaSignal,
} from "./types";

const EMPTY_ITEMS: FoiaLogEntry[] = [];

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

function entryTime(entry: FoiaLogEntry): Date | null {
  for (const date of [entry.closedDate, entry.dateReceived, entry.dateOfRequest]) {
    if (date.getTime() > 0) return date;
  }
  return null;
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
    timestampKind: "date",
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
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.searchLogs(query, { signal });
    return page.entries;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(query.trim() ? loader : null);
  const entries = data ?? EMPTY_ITEMS;

  const selectedEntry = entries.find((item) => item.id === selectedId) ?? entries[0] ?? null;
  const openEntry = openItemId
    ? entries.find((entry) => entry.id === openItemId) ?? null
    : null;
  const detailEntry = openEntry ?? selectedEntry;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company or ticker",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || openItemId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && entries.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(entries), [entries]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    refresh, poll.intervalMinutes,
  );

  usePaneStatusLinkFooter({
    registrationId: FOIA_LOGS_PLUGIN_ID,
    focused,
    url: detailEntry?.url ?? null,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!detailEntry?.url,
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
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh],
  );

  const rootBefore = (
    <PaneListChrome width={width} focused={focused && !openItemId} search={search} />
  );

  if (loading || (error && entries.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="FOIA logs" onRetry={refresh} />
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
      selectedItemId={selectedEntry?.id ?? null}
      onSelect={(index) => setSelectedId(entries[index]?.id ?? null)}
      openItemId={openItemId}
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
