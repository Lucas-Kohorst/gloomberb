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
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { CfpbComplaintsClient } from "./client";
import {
  CFPB_COMPLAINTS_PLUGIN_ID,
  CFPB_COMPLAINT_DETAIL_URL,
  type CfpbComplaint,
} from "./types";

const EMPTY_ITEMS: CfpbComplaint[] = [];

const SEARCH_DEBOUNCE_MS = 300;
const REFRESH_INTERVAL_MINUTES = 15;
const DEFAULT_LIMIT = 25;

const trimSearchValue = (value: string) => value.trim();

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function buildDetailMeta(complaint: CfpbComplaint): string[] {
  const meta = [
    complaint.subProduct ? `${complaint.product} · ${complaint.subProduct}` : complaint.product,
    complaint.subIssue ? `${complaint.issue} · ${complaint.subIssue}` : complaint.issue,
    `Received: ${formatTime(complaint.dateReceived)}`,
  ];
  if (complaint.state) meta.push(`State: ${complaint.state}`);
  if (complaint.companyResponse) meta.push(`Response: ${complaint.companyResponse}`);
  if (complaint.timely) meta.push(`Timely: ${complaint.timely}`);
  if (complaint.submittedVia) meta.push(`Via: ${complaint.submittedVia}`);
  return meta;
}

function buildDetailBody(complaint: CfpbComplaint): string {
  const lines: string[] = [
    `**Company:** ${complaint.company}`,
    `**Product:** ${complaint.subProduct ? `${complaint.product} · ${complaint.subProduct}` : complaint.product}`,
    `**Issue:** ${complaint.subIssue ? `${complaint.issue} · ${complaint.subIssue}` : complaint.issue}`,
    `**Received:** ${formatTime(complaint.dateReceived)}`,
  ];
  if (complaint.companyResponse) lines.push(`**Company response:** ${complaint.companyResponse}`);
  if (complaint.narrative) lines.push("", complaint.narrative);
  return lines.join("\n");
}

export function complaintDetailUrl(complaint: CfpbComplaint): string {
  return `${CFPB_COMPLAINT_DETAIL_URL}/${encodeURIComponent(complaint.id)}`;
}

function complaintToArticle(complaint: CfpbComplaint): NewsArticle {
  return {
    id: `cfpb:${complaint.id}`,
    title: `#${complaint.id} ${complaint.company}`,
    url: complaintDetailUrl(complaint),
    source: "CFPB",
    publishedAt: complaint.dateReceived,
    summary: complaint.narrative || `${complaint.issue} · ${complaint.company}`,
    topic: "complaint",
    topics: ["complaint", "cfpb"],
    sectors: [],
    categories: ["CFPB", complaint.product],
    tickers: [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "cfpb-complaints",
    body: buildDetailBody(complaint),
  };
}

function toFeedItems(complaints: CfpbComplaint[]): FeedDataTableItem[] {
  return complaints.map((complaint) => ({
    id: complaint.id,
    eyebrow: complaint.product,
    title: `${complaint.issue} · ${complaint.company}`,
    timestamp: complaint.dateReceived,
    timestampKind: "date",
    detailTitle: `#${complaint.id} ${complaint.company}`,
    detailMeta: buildDetailMeta(complaint),
    detailBody: complaint.narrative || "No public narrative was provided for this complaint.",
  }));
}

export function CfpbComplaintsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new CfpbComplaintsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [storedProduct] = usePaneSettingValue("product", "");
  const [storedCompany] = usePaneSettingValue("company", "");
  const productFilter = String(storedProduct ?? "").trim();
  const companyFilter = String(storedCompany ?? "").trim();

  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const loader = useCallback(async () => {
    const page = await client.listComplaints({
      searchTerm: query, product: productFilter, company: companyFilter, size: DEFAULT_LIMIT,
    });
    return page.complaints;
  }, [client, query, productFilter, companyFilter]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const complaints = data ?? EMPTY_ITEMS;

  const selectedComplaint = complaints.find((item) => item.id === selectedId) ?? complaints[0] ?? null;
  const openComplaint = openItemId
    ? complaints.find((complaint) => complaint.id === openItemId) ?? null
    : null;
  const detailComplaint = openComplaint ?? selectedComplaint;

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
    placeholder: "company, issue, or keyword",
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

  const loading = refreshing && complaints.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(complaints), [complaints]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    refresh, poll.intervalMinutes,
  );

  const detailUrl = detailComplaint ? complaintDetailUrl(detailComplaint) : null;
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const popOutSelected = useCallback(() => {
    if (!detailComplaint) return;
    popOutArticle(complaintToArticle(detailComplaint));
  }, [detailComplaint, popOutArticle]);

  usePaneStatusLinkFooter({
    registrationId: CFPB_COMPLAINTS_PLUGIN_ID,
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
      ...(detailComplaint
        ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutSelected }]
        : []),
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

  if (loading || (error && complaints.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="CFPB complaints" onRetry={refresh} />
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
      selectedItemId={selectedComplaint?.id ?? null}
      onSelect={(index) => setSelectedId(complaints[index]?.id ?? null)}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      onPopOut={(item) => {
        const complaint = complaints.find((entry) => entry.id === item.id) ?? detailComplaint;
        if (complaint) popOutArticle(complaintToArticle(complaint));
      }}
      sourceLabel="Product"
      titleLabel="Complaint"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No complaints match ${query.trim()}.`
          : "No recent complaints."
      }
      emptyStateHint="Press / to search…"
    />
  );
}
