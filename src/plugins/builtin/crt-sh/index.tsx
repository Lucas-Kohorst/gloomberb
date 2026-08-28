import { Box, Text, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GloomPlugin,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
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
import { CrtShClient } from "./client";
import { CRT_SH_CONNECTION_ID, CRT_SH_PLUGIN_ID, type CertificateRecord } from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;

function formatDate(date: Date): string {
  return date.getTime() === 0 ? "—" : date.toISOString().slice(0, 10);
}

function detailBody(record: CertificateRecord): string {
  return [
    `Serial number: ${record.serialNumber || "—"}`,
    `Issuer: ${record.issuerName || "—"}`,
    `Common name: ${record.commonName || "—"}`,
    `Not before: ${formatDate(record.notBefore)}`,
    `Not after: ${formatDate(record.notAfter)}`,
    "",
    "Name values:",
    ...(record.nameValues.length > 0 ? record.nameValues.map((name) => `- ${name}`) : ["- —"]),
  ].join("\n");
}

function toFeedItems(records: CertificateRecord[]): FeedDataTableItem[] {
  return records.map((record) => ({
    id: String(record.id),
    eyebrow: record.issuerName || "Unknown issuer",
    title: record.commonName || record.nameValues[0] || `Certificate ${record.id}`,
    timestamp: record.notBefore,
    detailTitle: record.commonName || `Certificate ${record.id}`,
    detailMeta: [
      `Not before ${formatDate(record.notBefore)}`,
      `Not after ${formatDate(record.notAfter)}`,
      `${record.nameValues.length} domain${record.nameValues.length === 1 ? "" : "s"}`,
    ],
    detailBody: detailBody(record),
  }));
}

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  return {
    instanceId: query ? `crt-sh:${encodeURIComponent(query)}` : "crt-sh:latest",
    title: query ? `Cert Transparency ${query}` : "Cert Transparency",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

function CrtShPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new CrtShClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const searchRef = useRef<InputRenderable | null>(null);
  const [records, setRecords] = useState<CertificateRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((value: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    if (!value.trim()) {
      setRecords([]);
      setStatus("loaded");
      return;
    }
    void client.searchCertificates(value, (partial) => {
      if (abortRef.current !== controller) return;
      setRecords(partial);
      setStatus("loaded");
      setLastUpdated(Date.now());
    }).then((page) => {
      if (abortRef.current !== controller) return;
      setRecords(page.records);
      setSelectedIdx(0);
      setStatus("loaded");
      setLastUpdated(Date.now());
    }).catch((reason) => {
      if (abortRef.current !== controller) return;
      if (reason instanceof Error && reason.name === "AbortError") return;
      setRecords([]);
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("error");
    });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setFocusToken((value) => value + 1);
  }, []);
  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [setQuery, setSelectedIdx]);
  const selected = records[selectedIdx] ?? null;
  const openRecord = openItemId ? records.find((record) => String(record.id) === openItemId) : null;
  const activeRecord = openRecord ?? selected;
  const loading = status === "loading";
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(
    status === "loaded" && query ? lastUpdated : null,
    () => load(query),
    REFRESH_INTERVAL_MINUTES,
  );
  const items = useMemo(() => toFeedItems(records), [records]);

  useShortcut((event) => {
    if (!focused || openItemId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "/")) { event.preventDefault?.(); focusSearch(); }
    if (isPlainKey(event, "r")) { event.preventDefault?.(); load(query); }
  }, { enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: CRT_SH_PLUGIN_ID,
    focused,
    url: activeRecord ? `https://crt.sh/?q=${encodeURIComponent(activeRecord.commonName || query)}` : null,
    source: activeRecord?.commonName,
    label: "certificate",
    loading,
    error,
    info: [
      ...(loading ? [{ id: "slow", parts: [{ text: "crt.sh may take 10+ seconds", tone: "muted" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    showOpenHint: !!activeRecord,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
    ],
  });

  const rootBefore = (
    <InputSearchBar value={query} focused={focused && !openItemId} active={searchFocused}
      width={width} focusToken={focusToken} inputRef={searchRef} placeholder="domain (e.g. example.com)"
      debounceMs={SEARCH_DEBOUNCE_MS} normalizeValue={(value) => value.trim()}
      onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
      onNavigateDown={() => setSearchFocused(false)} onQueryChange={updateQuery} />
  );
  if (loading && records.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center"><Spinner label={`Searching crt.sh${query ? ` for ${query}` : ""}...`} /></Box></Box>;
  if (error && records.length === 0) return <Box flexDirection="column" width={width} height={height}>{rootBefore}<Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}><Text fg={colors.textDim}>Error: {error}</Text></Box></Box>;
  return <FeedDataTableStackView width={width} height={height} focused={focused && !searchFocused}
    rootBefore={rootBefore} items={items} selectedIdx={selectedIdx} onSelect={setSelectedIdx}
    onOpenItemIdChange={setOpenItemId} sourceLabel="Issuer" titleLabel="Domain" onRootKeyDown={(event, context) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) { stopSearchFocusNavigation(event); focusSearch(); return true; }
      if (event.name === "/") { event.preventDefault?.(); focusSearch(); return true; }
      if (event.name === "r") { event.preventDefault?.(); load(query); return true; }
      return false;
    }} emptyStateTitle={query ? `No certificates match ${query}.` : "Search for a domain."} />;
}

let disposeConnection: (() => void) | null = null;

export const crtShPlugin: GloomPlugin = {
  id: CRT_SH_PLUGIN_ID,
  name: "crt.sh",
  version: "1.0.0",
  description: "Search Certificate Transparency logs for domains, subdomains, and certificate history.",
  toggleable: true,
  panes: [{ id: "crt-sh", name: "Cert Transparency", icon: "C", component: CrtShPane,
    defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 30 } }],
  paneTemplates: [{
    id: "crt-sh-pane", paneId: "crt-sh", label: "Cert Transparency",
    description: "Search Certificate Transparency logs for domains, subdomains, and certificate history.",
    keywords: ["crt.sh", "certificate", "transparency", "certificates", "subdomains", "domains", "osint"],
    category: "Data", shortcut: { prefix: "CRT", argPlaceholder: "domain", argKind: "text", argOptional: true },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) { return createInstance(options); },
  }],
  setup() {
    disposeConnection = registerConnectionSource({ id: CRT_SH_CONNECTION_ID, name: "crt.sh", kind: "api", pluginId: CRT_SH_PLUGIN_ID, priority: 650, authRequired: false });
  },
  dispose() { disposeConnection?.(); disposeConnection = null; },
};

export default crtShPlugin;
