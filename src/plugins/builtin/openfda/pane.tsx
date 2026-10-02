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
import { OpenFdaClient } from "./client";
import {
  OPENFDA_PLUGIN_ID,
  type OpenFdaDataset,
  type OpenFdaRecord,
} from "./types";

export const OPENFDA_PANE_ID = "adverse-events";

const EMPTY_ITEMS: OpenFdaRecord[] = [];

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
  const meta = [record.flag];
  if (record.company) meta.push(record.company);
  meta.push(formatDate(record.date));
  return meta;
}

function buildDetailBody(record: OpenFdaRecord): string {
  const lines: string[] = [];
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
    timestampKind: "date",
    detailTitle: record.product,
    detailMeta: buildDetailMeta(record),
    detailBody: buildDetailBody(record),
  }));
}

export function OpenFdaPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenFdaClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async () => {
    const page = await client.listRecords({ searchQuery: query, limit: DEFAULT_LIMIT });
    return page.records;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const records = data ?? EMPTY_ITEMS;

  const selectedRecord = records.find((item) => item.id === selectedId) ?? records[0] ?? null;
  const openRecord = openItemId
    ? records.find((record) => record.id === openItemId) ?? null
    : null;
  const detailRecord = openRecord ?? selectedRecord;

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
    placeholder: "drug, firm, or device, e.g. ibuprofen",
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

  const loading = refreshing && records.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(records), [records]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    refresh, poll.intervalMinutes,
  );

  const detailUrl = detailRecord?.url || null;

  usePaneStatusLinkFooter({
    registrationId: OPENFDA_PLUGIN_ID,
    focused,
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

  if (loading || (error && records.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="FDA reports" onRetry={refresh} />
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
      selectedItemId={selectedRecord?.id ?? null}
      onSelect={(index) => setSelectedId(records[index]?.id ?? null)}
      openItemId={openItemId}
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
