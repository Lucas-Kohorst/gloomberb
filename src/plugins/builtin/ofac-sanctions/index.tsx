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
import { SanctionsClient } from "./client";
import {
  OFAC_SANCTIONS_CONNECTION_ID,
  OFAC_SANCTIONS_PLUGIN_ID,
  type SanctionsEntry,
} from "./types";

const OFAC_SEARCH_URL = "https://sanctionssearch.ofac.treas.gov/";
const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createSanctionsInstance(
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `sanctions:${encoded}` : "sanctions:latest",
    title: query ? `Sanctions ${query}` : "Sanctions",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

function formatDetail(entry: SanctionsEntry): {
  meta: string[];
  body: string;
} {
  const meta = [
    entry.type,
    ...entry.sourceLists.map((source) => `list ${source}`),
  ];
  const sections = [
    entry.altNames.length > 0 ? `Alternate names\n${entry.altNames.join("\n")}` : undefined,
    entry.addresses.length > 0 ? `Addresses\n${entry.addresses.join("\n")}` : undefined,
    entry.programs.length > 0 ? `Programs\n${entry.programs.join(", ")}` : undefined,
    entry.nationalities.length > 0 ? `Nationalities\n${entry.nationalities.join(", ")}` : undefined,
    entry.datesOfBirth.length > 0 ? `Dates of birth\n${entry.datesOfBirth.join(", ")}` : undefined,
    entry.ids.length > 0 ? `IDs\n${entry.ids.join("\n")}` : undefined,
    entry.remarks ? `Remarks\n${entry.remarks}` : undefined,
  ].filter((section): section is string => !!section);
  return {
    meta,
    body: sections.length > 0 ? sections.join("\n\n") : "No additional sanctions details were published.",
  };
}

function toFeedItems(entries: SanctionsEntry[]): FeedDataTableItem[] {
  return entries.map((entry) => {
    const detail = formatDetail(entry);
    const source = entry.sourceLists.join(", ") || "Unknown";
    const programs = entry.programs.join(", ") || "—";
    const nationality = entry.nationalities.join(", ") || "—";
    return {
      id: entry.id,
      eyebrow: entry.type,
      title: `${entry.name}  ·  ${source}  ·  ${programs}  ·  ${nationality}`,
      timestamp: null,
      detailTitle: entry.name,
      detailMeta: detail.meta,
      detailBody: detail.body,
    };
  });
}

function SanctionsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new SanctionsClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [entries, setEntries] = useState<SanctionsEntry[]>([]);
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
    void client.searchEntries(nextQuery, controller.signal)
      .then((page) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setEntries(page.entries);
        setSelectedIdx(0);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        setEntries([]);
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [client, setSelectedIdx]);

  useEffect(() => {
    const timeoutId = setTimeout(() => load(query), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const loading = status === "loading" && entries.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(entries), [entries]);

  const selectedEntry = entries[selectedIdx] ?? null;
  const detailEntry = openItemId
    ? entries.find((entry) => entry.id === openItemId) ?? selectedEntry
    : selectedEntry;

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
    registrationId: OFAC_SANCTIONS_PLUGIN_ID,
    focused,
    url: detailEntry ? OFAC_SEARCH_URL : null,
    source: detailEntry?.sourceLists.join(", "),
    label: "sanctions entry",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !!detailEntry && !error,
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
      placeholder="name, company, or entity"
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
          <Spinner label={query ? `Searching sanctions for ${query}...` : "Loading sanctions..."} />
        </Box>
      </Box>
    );
  }
  if (error && entries.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <Text fg={colors.textDim}>Error: {error}</Text>
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
      titleLabel="Name · List · Programs · Nationality"
      emptyStateTitle={query ? `No sanctions entries match ${query}.` : "No sanctions entries."}
    />
  );
}

let disposeConnection: (() => void) | null = null;

export const ofacSanctionsPlugin: GloomPlugin = {
  id: OFAC_SANCTIONS_PLUGIN_ID,
  name: "OFAC Sanctions",
  version: "1.0.0",
  description: "Search the US Consolidated Screening List. Screen people, companies, and entities against OFAC and other sanctions lists.",
  toggleable: true,
  panes: [{
    id: "sanctions",
    name: "Sanctions",
    icon: "O",
    component: SanctionsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
  }],
  paneTemplates: [{
    id: "sanctions-pane",
    paneId: "sanctions",
    label: "Sanctions",
    description: "Search people, companies, and entities against the US Consolidated Screening List.",
    keywords: ["ofac", "sanctions", "screening", "sdn", "entity", "compliance"],
    category: "Data",
    shortcut: {
      prefix: "OFAC",
      argPlaceholder: "name or entity",
      argKind: "text",
      argOptional: true,
    },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
      return createSanctionsInstance(options);
    },
  }],
  setup() {
    disposeConnection = registerConnectionSource({
      id: OFAC_SANCTIONS_CONNECTION_ID,
      name: "OFAC Sanctions",
      kind: "api",
      pluginId: OFAC_SANCTIONS_PLUGIN_ID,
      priority: 650,
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default ofacSanctionsPlugin;
