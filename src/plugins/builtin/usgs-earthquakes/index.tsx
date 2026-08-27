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
import { EarthquakesClient } from "./client";
import {
  USGS_EARTHQUAKES_CONNECTION_ID,
  USGS_EARTHQUAKES_PLUGIN_ID,
  type Earthquake,
  type EarthquakePage,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 3;
const MIN_MAGNITUDE_OPTIONS = [2.5, 4.0, 4.5, 5.0] as const;
const DEFAULT_MIN_MAGNITUDE = 2.5;
const DEFAULT_LIMIT = 100;

const trimSearchValue = (value: string) => value.trim();

function formatDepth(depth: number): string {
  return `${depth.toFixed(1)} km`;
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatCoordinates(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function buildDetailMeta(eq: Earthquake): string[] {
  return [
    `M ${eq.magnitude.toFixed(1)} · ${eq.type}`,
    eq.place,
    formatCoordinates(eq.latitude, eq.longitude),
    `Depth: ${formatDepth(eq.depth)}`,
    eq.tsunami ? "Tsunami warning" : "No tsunami",
    `Significance: ${eq.significance}`,
  ];
}

function buildDetailBody(eq: Earthquake): string {
  const lines: string[] = [
    `**Magnitude:** ${eq.magnitude.toFixed(1)}`,
    `**Place:** ${eq.place}`,
    `**Time:** ${formatTime(eq.time)}`,
    `**Coordinates:** ${formatCoordinates(eq.latitude, eq.longitude)}`,
    `**Depth:** ${formatDepth(eq.depth)}`,
    `**Type:** ${eq.type}`,
    `**Significance:** ${eq.significance}`,
    `**Tsunami:** ${eq.tsunami ? "Yes — tsunami warning issued" : "No"}`,
    `**Event ID:** ${eq.id}`,
  ];
  return lines.join("\n");
}

function toFeedItems(earthquakes: Earthquake[]): FeedDataTableItem[] {
  return earthquakes.map((earthquake) => ({
    id: earthquake.id,
    eyebrow: earthquake.type,
    title: `M ${earthquake.magnitude.toFixed(1)} · ${earthquake.place}`,
    timestamp: earthquake.time,
    detailTitle: earthquake.title,
    detailMeta: buildDetailMeta(earthquake),
    detailBody: buildDetailBody(earthquake),
  }));
}

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createEarthquakesPaneInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

function EarthquakesPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new EarthquakesClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [minMagnitude, setMinMagnitude] = usePluginPaneState<number>(
    "minMagnitude",
    DEFAULT_MIN_MAGNITUDE,
  );

  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string, nextMinMag: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      void client
        .listEarthquakes({
          minMagnitude: nextMinMag,
          limit: DEFAULT_LIMIT,
          searchQuery: nextQuery,
        })
        .then((page: EarthquakePage) => {
          if (abortRef.current !== controller) return;
          setEarthquakes(page.earthquakes);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setEarthquakes([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query, minMagnitude);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query, minMagnitude]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (earthquakes.length > 0 && selectedIdx >= earthquakes.length) {
      setSelectedIdx(Math.max(0, earthquakes.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, earthquakes.length]);

  const selectedEarthquake = earthquakes[selectedIdx] ?? null;
  const openEarthquake = openItemId
    ? earthquakes.find((eq) => eq.id === openItemId) ?? null
    : null;
  const detailEarthquake = openEarthquake ?? selectedEarthquake;

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

  const cycleMinMagnitude = useCallback(() => {
    setMinMagnitude((current) => {
      const idx = MIN_MAGNITUDE_OPTIONS.indexOf(
        current as (typeof MIN_MAGNITUDE_OPTIONS)[number],
      );
      const nextIdx = idx < 0 ? 0 : (idx + 1) % MIN_MAGNITUDE_OPTIONS.length;
      const next = MIN_MAGNITUDE_OPTIONS[nextIdx]!;
      setSelectedIdx(0);
      setOpenItemId(null);
      return next;
    });
  }, [setMinMagnitude, setSelectedIdx]);

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
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query, minMagnitude);
      return;
    }
    if (isPlainKey(event, "m")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleMinMagnitude();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && earthquakes.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(earthquakes), [earthquakes]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    () => load(query, minMagnitude),
    REFRESH_INTERVAL_MINUTES,
  );

  const detailUrl = detailEarthquake?.url || null;

  usePaneStatusLinkFooter({
    registrationId: USGS_EARTHQUAKES_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailEarthquake ? `M ${detailEarthquake.magnitude.toFixed(1)}` : undefined,
    label: "earthquake",
    loading,
    error,
    info: [
      { id: "minmag", parts: [{ text: `≥M${minMagnitude.toFixed(1)}`, tone: "muted" as const }] },
      { id: "live", parts: [{ text: "live", tone: "value" as const }] },
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query, minMagnitude) },
      { id: "minmag", key: "m", label: "in mag", onPress: cycleMinMagnitude },
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
        load(query, minMagnitude);
        return true;
      }
      if (event.name === "m") {
        event.preventDefault?.();
        event.stopPropagation?.();
        cycleMinMagnitude();
        return true;
      }
      return false;
    },
    [focusSearch, load, query, minMagnitude, cycleMinMagnitude],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="location, e.g. California or Japan"
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
            label={
              query.trim()
                ? `Searching earthquakes near ${query.trim()}...`
                : "Loading earthquakes..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && earthquakes.length === 0) {
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
      titleLabel="Earthquake"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No earthquakes match ${query.trim()}.`
          : "No recent earthquakes."
      }
    />
  );
}

let disposeConnection: (() => void) | null = null;

export const usgsEarthquakesPlugin: GloomPlugin = {
  id: USGS_EARTHQUAKES_PLUGIN_ID,
  name: "USGS Earthquakes",
  version: "1.0.0",
  description:
    "Real-time global earthquake data from USGS. Filter by magnitude and search by location.",
  toggleable: true,

  panes: [
    {
      id: "earthquakes",
      name: "Earthquakes",
      icon: "E",
      component: EarthquakesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "earthquakes-pane",
      paneId: "earthquakes",
      label: "Earthquakes",
      description:
        "Real-time global earthquake data from USGS. Filter by magnitude and search by location.",
      keywords: [
        "usgs",
        "earthquake",
        "seismic",
        "quake",
        "magnitude",
        "geology",
        "disaster",
        "tsunami",
      ],
      category: "Data",
      shortcut: {
        prefix: "QUAKE",
        argPlaceholder: "location",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createEarthquakesPaneInstance("earthquakes", "Earthquakes", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: USGS_EARTHQUAKES_CONNECTION_ID,
      name: "USGS Earthquakes",
      kind: "api",
      pluginId: USGS_EARTHQUAKES_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default usgsEarthquakesPlugin;
