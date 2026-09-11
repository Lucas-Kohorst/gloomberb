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
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { CfpbComplaintsClient } from "./client";
import {
  CFPB_COMPLAINTS_PLUGIN_ID,
  CFPB_COMPLAINT_DETAIL_URL,
  type CfpbComplaint,
  type CfpbComplaintPage,
} from "./types";

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
    complaint.company,
    complaint.subProduct ? `${complaint.product} · ${complaint.subProduct}` : complaint.product,
    complaint.subIssue ? `${complaint.issue} · ${complaint.subIssue}` : complaint.issue,
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
    detailTitle: `#${complaint.id} ${complaint.company}`,
    detailMeta: buildDetailMeta(complaint),
    detailBody: buildDetailBody(complaint),
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [complaints, setComplaints] = useState<CfpbComplaint[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string, nextProduct: string, nextCompany: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      void client
        .listComplaints({
          searchTerm: nextQuery,
          product: nextProduct,
          company: nextCompany,
          size: DEFAULT_LIMIT,
        })
        .then((page: CfpbComplaintPage) => {
          if (abortRef.current !== controller) return;
          setComplaints(page.complaints);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setComplaints([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query, productFilter, companyFilter);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query, productFilter, companyFilter]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (complaints.length > 0 && selectedIdx >= complaints.length) {
      setSelectedIdx(Math.max(0, complaints.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, complaints.length]);

  const selectedComplaint = complaints[selectedIdx] ?? null;
  const openComplaint = openItemId
    ? complaints.find((complaint) => complaint.id === openItemId) ?? null
    : null;
  const detailComplaint = openComplaint ?? selectedComplaint;

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
    load(query, productFilter, companyFilter);
  }, [load, query, productFilter, companyFilter]);

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

  const loading = status === "loading" && complaints.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(complaints), [complaints]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
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
    url: error ? null : detailUrl,
    source: undefined,
    label: "complaint",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      ...(detailComplaint && !error
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
      placeholder="company, issue, or keyword"
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
                ? `Searching complaints for ${query.trim()}...`
                : "Loading complaints..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && complaints.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="Complaints unavailable."
            message={error}
            hint="Press r to retry."
          />
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
