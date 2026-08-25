import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GloomPlugin,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
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
import { useDebouncedPluginPaneState, usePluginPaneState, usePluginConfigState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { AdjacentDevClient, loadCftcFilings } from "./client";
import { buildDetailBody, buildDetailMeta, feedLabel } from "./format";
import {
  ADJACENT_DEV_API_KEY_CONFIG,
  ADJACENT_DEV_CONNECTION_ID,
  ADJACENT_DEV_PLUGIN_ID,
  type CftcFiling,
  type CftcFilingDetail,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const CFTC_PAGE_SIZE = 100;

const trimSearchValue = (value: string) => value.trim();

function cftcFilingToArticle(filing: CftcFiling, detail: CftcFilingDetail | null): NewsArticle {
  const label = feedLabel(filing);
  return {
    id: `cftc:${filing.id}`,
    title: filing.title,
    url: detail?.sourceUrl ?? "",
    source: "CFTC",
    publishedAt: filing.statusDate,
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
    body: detail?.markdown || undefined,
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
      title: filing.title,
      timestamp: filing.statusDate,
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

function createCftcBrowserInstance(
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

function CftcPane({ width, height, focused }: PaneProps) {
  const [apiKey] = usePluginConfigState<string>(ADJACENT_DEV_API_KEY_CONFIG, "");
  const client = useMemo(() => new AdjacentDevClient({ apiKey: apiKey || undefined }), [apiKey]);

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

  useEffect(() => {
    if (!openFiling) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    void client.getFilingDetail(openFiling.id)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
        setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [client, openFiling?.id]);

  const loading = status === "loading" && filings.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query));

  const popOutArticle = usePopOutNewsArticle();
  const popOutSelected = useCallback(() => {
    if (!openFiling) return;
    popOutArticle(cftcFilingToArticle(openFiling, detail));
  }, [detail, openFiling, popOutArticle]);

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
      return;
    }
    if (isPlainKey(event, "p") && openFiling) {
      event.stopPropagation?.();
      event.preventDefault?.();
      popOutSelected();
    }
  }, { allowEditable: true, enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: ADJACENT_DEV_PLUGIN_ID,
    focused,
    url: error ? null : detail?.sourceUrl || null,
    source: openFiling ? feedLabel(openFiling) : undefined,
    label: "filing",
    loading,
    error,
    info: [
      ...(client.authenticated
        ? []
        : [{ id: "tier", parts: [{ text: "public · last 90d", tone: "muted" as const }] }]),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error && !!detail?.sourceUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
      ...(openFiling
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
    if (event.name === "p" && openFiling) {
      event.preventDefault?.();
      event.stopPropagation?.();
      popOutSelected();
      return true;
    }
    return false;
  }, [focusSearch, load, openFiling, popOutSelected, query]);

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

let disposeConnection: (() => void) | null = null;

export const adjacentDevPlugin: GloomPlugin = {
  id: ADJACENT_DEV_PLUGIN_ID,
  name: "Adjacent Dev",
  version: "1.0.0",
  description:
    "CFTC industry filings via the Adjacent Dev API. Search by organization, product, or description.",
  toggleable: true,

  panes: [
    {
      id: "cftc-filings",
      name: "CFTC Filings",
      icon: "C",
      component: CftcPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: "cftc-filings-pane",
      paneId: "cftc-filings",
      label: "CFTC Filings",
      description:
        "CFTC industry filings: DCM products, DCO registrations, and rule certifications. Search an organization or product, or open CFTC CME to jump there.",
      keywords: [
        "cftc",
        "filings",
        "dcm",
        "dco",
        "products",
        "rules",
        "certification",
        "adjacent",
        "dev",
      ],
      category: "Data",
      shortcut: {
        prefix: "CFTC",
        argPlaceholder: "organization or product",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createCftcBrowserInstance("cftc", "CFTC", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: ADJACENT_DEV_CONNECTION_ID,
      name: "Adjacent Dev",
      kind: "api",
      pluginId: ADJACENT_DEV_PLUGIN_ID,
      priority: 650,
      // The public tier serves the last 90 days without a key; a key only
      // widens the window.
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default adjacentDevPlugin;
