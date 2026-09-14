import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
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
import { usePaneSettingValue, usePaneTicker } from "../../../state/app/context";
import { paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { formatMoneyCompact } from "../../../utils/format";
import { EulerpoolClient, eulerpoolQuoteUrl, statementAmount } from "./client";
import {
  EULERPOOL_PLUGIN_ID,
  type EulerpoolCashFlowPeriod,
  type EulerpoolFundamentals,
  type EulerpoolIncomePeriod,
  type EulerpoolProfile,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;

function formatPeriod(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(value: number | null): string {
  const scaled = statementAmount(value);
  return scaled == null ? "—" : formatMoneyCompact(scaled);
}

function cashForYear(cashFlow: EulerpoolCashFlowPeriod[], year: number): EulerpoolCashFlowPeriod | null {
  return cashFlow.find((period) => period.year === year) ?? null;
}

function buildDetailBody(
  profile: EulerpoolProfile | null,
  income: EulerpoolIncomePeriod,
  cash: EulerpoolCashFlowPeriod | null,
): string {
  const lines = [
    profile ? `${profile.name} · ${profile.ticker}` : income.ticker,
    [profile?.sector, profile?.industry, profile?.country].filter(Boolean).join(" · "),
    profile?.isin ? `ISIN ${profile.isin}` : "",
    profile?.employees != null ? `${profile.employees.toLocaleString("en-US")} employees` : "",
    "",
    `Revenue ${money(income.revenue)}`,
    `Gross ${money(income.grossIncome)}`,
    `EBIT ${money(income.ebit)}`,
    `Net income ${money(income.netIncome)}`,
    income.dilutedEps != null ? `Diluted EPS ${income.dilutedEps}` : "",
    cash ? `Operating CF ${money(cash.operating)}` : "",
    cash ? `FCF ${money(cash.fcf)}` : "",
    cash ? `Capex ${money(cash.capex)}` : "",
    profile?.description ? `\n${profile.description}` : "",
  ];
  return lines.filter((line, index) => line || index === 0).join("\n").trim();
}

function toFeedItems(data: EulerpoolFundamentals | null): FeedDataTableItem[] {
  if (!data) return [];
  return data.income.map((income) => {
    const cash = cashForYear(data.cashFlow, income.year);
    return {
      id: `${data.identifier}:${income.period.toISOString()}`,
      eyebrow: income.year ? String(income.year) : formatPeriod(income.period),
      title: `${data.profile?.name || data.identifier}  ·  ${money(income.revenue)} rev`,
      timestamp: income.period,
      detailTitle: `${data.profile?.name || data.identifier} ${formatPeriod(income.period)}`,
      detailMeta: [
        money(income.netIncome) === "—" ? "net —" : `net ${money(income.netIncome)}`,
        cash ? `FCF ${money(cash.fcf)}` : formatPeriod(income.period),
      ],
      detailBody: buildDetailBody(data.profile, income, cash),
    };
  });
}

export function EulerpoolPane({ width, height, focused }: Pick<PaneProps, "width" | "height" | "focused">) {
  const client = useMemo(() => new EulerpoolClient(), []);
  const { symbol } = usePaneTicker();
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || (symbol ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [fundamentals, setFundamentals] = useState<EulerpoolFundamentals | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      setFundamentals(null);
      setStatus("loaded");
      setError(null);
      return;
    }
    setStatus("loading");
    setError(null);
    void client.getFundamentals(trimmed, controller.signal)
      .then((next) => {
        if (abortRef.current !== controller) return;
        setFundamentals(next);
        setStatus("loaded");
        setLastUpdated(Date.now());
        setSelectedIdx(0);
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setFundamentals(null);
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timeoutId = setTimeout(() => load(query), query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!query.trim() && symbol?.trim() && symbol.trim() !== query.trim()) {
      setQuery(symbol.trim());
    }
  }, [query, setQuery, symbol]);

  const items = useMemo(() => toFeedItems(fundamentals), [fundamentals]);
  const ticker = fundamentals?.profile?.ticker || query.trim().toUpperCase();
  const url = ticker ? eulerpoolQuoteUrl(ticker) : null;
  const loading = status === "loading" && items.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const needsKey = error != null && error.includes("API key");

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setOpenItemId(null);
    setSelectedIdx(0);
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
    }
  }, { allowEditable: true, enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: EULERPOOL_PLUGIN_ID,
    focused,
    url,
    source: fundamentals?.profile?.isin || ticker || undefined,
    label: "fundamentals",
    loading,
    error: needsKey ? null : error,
    info: [
      ...(needsKey ? [{ id: "auth", parts: [{ text: "key required", tone: "warning" as const }] }] : []),
      ...(updatedAgo && !needsKey
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !!url && !error,
    hints: [paneSearchHint(focusSearch)],
  });

  const handleRootKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }, context: { selectedIndex: number }) => {
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
    return false;
  }, [focusSearch]);

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="ticker or ISIN (AAPL, US0378331005)"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={(value) => value.trim()}
      onFocus={focusSearch}
      onBlur={() => setSearchFocused(false)}
      onNavigateDown={() => setSearchFocused(false)}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={query ? `Loading Eulerpool fundamentals for ${query.trim().toUpperCase()}...` : "Loading Eulerpool..."} />
        </Box>
      </Box>
    );
  }

  if (error && items.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title={needsKey ? "Eulerpool key required." : "Eulerpool fundamentals unavailable."}
            message={needsKey
              ? "Add a free token in Account Management → BYOK."
              : error}
            hint="eulerpool.com/developers/register"
          />
        </Box>
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      items={items}
      width={width}
      height={height}
      focused={focused && !searchFocused}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      rootBefore={rootBefore}
      onRootKeyDown={handleRootKeyDown}
      emptyStateTitle={query.trim() ? `No Eulerpool periods for ${query.trim().toUpperCase()}.` : "Search a ticker for Eulerpool statements."}
      emptyStateHint={query.trim() ? undefined : "AAPL, MSFT, or an ISIN."}
    />
  );
}

export function EulerpoolResearchTab({ width, height, focused }: TickerResearchTabProps) {
  return <EulerpoolPane width={width} height={height} focused={focused} />;
}
