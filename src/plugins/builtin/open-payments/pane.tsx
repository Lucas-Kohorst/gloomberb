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
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { OpenPaymentsClient } from "./client";
import {
  OPEN_PAYMENTS_PLUGIN_ID,
  type OpenPayment,
} from "./types";

const EMPTY_ITEMS: OpenPayment[] = [];

const SEARCH_DEBOUNCE_MS = 250;
// The underlying data publishes once a year; hourly refresh is plenty.
const REFRESH_INTERVAL_MINUTES = 60;

const trimSearchValue = (value: string) => value.trim();

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
  const when = payment.date ? formatDate(payment.date) : "";
  const placeAndDate = [place, when].filter(Boolean).join(" · ");
  if (placeAndDate) meta.push(placeAndDate);
  return meta;
}

function buildDetailBody(payment: OpenPayment): string {
  const lines = [
    payment.npi ? `NPI: ${payment.npi}` : undefined,
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
    timestampKind: "date",
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
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.listPayments({ searchQuery: query, signal });
    return page.payments;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const payments = data ?? EMPTY_ITEMS;

  const selectedPayment = payments.find((item) => item.id === selectedId) ?? payments[0] ?? null;
  const loading = refreshing && payments.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(lastUpdated, refresh, poll.intervalMinutes);
  const items = useMemo(() => toFeedItems(payments), [payments]);

  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "company, physician, NPI, or state",
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

  usePaneStatusLinkFooter({
    registrationId: OPEN_PAYMENTS_PLUGIN_ID,
    focused,
    url: null,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: false,
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
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    return false;
  }, [focusSearch, handleSearchKey, refresh]);

  const rootBefore = (
    <PaneListChrome width={width} focused={focused && !openItemId} search={search} />
  );

  if (loading || (error && payments.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Payments" onRetry={refresh} />
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
      selectedItemId={selectedPayment?.id ?? null}
      onSelect={(index) => setSelectedId(payments[index]?.id ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Recipient"
      titleLabel="Payment"
      emptyStateTitle={query.trim() ? `No payments match ${query.trim()}.` : "Press / to search payments."}
    />
  );
}
