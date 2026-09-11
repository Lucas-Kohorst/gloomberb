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
import { OpenPaymentsClient } from "./client";
import {
  OPEN_PAYMENTS_PLUGIN_ID,
  type OpenPayment,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
// The underlying data publishes once a year; hourly refresh is plenty.
const REFRESH_INTERVAL_MINUTES = 60;

function formatMoney(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function recipientEyebrow(payment: OpenPayment): string {
  const parts = [payment.recipientName, payment.recipientState].filter(Boolean);
  return parts.join(" · ") || payment.companyName || "Unknown";
}

function paymentTitle(payment: OpenPayment): string {
  const amount = formatMoney(payment.amount);
  if (payment.companyName) return `${amount} · ${payment.companyName}`;
  return payment.nature ? `${amount} · ${payment.nature}` : amount;
}

function buildDetailMeta(payment: OpenPayment): string[] {
  const meta: string[] = [];
  if (payment.companyName) meta.push(payment.companyName);
  const kind = [payment.nature, payment.form].filter(Boolean).join(" · ");
  if (kind) meta.push(kind);
  const place = [payment.recipientCity, payment.recipientState].filter(Boolean).join(", ");
  const when = formatDate(payment.date);
  meta.push(place ? `${place} on ${when}` : when);
  return meta;
}

function buildDetailBody(payment: OpenPayment): string {
  const lines = [
    `Amount: ${formatMoney(payment.amount)}`,
    `Company: ${payment.companyName || "—"}`,
    payment.npi
      ? `Recipient: ${payment.recipientName || "—"} (NPI ${payment.npi})`
      : `Recipient: ${payment.recipientName || "—"}`,
    `Nature: ${payment.nature || "—"}`,
    payment.productName
      ? `Product: ${payment.productName}${payment.productCategory ? ` (${payment.productCategory})` : ""}`
      : undefined,
    payment.programYear ? `Program year: ${payment.programYear}` : undefined,
    `Record: ${payment.id}`,
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

function toFeedItems(payments: OpenPayment[]): FeedDataTableItem[] {
  return payments.map((payment) => ({
    id: payment.id,
    eyebrow: recipientEyebrow(payment),
    title: paymentTitle(payment),
    timestamp: payment.date,
    detailTitle: payment.recipientName
      ? `${payment.recipientName} · ${formatMoney(payment.amount)}`
      : formatMoney(payment.amount),
    detailMeta: buildDetailMeta(payment),
    detailBody: buildDetailBody(payment),
  }));
}

export function OpenPaymentsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenPaymentsClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [payments, setPayments] = useState<OpenPayment[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    setStatus("loading");
    setError(null);
    void client.listPayments({ searchQuery: nextQuery, signal: controller.signal })
      .then((page) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setPayments(page.payments);
        setSelectedIdx(0);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setPayments([]);
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timeoutId = setTimeout(() => load(query), query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedPayment = payments[selectedIdx] ?? null;
  const detailPayment = openItemId
    ? payments.find((payment) => payment.id === openItemId) ?? selectedPayment
    : selectedPayment;

  const loading = status === "loading" && payments.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(payments), [payments]);

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

  usePaneStatusLinkFooter({
    registrationId: OPEN_PAYMENTS_PLUGIN_ID,
    focused,
    url: null,
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: false,
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
      placeholder="company, physician, NPI, or state"
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
          <Spinner label={query.trim() ? `Searching payments for ${query.trim()}...` : "Loading payments..."} />
        </Box>
      </Box>
    );
  }
  if (error && payments.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Payments unavailable." message={error} hint="Press r to retry." />
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
      sourceLabel="Recipient"
      titleLabel="Payment"
      emptyStateTitle={query.trim() ? `No payments match ${query.trim()}.` : "Press / to search payments."}
    />
  );
}
