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
import { FdicBankClient } from "./client";
import {
  FDIC_BANK_PLUGIN_ID,
  type BankFailure,
  type BankRecord,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 60;

const FAILED_BANK_LIST_URL = "https://www.fdic.gov/bank-failures/failed-bank-list";

function bankDetailsUrl(cert: number | null): string | null {
  return cert == null ? null : `https://banks.data.fdic.gov/bankfind-suite/bankfind/details/${cert}`;
}

/** Values arrive in $ thousands. */
function formatMoney(thousands: number | null): string {
  if (thousands == null) return "—";
  const dollars = thousands * 1000;
  if (Math.abs(dollars) >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function formatFailDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function bankLocation(bank: BankRecord): string {
  return [bank.city, bank.state].filter(Boolean).join(", ") || "—";
}

function failureLocation(failure: BankFailure): string {
  return [failure.city, failure.state].filter(Boolean).join(", ") || "—";
}

function failureAction(failure: BankFailure): string {
  return failure.actionType.toUpperCase() === "ASSISTANCE" ? "Assistance" : "Failed";
}

function toFeedItems(banks: BankRecord[], failures: BankFailure[]): FeedDataTableItem[] {
  const failureItems: FeedDataTableItem[] = failures.map((failure) => ({
    id: `failure:${failure.id}`,
    eyebrow: failureAction(failure),
    title: `${failure.name}  ·  ${failureLocation(failure)}  ·  ${formatFailDate(failure.failDate)}`,
    timestamp: failure.failDate,
    timestampKind: "date",
    detailTitle: failure.name,
    detailMeta: [
      failureAction(failure),
      failureLocation(failure),
      `Date ${formatFailDate(failure.failDate)}`,
      ...(failure.cert != null ? [`CERT ${failure.cert}`] : []),
    ],
    detailBody: "",
  }));
  const bankItems: FeedDataTableItem[] = banks.map((bank) => ({
    id: `bank:${bank.cert}`,
    eyebrow: bank.active ? `Active${bank.bankClass ? ` · ${bank.bankClass}` : ""}` : "Inactive",
    title: `${bank.name}  ·  ${bankLocation(bank)}  ·  CERT ${bank.cert}  ·  ${formatMoney(bank.assets)} assets`,
    timestamp: null,
    detailTitle: bank.name,
    detailMeta: [
      bank.active ? "Active" : "Inactive",
      ...(bank.bankClass ? [bank.bankClass] : []),
      `${bankLocation(bank)}${bank.stateName ? ` (${bank.stateName})` : ""}`,
      `CERT ${bank.cert}`,
    ],
    detailBody: [
      `**Assets:** ${formatMoney(bank.assets)}`,
      `**Deposits:** ${formatMoney(bank.deposits)}`,
      ...(bank.webAddress ? [`**Website:** ${bank.webAddress}`] : []),
    ].join("\n"),
  }));
  return [...failureItems, ...bankItems];
}

export function FdicBankPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new FdicBankClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) => client.searchRisk(query, signal), [client, query]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(loader);
  const banks = data?.banks ?? [];
  const failures = data?.failures ?? [];
  const loading = refreshing && !data;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);
  const items = useMemo(() => toFeedItems(banks, failures), [banks, failures]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: "bank name, CERT, state, or failure year", debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: (value) => value.trim(),
  });
  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const activeId = openItemId ?? selected?.id;
  const detailBank = banks.find((bank) => `bank:${bank.cert}` === activeId) ?? null;
  const detailFailure = failures.find((failure) => `failure:${failure.id}` === activeId) ?? null;
  const detailUrl = detailBank
    ? bankDetailsUrl(detailBank.cert)
    : detailFailure
      ? (bankDetailsUrl(detailFailure.cert) ?? FAILED_BANK_LIST_URL)
      : null;

  usePaneStatusLinkFooter({
    registrationId: FDIC_BANK_PLUGIN_ID,
    focused: focused && !searchFocused,
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
  if (loading || (error && !data)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Bank data" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selected?.id ?? null}
      onSelect={(index) => setSelectedId(items[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Type"
      titleLabel="Bank · Location · Detail"
      markdown
      emptyStateTitle={query.trim() ? `No banks match ${query.trim()}.` : "No recent failures."}
      emptyStateHint="Press / to search banks or failures."
    />
  );
}
