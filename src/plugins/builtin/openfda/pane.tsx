import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FeedDataTableStackView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusLinkFooter,
  useQueryBarSearch,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type FeedDataTableItem,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import {
  useAsyncResource,
  useAutoRefresh,
  useDebouncedPluginPaneState,
  usePaneSettingValue,
  usePluginPaneState,
  useUpdatedAgo,
} from "../../../public/react";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { OpenFdaClient } from "./client";
import { OPENFDA_PANE_ID, type OpenFdaDataset, type OpenFdaRecord } from "./types";

const EMPTY_ITEMS: OpenFdaRecord[] = [];
const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_LIMIT = 30;

const DATASET_LABEL: Record<OpenFdaDataset, string> = {
  drug: "Drug",
  device: "Device",
  recall: "Recall",
};

const formatDate = (date: Date): string => {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
};

const buildDetailMeta = (record: OpenFdaRecord): string[] => {
  const meta = [record.flag];
  if (record.company) meta.push(record.company);
  meta.push(formatDate(record.date));
  return meta;
};

const buildDetailBody = (record: OpenFdaRecord): string => {
  const lines = record.detail.map((entry) => `Finding: ${entry}`);
  lines.push(`Report ID: ${record.id}`);
  return lines.join("\n");
};

const toFeedItems = (records: OpenFdaRecord[]): FeedDataTableItem[] =>
  records.map((record) => ({
    id: record.id,
    eyebrow: DATASET_LABEL[record.dataset],
    title: record.title,
    timestamp: record.date.getTime() === 0 ? null : record.date,
    detailTitle: record.product,
    detailMeta: buildDetailMeta(record),
    detailBody: buildDetailBody(record),
  }));

export const OpenFdaPane = ({ width, height, focused }: PaneProps) => {
  const client = useMemo(() => new OpenFdaClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const { active: searchFocused, focus: focusSearch, searchProps } = useQueryBarSearch();

  const loader = useCallback(async () => {
    const page = await client.listRecords({ searchQuery: query, limit: DEFAULT_LIMIT });
    return page.records;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const records = data ?? EMPTY_ITEMS;

  const selected = records.find((item) => item.id === selectedId) ?? records[0] ?? null;
  const selectedIdx = selected ? records.indexOf(selected) : 0;
  const openRecord = openItemId ? records.find((record) => record.id === openItemId) ?? null : null;
  const detailRecord = openRecord ?? selected;
  useEffect(() => {
    if (openItemId && data && !openRecord) setOpenItemId(null);
  }, [data, openItemId, openRecord]);

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);

  const loading = refreshing && records.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(records), [records]);
  useAutoRefresh(lastUpdated, refresh);
  usePaneRefreshKey(() => void refresh(), { focused, enabled: !searchFocused && !openItemId });

  const detailUrl = detailRecord?.url || null;
  const info = useMemo<PaneFooterSegment[]>(
    () => (updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : []),
    [updatedAgo],
  );
  const hints = useMemo<PaneHint[]>(
    () => (openItemId ? [] : [{ id: "search", key: "/", label: "search", onPress: focusSearch }]),
    [focusSearch, openItemId],
  );
  usePaneStatusLinkFooter({
    registrationId: OPENFDA_PANE_ID,
    focused,
    url: detailUrl,
    loading: refreshing,
    error,
    info,
    hints,
    showOpenHint: !!detailUrl,
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const searchBar = (
    <QueryBar
      width={width}
      search={{
        value: query,
        onChange: updateQuery,
        placeholder: "drug, firm, or device",
        focused: focused && !openItemId,
        debounceMs: SEARCH_DEBOUNCE_MS,
        normalizeValue: (value) => value.trim(),
        ...searchProps,
      }}
    />
  );

  if (loading || (error && records.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <PaneStatusBody loading={loading} error={error} subject="FDA reports" />
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={searchBar}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={(index) => setSelectedId(records[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Type"
      titleLabel="Report"
      emptyStateTitle={query.trim() ? `No reports match ${query.trim()}.` : "No recent reports."}
      emptyStateHint="Press / to search…"
    />
  );
};
