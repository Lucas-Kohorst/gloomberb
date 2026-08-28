import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PaneProps,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import type { NewsArticle } from "../../../news/types";
import {
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { colors } from "../../../theme/colors";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import type { AdjacentClient } from "./client";
import { loadCftcFilings } from "./client";
import {
  buildDetailBody,
  buildDetailMeta,
  feedLabel,
  filingListTimestamp,
  filingListTitle,
  stripLeadingHeading,
} from "./filings-format";
import {
  type CftcFiling,
  type CftcFilingDetail,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const DETAIL_DEBOUNCE_MS = 300;
const CFTC_PAGE_SIZE = 100;

const trimSearchValue = (value: string) => value.trim();

function cftcFilingToArticle(filing: CftcFiling, detail: CftcFilingDetail | null): NewsArticle {
  const label = feedLabel(filing);
  return {
    id: `cftc:${filing.id}`,
    title: filing.title,
    url: detail?.sourceUrl ?? "",
    source: "CFTC",
    publishedAt: filingListTimestamp(filing),
    summary: [filing.orgCode, filing.status, label].filter(Boolean).join(" · "),
    topic: "filing",
    topics: ["filing", "cftc", filing.feed],
    sectors: [],
    categories: ["CFTC", label],
    tickers: [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "cftc",
    body: detail ? stripLeadingHeading(detail.markdown) || undefined : undefined,
  };
}

function toFeedItems(
  filings: CftcFiling[],
  openFilingId: number | undefined,
  detail: CftcFilingDetail | null,
  detailLoading: boolean,
): FeedDataTableItem[] {
  return filings.map((filing) => {
    const selected = filing.id === openFilingId;
    return {
      id: String(filing.id),
      eyebrow: filing.orgCode || feedLabel(filing),
      title: filingListTitle(filing),
      timestamp: filingListTimestamp(filing),
      detailTitle: filing.title,
      detailMeta: buildDetailMeta(filing),
      detailBody: buildDetailBody(
        filing,
        selected ? detail : null,
        selected && detailLoading,
      ),
    };
  });
}

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

export function createCftcBrowserInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query.toUpperCase()).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query.toUpperCase()}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

export function AdjacentFilingsPane({
  width,
  height,
  focused,
  client,
}: PaneProps & { client: AdjacentClient }) {
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [filings, setFilings] = useState<CftcFiling[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [detail, setDetail] = useState<CftcFilingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailCacheRef = useRef<Map<number, CftcFilingDetail>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void loadCftcFilings(client, nextQuery, CFTC_PAGE_SIZE)
      .then((page) => {
        if (abortRef.current !== controller) return;
        setFilings(page.filings);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setFilings([]);
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const openFiling = openItemId
    ? filings.find((filing) => String(filing.id) === openItemId) ?? null
    : null;
  const selectedFiling = filings[selectedIdx] ?? null;
  const detailFiling = openFiling ?? selectedFiling;
  const detailFilingId = detailFiling?.id;

  useEffect(() => {
    if (detailFilingId == null) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const cached = detailCacheRef.current.get(detailFilingId);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    const timeoutId = setTimeout(() => {
      void client.getFilingDetail(detailFilingId)
        .then((next) => {
          if (cancelled) return;
          if (next) detailCacheRef.current.set(detailFilingId, next);
          setDetail(next);
          setDetailLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setDetail(null);
          setDetailLoading(false);
        });
    }, DETAIL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [client, detailFilingId]);

  const loading = status === "loading" && filings.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), poll.intervalMinutes);

  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const popOutSelected = useCallback(() => {
    if (!detailFiling) return;
    popOutArticle(cftcFilingToArticle(detailFiling, detail));
  }, [detail, detailFiling, popOutArticle]);

  useEffect(() => {
    if (filings.length > 0 && selectedIdx >= filings.length) {
      setSelectedIdx(Math.max(0, filings.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, filings.length]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [setQuery, setSelectedIdx]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
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

  usePaneStatusLinkFooter({
    registrationId: "cftc-filings",
    focused,
    url: error ? null : detail?.sourceUrl || null,
    source: detailFiling ? feedLabel(detailFiling) : undefined,
    label: "filing",
    loading,
    error,
    info: [
      ...(client.isPublic
        ? [{ id: "tier", parts: [{ text: "public · last 90d", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !error && !!detail?.sourceUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
      ...(detailFiling
        ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutSelected }]
        : []),
    ],
  });

  const handleRootKeyDown = useCallback((event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void }, context: { selectedIndex: number }) => {
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
  }, [focusSearch, load, query]);

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="organization, product, or description"
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
          <Spinner label={query.trim() ? `Searching CFTC filings for ${query.trim()}...` : "Loading CFTC filings..."} />
        </Box>
      </Box>
    );
  }

  if (error && filings.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <Text fg={colors.textDim}>Error: {error}</Text>
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
      items={toFeedItems(filings, openFiling?.id, detail, detailLoading)}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      markdown
      sourceLabel="Org"
      titleLabel="Filing"
      emptyStateTitle={
        query.trim()
          ? `No CFTC filings match ${query.trim()}.`
          : "No recent CFTC filings."
      }
    />
  );
}
