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
import { ShortCampaignsClient, matchesCampaignSearch } from "./client";
import {
  SHORT_CAMPAIGNS_PLUGIN_ID,
  type ShortCampaign,
} from "./types";

const SEARCH_DEBOUNCE_MS = 80;
const REFRESH_INTERVAL_MINUTES = 30;

const trimSearchValue = (value: string) => value.trim();

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
}

function formatPerformance(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function rowTitle(campaign: ShortCampaign): string {
  const target = campaign.ticker ? `${campaign.target} (${campaign.ticker})` : campaign.target;
  const performance = formatPerformance(campaign.performancePct);
  return performance === "—" ? target : `${target} · ${performance}`;
}

function buildDetailMeta(campaign: ShortCampaign): string[] {
  return [
    `Announced ${formatDate(campaign.date)}`,
    `Seller ${campaign.seller}`,
    `Performance ${formatPerformance(campaign.performancePct)}`,
  ];
}

function toFeedItems(campaigns: ShortCampaign[]): FeedDataTableItem[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    eyebrow: campaign.seller,
    title: rowTitle(campaign),
    timestamp: campaign.date.getTime() === 0 ? null : campaign.date,
    timestampKind: "date",
    detailTitle: campaign.ticker ? `${campaign.target} (${campaign.ticker})` : campaign.target,
    detailMeta: buildDetailMeta(campaign),
    detailBody: campaign.thesis,
    detailNote: campaign.reportUrl,
  }));
}

export function ShortCampaignsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new ShortCampaignsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) => client.listCampaigns({ signal }), [client]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(loader);
  const campaigns = useMemo(() => (data?.campaigns ?? []).filter((campaign) => matchesCampaignSearch(campaign, query)), [data, query]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0] ?? null;
  const openCampaign = openItemId
    ? campaigns.find((campaign) => campaign.id === openItemId) ?? null
    : null;
  const detailCampaign = openCampaign ?? selectedCampaign;

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
    placeholder: "company, ticker, or seller", debounceMs: SEARCH_DEBOUNCE_MS,
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
  const items = useMemo(() => toFeedItems(campaigns), [campaigns]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  const detailUrl = detailCampaign?.reportUrl || null;

  usePaneStatusLinkFooter({
    registrationId: SHORT_CAMPAIGNS_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
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
      <PaneStatusBody loading={loading} error={error} subject="Short campaigns" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedCampaign?.id ?? null}
      onSelect={(index) => setSelectedId(campaigns[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Seller"
      titleLabel="Target"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No campaigns match ${query.trim()}.`
          : "No campaigns listed. Press / to search."
      }
    />
  );
}

export default ShortCampaignsPane;
