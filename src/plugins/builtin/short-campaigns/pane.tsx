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
import { ShortCampaignsClient } from "./client";
import {
  SHORT_CAMPAIGNS_PLUGIN_ID,
  type ShortCampaign,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
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

function buildDetailBody(campaign: ShortCampaign): string {
  const lines: string[] = [
    `**Target:** ${campaign.target}`,
    `**Ticker:** ${campaign.ticker ?? "—"}`,
    `**Seller:** ${campaign.seller}`,
    `**Announced:** ${formatDate(campaign.date)}`,
    `**Performance since report:** ${formatPerformance(campaign.performancePct)}`,
  ];
  return lines.join("\n");
}

function toFeedItems(campaigns: ShortCampaign[]): FeedDataTableItem[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    eyebrow: campaign.seller,
    title: rowTitle(campaign),
    timestamp: campaign.date.getTime() === 0 ? null : campaign.date,
    detailTitle: campaign.ticker ? `${campaign.target} (${campaign.ticker})` : campaign.target,
    detailMeta: buildDetailMeta(campaign),
    detailBody: buildDetailBody(campaign),
    detailNote: campaign.reportUrl,
  }));
}

export function ShortCampaignsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new ShortCampaignsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [campaigns, setCampaigns] = useState<ShortCampaign[]>([]);
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
        .listCampaigns({ searchQuery: nextQuery, signal: controller.signal })
        .then((page) => {
          if (abortRef.current !== controller) return;
          setCampaigns(page.campaigns);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setCampaigns([]);
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
    if (campaigns.length > 0 && selectedIdx >= campaigns.length) {
      setSelectedIdx(Math.max(0, campaigns.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, campaigns.length]);

  const selectedCampaign = campaigns[selectedIdx] ?? null;
  const openCampaign = openItemId
    ? campaigns.find((campaign) => campaign.id === openItemId) ?? null
    : null;
  const detailCampaign = openCampaign ?? selectedCampaign;

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

  const loading = status === "loading" && campaigns.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(campaigns), [campaigns]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  const detailUrl = detailCampaign?.reportUrl || null;

  usePaneStatusLinkFooter({
    registrationId: SHORT_CAMPAIGNS_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailCampaign ? detailCampaign.seller : undefined,
    label: "report",
    loading,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
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
      placeholder="company, ticker, or seller"
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
          <Spinner label="Loading campaigns..." />
        </Box>
      </Box>
    );
  }

  if (error && campaigns.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Short campaigns unavailable." message={error} hint="Press r to retry." />
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
