import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type {
  GloomPlugin,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
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
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
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

export function CrtShPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new CrtShClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal, publishPreview: (records: CertificateRecord[]) => void) => {
    const page = await client.searchCertificates(query, publishPreview, signal);
    return page.records;
  }, [client, query]);
  const { data, loading, error, updatedAt, reload: load } = useAsyncResource(query.trim() ? loader : null);
  const records = data ?? [];
  const updateQuery = useCallback((value: string) => {
    setQuery(value.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);
  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: "domain (e.g. example.com)", debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: (value) => value.trim(),
  });
  const selected = records.find((record) => String(record.id) === selectedId) ?? records[0] ?? null;
  const openRecord = openItemId ? records.find((record) => String(record.id) === openItemId) : null;
  const activeRecord = openRecord ?? selected;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!loading && !error && query ? updatedAt : null, load, poll.intervalMinutes);
  const items = useMemo(() => toFeedItems(records), [records]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) { event.preventDefault?.(); event.stopPropagation?.(); load(); }
  }, { enabled: focused });

  usePaneStatusLinkFooter({
    registrationId: CRT_SH_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: activeRecord ? `https://crt.sh/?q=${encodeURIComponent(activeRecord.commonName || query)}` : null,
    loading,
    error,
    info: [
      ...(loading ? [{ id: "slow", parts: [{ text: "crt.sh may take 10+ seconds", tone: "muted" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!activeRecord,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
    ],
  });

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;
  if ((loading || error) && records.length === 0) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Certificate search" onRetry={load} />
    </Box>;
  }
  return <FeedDataTableStackView width={width} height={height} focused={focused && !searchFocused}
    rootBefore={rootBefore} items={items} selectedItemId={selected ? String(selected.id) : null}
    onSelect={(index) => setSelectedId(records[index] ? String(records[index]!.id) : null)}
    openItemId={openItemId} onOpenItemIdChange={setOpenItemId}
    sourceLabel="Issuer" titleLabel="Domain" onRootKeyDown={(event, context) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) { stopSearchFocusNavigation(event); focusSearch(); return true; }
      if (handleSearchKey(event)) return true;
      if (isPlainKey(event, "r")) { event.preventDefault?.(); event.stopPropagation?.(); load(); return true; }
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
    defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 30 }, tableExport: true }],
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
