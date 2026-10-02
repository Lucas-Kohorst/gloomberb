import { Box } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
import {
  EmptyState,
  FeedDataTableStackView,
  PaneListChrome,
  PaneStatusBody,
  usePaneListSearch,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { useAppSelector, usePaneSettingValue, usePaneTicker } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { formatMoneyCompact } from "../../../utils/format";
import { EulerpoolClient, eulerpoolQuoteUrl, resolveEulerpoolApiKey, statementAmount } from "./client";
import {
  EULERPOOL_PLUGIN_ID,
  EULERPOOL_BYOK_SERVICE_ID,
  type EulerpoolCashFlowPeriod,
  type EulerpoolFundamentals,
  type EulerpoolIncomePeriod,
  type EulerpoolProfile,
} from "./types";

import { byokKeysConfigSelector } from "../account-management/ai-providers";

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
    [profile?.sector, profile?.industry, profile?.country].filter(Boolean).join(" · "),
    profile?.isin ? `ISIN ${profile.isin}` : "",
    profile?.employees != null ? `${profile.employees.toLocaleString("en-US")} employees` : "",
    "",
    `Revenue ${money(income.revenue)}`,
    `Gross ${money(income.grossIncome)}`,
    `EBIT ${money(income.ebit)}`,
    income.dilutedEps != null ? `Diluted EPS ${income.dilutedEps}` : "",
    cash ? `Operating CF ${money(cash.operating)}` : "",
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
      timestampKind: "date",
      detailTitle: `${data.profile?.name || data.identifier} ${formatPeriod(income.period)}`,
      detailMeta: [
        ...((data.profile?.ticker || income.ticker) !== (data.profile?.name || data.identifier)
          ? [data.profile?.ticker || income.ticker] : []),
        money(income.netIncome) === "—" ? "net —" : `net ${money(income.netIncome)}`,
        ...(cash ? [`FCF ${money(cash.fcf)}`] : []),
      ],
      detailBody: buildDetailBody(data.profile, income, cash),
    };
  });
}

export function EulerpoolPane({ width, height, focused }: Pick<PaneProps, "width" | "height" | "focused">) {
  const keys = useAppSelector(byokKeysConfigSelector);
  const apiKey = keys.find((entry) => entry.serviceId === EULERPOOL_BYOK_SERVICE_ID)?.apiKey.trim() || resolveEulerpoolApiKey();
  const client = useMemo(() => new EulerpoolClient(apiKey), [apiKey]);
  const { symbol } = usePaneTicker();
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || (symbol ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) => client.getFundamentals(query, signal), [client, query]);
  const { data: fundamentals, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(query.trim() ? loader : null);
  const previousSymbol = useRef(symbol);
  useEffect(() => {
    const previous = previousSymbol.current;
    previousSymbol.current = symbol;
    if (symbol === previous || !symbol?.trim()) return;
    if (!query.trim() || query.trim() === previous?.trim()) {
      setQuery(symbol.trim());
      setSelectedId(null);
      setOpenItemId(null);
    }
  }, [query, setQuery, setSelectedId, symbol]);

  const items = useMemo(() => toFeedItems(fundamentals), [fundamentals]);
  const ticker = fundamentals?.profile?.ticker || query.trim().toUpperCase();
  const url = ticker ? eulerpoolQuoteUrl(ticker) : null;
  const loading = refreshing && !fundamentals;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const needsKey = error != null && error.includes("API key");

  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setOpenItemId(null);
    setSelectedId(null);
  }, [setQuery, setSelectedId]);

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: "ticker or ISIN (AAPL, US0378331005)", debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: (value) => value.trim(),
  });
  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    }
  }, { enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: EULERPOOL_PLUGIN_ID,
    focused: focused && !searchFocused,
    url,
    loading: refreshing,
    error: needsKey ? null : error,
    info: [
      ...(needsKey ? [{ id: "auth", parts: [{ text: "key required", tone: "warning" as const }] }] : []),
      ...(updatedAgo && !needsKey
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !!url,
    hints: !openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : [],
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
    if (handleSearchKey(event)) return true;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    return false;
  }, [focusSearch, handleSearchKey, refresh]);

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;

  if (loading || (error && !needsKey && !fundamentals)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Eulerpool fundamentals" onRetry={refresh} />
    </Box>;
  }

  if (needsKey && !fundamentals) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="Eulerpool key required."
            message="Add a free token in Account Management → BYOK."
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
      selectedItemId={items.find((item) => item.id === selectedId)?.id ?? items[0]?.id ?? null}
      onSelect={(index) => setSelectedId(items[index]?.id ?? null)}
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
