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
import { IBorrowDeskClient } from "./client";
import {
  IBORROWDESK_BASE_URL,
  IBORROWDESK_PLUGIN_ID,
  IBORROWDESK_REPORT_URL,
  type BorrowMover,
  type BorrowSnapshot,
} from "./types";

const SEARCH_DEBOUNCE_MS = 600;
const REFRESH_INTERVAL_MINUTES = 15;
const HISTORY_DAYS = 30;

const trimSearchValue = (value: string) => value.trim().toUpperCase();

export function formatFee(fee: number): string {
  return `${fee.toFixed(2)}%`;
}

export function formatShares(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

function snapshotDetailBody(snapshot: BorrowSnapshot, selectedDate: string): string {
  const lines = selectedDate === snapshot.days.at(-1)?.date ? [] : [
    `**Latest fee:** ${snapshot.latestFee != null ? formatFee(snapshot.latestFee) : "—"}`,
    `**Latest availability:** ${formatShares(snapshot.available)}${snapshot.availableStale ? " (stale)" : ""}`,
  ];
  if (snapshot.name) lines.push(`**Name:** ${snapshot.name}`);
  if (snapshot.country) lines.push(`**Market:** ${snapshot.country}`);
  const recent = snapshot.days.slice(-5).reverse().filter((day) => day.date !== selectedDate);
  if (recent.length > 0) {
    lines.push(
      "",
      "Last sessions:",
      ...recent.map((day) => `- ${day.date} · fee ${formatFee(day.fee)} · ${formatShares(day.available)} available`),
    );
  }
  if (snapshot.latestFee != null && snapshot.latestFee >= 100) {
    lines.push("", "Fees above 100% annualized usually mean the borrow is tight — check availability before sizing a short.");
  }
  return lines.join("\n");
}

function moverDetailBody(mover: BorrowMover): string {
  return [
    `**Previous fee:** ${formatFee(mover.startFee)}`,
    `**Available:** ${formatShares(mover.latestAvailable)}`,
    "",
    "A sharp fee increase means short demand is outpacing lendable supply.",
  ].filter(Boolean).join("\n");
}

function snapshotItems(snapshot: BorrowSnapshot): FeedDataTableItem[] {
  return snapshot.days.slice(-HISTORY_DAYS).reverse().map((day) => ({
    id: day.date,
    eyebrow: formatFee(day.fee),
    title: `${formatShares(day.available)} available`,
    timestamp: new Date(`${day.date}T00:00:00Z`),
    timestampKind: "date",
    detailTitle: `${snapshot.symbol} borrow · ${day.date}`,
    detailMeta: [
      `Fee ${formatFee(day.fee)}`,
      day.rebate != null ? `Rebate ${day.rebate.toFixed(2)}%` : undefined,
      `Available ${formatShares(day.available)}`,
    ].filter((value): value is string => !!value),
    detailBody: snapshotDetailBody(snapshot, day.date),
  }));
}

function moverItems(movers: { up: BorrowMover[]; down: BorrowMover[] }, query: string): FeedDataTableItem[] {
  const needle = query.trim().toUpperCase();
  const rows: Array<{ mover: BorrowMover; tag: string }> = [
    ...movers.up.map((mover) => ({ mover, tag: "UP" })),
    ...movers.down.map((mover) => ({ mover, tag: "DOWN" })),
  ].filter(({ mover }) => !needle
    || mover.symbol.includes(needle)
    || mover.name.toUpperCase().includes(needle));
  return rows.map(({ mover, tag }) => ({
    id: `${tag}:${mover.symbol}`,
    eyebrow: tag,
    title: `${mover.symbol}${mover.name ? ` · ${mover.name}` : ""} · ${formatFee(mover.latestFee)}`,
    timestamp: mover.updated,
    detailTitle: `${mover.symbol} borrow fee ${formatFee(mover.latestFee)}`,
    detailMeta: [
      tag,
      mover.name || undefined,
      `Change ${mover.feeChange >= 0 ? "+" : ""}${mover.feeChange.toFixed(2)} pts`,
    ].filter((value): value is string => !!value),
    detailBody: moverDetailBody(mover),
  }));
}

export function IBorrowDeskPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new IBorrowDeskClient(), []);

  const [storedSymbol] = usePaneSettingValue("symbol", "");
  const [storedView] = usePaneSettingValue("view", "");
  const settingsSymbol = String(storedSymbol ?? "").trim().toUpperCase();
  const view = storedView === "movers" ? "movers" : "snapshot";
  const [query, setQuery] = usePluginPaneState("symbol", settingsSymbol);
  const [localView, setLocalView] = usePluginPaneState<"snapshot" | "movers">("view", view);
  const activeView = localView === "movers" ? "movers" : "snapshot";
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const snapshotLoader = useCallback((_force: boolean, signal: AbortSignal) =>
    client.getSnapshot(query, signal), [client, query]);
  const moversLoader = useCallback((_force: boolean, signal: AbortSignal) => client.getMovers(signal), [client]);
  const snapshotResource = useAsyncResource(activeView === "snapshot" && query.trim() ? snapshotLoader : null);
  const moversResource = useAsyncResource(activeView === "movers" ? moversLoader : null);
  const snapshot = snapshotResource.data;
  const movers = moversResource.data;
  const { loading: refreshing, error, updatedAt, reload: refresh } = activeView === "movers" ? moversResource : snapshotResource;

  const items = useMemo(() => {
    if (activeView === "movers") {
      return moverItems(
        movers ?? { up: [], down: [] },
        query,
      );
    }
    return snapshot ? snapshotItems(snapshot) : [];
  }, [activeView, movers, snapshot, query]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const openItem = openItemId
    ? items.find((item) => item.id === openItemId) ?? null
    : null;
  const detail = openItem ?? selected;
  const detailSymbol = activeView === "snapshot"
    ? snapshot?.symbol ?? query.trim().toUpperCase()
    : activeView === "movers" && detail
      ? (detail.id.split(":")[1] ?? "")
      : "";
  const openUrl = activeView === "snapshot" && detailSymbol
    ? `${IBORROWDESK_REPORT_URL}/${encodeURIComponent(detailSymbol)}`
    : activeView === "movers" ? `${IBORROWDESK_BASE_URL}/fee-movers` : null;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: activeView === "snapshot" ? "ticker" : "filter movers",
    debounceMs: activeView === "snapshot" ? SEARCH_DEBOUNCE_MS : 80,
    normalizeValue: trimSearchValue,
  });
  const toggleView = useCallback(() => {
    const next = activeView === "snapshot" ? "movers" : "snapshot";
    setLocalView(next);
    setSelectedId(null);
    setOpenItemId(null);
  }, [activeView, setLocalView, setSelectedId]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
      return;
    }
    if (isPlainKey(event, "v")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      toggleView();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && !(activeView === "movers" ? movers : snapshot);
  const updatedAgo = useUpdatedAgo(updatedAt);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  usePaneStatusLinkFooter({
    registrationId: IBORROWDESK_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: openUrl,
    loading: refreshing,
    error,
    info: [
      ...(snapshot?.availableStale && !loading && !error
        ? [{ id: "stale", parts: [{ text: "availability stale", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!openUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
      { id: "view", key: "v", label: "iew movers/snapshot", onPress: toggleView },
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
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      if (isPlainKey(event, "v")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        toggleView();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh, toggleView],
  );

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;
  if (loading || (error && !(activeView === "movers" ? movers : snapshot))) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Borrow data" onRetry={refresh} />
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
      sourceLabel={activeView === "movers" ? "Move" : "Fee"}
      titleLabel={activeView === "movers" ? "Mover" : "Session"}
      markdown
      emptyStateTitle={
        activeView === "movers"
          ? query.trim()
            ? `No movers match ${query.trim()}.`
            : "No fee movers right now."
          : query.trim()
            ? `No borrow data for ${query.trim()}.`
            : "Enter a ticker to load borrow data."
      }
      emptyStateHint={activeView === "snapshot" && !query.trim() ? "Press / and type a ticker…" : undefined}
    />
  );
}
