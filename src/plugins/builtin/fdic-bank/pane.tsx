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
    detailTitle: failure.name,
    detailMeta: [
      failureAction(failure),
      failureLocation(failure),
      `Closed ${formatFailDate(failure.failDate)}`,
      ...(failure.cert != null ? [`CERT ${failure.cert}`] : []),
    ],
    detailBody: [
      `**Bank:** ${failure.name}`,
      `**Action:** ${failureAction(failure)}`,
      `**Closed:** ${formatFailDate(failure.failDate)}`,
      `**Location:** ${failureLocation(failure)}`,
      `**CERT:** ${failure.cert ?? "—"}`,
    ].join("\n"),
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
      bankLocation(bank),
      `CERT ${bank.cert}`,
    ],
    detailBody: [
      `**Bank:** ${bank.name}`,
      `**Status:** ${bank.active ? "Active" : "Inactive"}`,
      `**Location:** ${bankLocation(bank)}${bank.stateName ? ` (${bank.stateName})` : ""}`,
      `**CERT:** ${bank.cert}`,
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [failures, setFailures] = useState<BankFailure[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void client.searchRisk(nextQuery, controller.signal)
      .then((page) => {
        if (abortRef.current !== controller || controller.signal.aborted) return;
        setBanks(page.banks);
        setFailures(page.failures);
        setSelectedIdx((current) => {
          const total = page.failures.length + page.banks.length;
          return total > 0 && current >= total ? Math.max(0, total - 1) : current;
        });
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller || controller.signal.aborted) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setBanks([]);
        setFailures([]);
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timeoutId = setTimeout(() => load(query), query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const loading = status === "loading" && banks.length === 0 && failures.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(banks, failures), [banks, failures]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
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
        updateQuery("");
      }
      return;
    }
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
    } else if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  const selectedIsFailure = selectedIdx < failures.length;
  const selectedBank = !selectedIsFailure ? banks[selectedIdx - failures.length] ?? null : null;
  const selectedFailure = selectedIsFailure ? failures[selectedIdx] ?? null : null;
  const openIsFailure = openItemId?.startsWith("failure:");
  const openBank = openItemId && !openIsFailure
    ? banks.find((bank) => `bank:${bank.cert}` === openItemId) ?? null
    : null;
  const openFailure = openItemId && openIsFailure
    ? failures.find((failure) => `failure:${failure.id}` === openItemId) ?? null
    : null;
  const detailBank = openBank ?? selectedBank;
  const detailFailure = openFailure ?? (openItemId ? null : selectedFailure);
  const detailUrl = detailBank
    ? bankDetailsUrl(detailBank.cert)
    : detailFailure
      ? (bankDetailsUrl(detailFailure.cert) ?? FAILED_BANK_LIST_URL)
      : null;

  usePaneStatusLinkFooter({
    registrationId: FDIC_BANK_PLUGIN_ID,
    focused,
    url: detailUrl,
    source: "FDIC",
    label: detailFailure ? "failure record" : "bank record",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !!detailUrl && !error,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
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
      placeholder="bank name, CERT, state, or failure year"
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
          <Spinner label={query.trim() ? `Searching banks for ${query.trim()}...` : "Loading recent failures..."} />
        </Box>
      </Box>
    );
  }
  if (error && items.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Bank data unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Type"
      titleLabel="Bank · Location · Detail"
      markdown
      emptyStateTitle={query.trim() ? `No banks match ${query.trim()}.` : "No recent failures."}
      emptyStateHint="Press / to search banks or failures."
    />
  );
}
