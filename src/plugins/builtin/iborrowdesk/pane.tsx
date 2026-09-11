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

function snapshotDetailBody(snapshot: BorrowSnapshot): string {
  const lines = [
    `**Latest fee:** ${snapshot.latestFee != null ? formatFee(snapshot.latestFee) : "—"}`,
    `**Available:** ${formatShares(snapshot.available)}${snapshot.availableStale ? " (stale)" : ""}`,
  ];
  if (snapshot.name) lines.push(`**Name:** ${snapshot.name}`);
  if (snapshot.country) lines.push(`**Market:** ${snapshot.country}`);
  const recent = snapshot.days.slice(-5).reverse();
  if (recent.length > 1) {
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
    `**Fee:** ${formatFee(mover.latestFee)} (from ${formatFee(mover.startFee)})`,
    `**Change:** ${mover.feeChange >= 0 ? "+" : ""}${mover.feeChange.toFixed(2)} pts`,
    `**Available:** ${formatShares(mover.latestAvailable)}`,
    mover.name ? `**Name:** ${mover.name}` : "",
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
    detailTitle: `${snapshot.symbol} borrow · ${day.date}`,
    detailMeta: [
      `Fee ${formatFee(day.fee)}`,
      day.rebate != null ? `Rebate ${day.rebate.toFixed(2)}%` : undefined,
      `Available ${formatShares(day.available)}`,
    ].filter((value): value is string => !!value),
    detailBody: snapshotDetailBody(snapshot),
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [snapshot, setSnapshot] = useState<BorrowSnapshot | null>(null);
  const [movers, setMovers] = useState<{ up: BorrowMover[]; down: BorrowMover[] } | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextView: "snapshot" | "movers", nextSymbol: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      const request = nextView === "movers"
        ? client.getMovers(controller.signal).then((page) => {
          setMovers({ up: page.up, down: page.down });
        })
        : client.getSnapshot(nextSymbol, controller.signal).then((page) => {
          setSnapshot(page);
        });
      void request
        .then(() => {
          if (abortRef.current !== controller) return;
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    if (activeView === "snapshot" && !query.trim()) {
      setSnapshot(null);
      setStatus("loaded");
      setError(null);
      return;
    }
    const timeoutId = setTimeout(() => {
      load(activeView, query);
    }, activeView === "snapshot" ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, activeView, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const items = useMemo(() => {
    if (activeView === "movers") {
      return moverItems(
        movers ?? { up: [], down: [] },
        query,
      );
    }
    return snapshot ? snapshotItems(snapshot) : [];
  }, [activeView, movers, snapshot, query]);

  useEffect(() => {
    if (items.length > 0 && selectedIdx >= items.length) {
      setSelectedIdx(Math.max(0, items.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, items.length]);

  const selected = items[selectedIdx] ?? null;
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
    load(activeView, query);
  }, [load, activeView, query]);
  const toggleView = useCallback(() => {
    const next = activeView === "snapshot" ? "movers" : "snapshot";
    setLocalView(next);
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [activeView, setLocalView, setSelectedIdx]);

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
      return;
    }
    if (isPlainKey(event, "v")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      toggleView();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && items.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    refresh,
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: IBORROWDESK_PLUGIN_ID,
    focused,
    url: error ? null : openUrl,
    source: activeView === "snapshot"
      ? (snapshot?.availableStale ? "availability stale" : undefined)
      : undefined,
    label: "report",
    loading,
    error,
    info: [
      ...(snapshot?.availableStale && !loading && !error
        ? [{ id: "stale", parts: [{ text: "availability stale", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error && !!openUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "view", key: "v", label: "iew movers/snapshot", onPress: toggleView },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
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
      if (event.name === "v") {
        event.preventDefault?.();
        event.stopPropagation?.();
        toggleView();
        return true;
      }
      return false;
    },
    [focusSearch, refresh, toggleView],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder={activeView === "snapshot" ? "ticker" : "filter movers"}
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
            label={activeView === "movers"
              ? "Loading fee movers..."
              : `Loading borrow data for ${query.trim() || "…"}...`}
          />
        </Box>
      </Box>
    );
  }

  if (error && items.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="Borrow data unavailable." message={error} hint="Press r to retry." />
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
