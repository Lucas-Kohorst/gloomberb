import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GloomPlugin, PaneProps, PaneTemplateCreateOptions, PaneTemplateContext } from "../../../types/plugin";
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
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { SpendingClient } from "./client";
import { USASPENDING_CONNECTION_ID, USASPENDING_PLUGIN_ID, type SpendingAward, type SpendingDetail } from "./types";

const money = (value: number | null) => value == null
  ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

function detailMeta(award: SpendingAward): string[] {
  return [award.awardType, award.awardingAgency, money(award.awardAmount)].filter(Boolean);
}

function detailBody(award: SpendingAward, detail: SpendingDetail | null, loading: boolean): string {
  if (loading) return "Loading award details...";
  return [
    award.description || undefined,
    detail?.recipientAddress ? `Recipient address: ${detail.recipientAddress}` : undefined,
    detail?.placeOfPerformance ? `Place of performance: ${detail.placeOfPerformance}` : undefined,
  ].filter((part): part is string => !!part).join("\n\n") || "No further detail was published for this award.";
}

function toItems(awards: SpendingAward[], openId: string | null, detail: SpendingDetail | null, loading: boolean): FeedDataTableItem[] {
  return awards.map((award) => ({
    id: award.id,
    eyebrow: award.recipientName || "Unknown recipient",
    title: award.awardingAgency || "Federal award",
    timestamp: award.startDate,
    detailTitle: award.recipientName || award.id,
    detailMeta: detailMeta(award),
    detailBody: detailBody(award, openId === award.id ? detail : null, openId === award.id && loading),
  }));
}

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function FederalSpendingPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new SpendingClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const inputRef = useRef<InputRenderable | null>(null);
  const [awards, setAwards] = useState<SpendingAward[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpendingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading"); setError(null);
    void client.listAwards(nextQuery).then((page) => {
      if (abortRef.current !== controller) return;
      setAwards(page.awards); setStatus("loaded"); setUpdated(Date.now());
    }).catch((reason) => {
      if (abortRef.current !== controller || reason instanceof Error && reason.name === "AbortError") return;
      setAwards([]); setStatus("error"); setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [client]);

  useEffect(() => {
    const timer = setTimeout(() => load(query), query.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedAward = (openId ? awards.find((award) => award.id === openId) : null) ?? awards[selectedIdx] ?? null;
  useEffect(() => {
    setDetail(null); setDetailLoading(false);
    if (!selectedAward) return;
    let cancelled = false;
    setDetailLoading(true);
    const timer = setTimeout(() => {
      void client.getAwardDetail(selectedAward.id).then((value) => {
        if (!cancelled) { setDetail(value); setDetailLoading(false); }
      }).catch(() => { if (!cancelled) setDetailLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, selectedAward?.id]);

  const focusSearch = useCallback(() => { setSearchFocused(true); setFocusToken((value) => value + 1); }, []);
  const updateQuery = useCallback((value: string) => { setQuery(value.trim()); setSelectedIdx(0); setOpenId(null); }, [setQuery, setSelectedIdx]);
  useShortcut((event) => {
    if (!focused || openId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "/")) { event.preventDefault?.(); event.stopPropagation?.(); focusSearch(); }
    else if (isPlainKey(event, "r")) { event.preventDefault?.(); event.stopPropagation?.(); load(query); }
  }, { allowEditable: true, enabled: focused });
  useAutoRefresh(status === "loaded" ? updated : null, () => load(query), 15);
  const items = useMemo(() => toItems(awards, openId, detail, detailLoading), [awards, openId, detail, detailLoading]);
  const updatedAgo = useUpdatedAgo(status === "loaded" ? updated : null);
  usePaneStatusLinkFooter({
    registrationId: USASPENDING_PLUGIN_ID, focused, url: detail?.sourceUrl ?? null,
    source: "USAspending", label: "award", loading: status === "loading" && awards.length === 0, error,
    info: updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : [],
    showOpenHint: !!detail?.sourceUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
    ],
  });
  const rootBefore = <InputSearchBar value={query} focused={focused && !openId} active={searchFocused} width={width} focusToken={focusToken} inputRef={inputRef} placeholder="recipient or keyword" debounceMs={250} onFocus={focusSearch} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={updateQuery} />;
  if (status === "loading" && awards.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center"><Spinner label="Loading federal spending..." /></Box></Box>;
  if (error && awards.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}><Text fg={colors.textDim}>Error: {error}</Text></Box></Box>;
  return <FeedDataTableStackView width={width} height={height} focused={focused && !searchFocused} rootBefore={rootBefore} items={items} selectedIdx={selectedIdx} onSelect={setSelectedIdx} onOpenItemIdChange={setOpenId} onRootKeyDown={(event, context) => { if (context.selectedIndex <= 0 && isPlainArrowUp(event)) { stopSearchFocusNavigation(event); focusSearch(); return true; } if (event.name === "/") { event.preventDefault?.(); event.stopPropagation?.(); focusSearch(); return true; } if (event.name === "r") { event.preventDefault?.(); event.stopPropagation?.(); load(query); return true; } return false; }} markdown sourceLabel="Recipient" titleLabel="Agency" emptyStateTitle={query ? `No awards match ${query}.` : "No federal spending awards."} />;
}

let disposeConnection: (() => void) | null = null;
export const usaspendingPlugin: GloomPlugin = {
  id: USASPENDING_PLUGIN_ID, name: "USAspending", version: "1.0.0",
  description: "Search federal contract awards by recipient, agency, or keyword.", toggleable: true,
  panes: [{ id: "usaspending", name: "Federal Spending", icon: "$", component: FederalSpendingPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 30 } }],
  paneTemplates: [{ id: "usaspending-pane", paneId: "usaspending", label: "Federal Spending", description: "Search federal contract awards by recipient, agency, or keyword.", keywords: ["usa", "usaspending", "federal", "contracts", "spending", "awards"], category: "Data", shortcut: { prefix: "USA", argPlaceholder: "recipient or keyword", argKind: "text", argOptional: true }, createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) { const query = queryFromOptions(options); return { instanceId: query ? `usaspending:${encodeURIComponent(query)}` : "usaspending:latest", title: query ? `Federal Spending ${query}` : "Federal Spending", placement: "floating", settings: { query } }; } }],
  setup() { disposeConnection = registerConnectionSource({ id: USASPENDING_CONNECTION_ID, name: "USAspending", kind: "api", pluginId: USASPENDING_PLUGIN_ID, authRequired: false }); },
  dispose() { disposeConnection?.(); disposeConnection = null; },
};
export default usaspendingPlugin;
