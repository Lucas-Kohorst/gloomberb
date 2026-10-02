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
import { EarthquakesClient } from "./client";
import {
  USGS_EARTHQUAKES_CONNECTION_ID,
  USGS_EARTHQUAKES_PLUGIN_ID,
  type Earthquake,
} from "./types";

const SEARCH_DEBOUNCE_MS = 80;
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
    eq.type,
    `${formatTime(eq.time)} UTC`,
    formatCoordinates(eq.latitude, eq.longitude),
    `Depth: ${formatDepth(eq.depth)}`,
    `USGS tsunami flag: ${eq.tsunami ? "set" : "not set"}`,
    `Significance: ${eq.significance}`,
  ];
}

function buildDetailBody(eq: Earthquake): string {
  const lines: string[] = [
    `**Event ID:** ${eq.id}`,
    "",
    "The tsunami flag does not indicate whether a tsunami exists or will occur.",
  ];
  return lines.join("\n");
}

function toFeedItems(earthquakes: Earthquake[]): FeedDataTableItem[] {
  return earthquakes.map((earthquake) => ({
    id: earthquake.id,
    eyebrow: earthquake.type,
    title: `M ${earthquake.magnitude.toFixed(1)} · ${earthquake.place}`,
    timestamp: earthquake.time,
    detailTitle: `M ${earthquake.magnitude.toFixed(1)} · ${earthquake.place}`,
    detailMeta: buildDetailMeta(earthquake),
    detailBody: buildDetailBody(earthquake),
    detailNote: "https://www.tsunami.gov/",
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

export function EarthquakesPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new EarthquakesClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [minMagnitude, setMinMagnitude] = usePluginPaneState<number>(
    "minMagnitude",
    DEFAULT_MIN_MAGNITUDE,
  );

  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback((_force: boolean, signal: AbortSignal) =>
    client.listEarthquakes({ minMagnitude, limit: DEFAULT_LIMIT, signal }), [client, minMagnitude]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(loader);
  const earthquakes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.earthquakes ?? []).filter((eq) => eq.place.toLowerCase().includes(needle));
  }, [data, query]);
  const selectedEarthquake = earthquakes.find((eq) => eq.id === selectedId) ?? earthquakes[0] ?? null;
  const openEarthquake = openItemId
    ? earthquakes.find((eq) => eq.id === openItemId) ?? null
    : null;
  const detailEarthquake = openEarthquake ?? selectedEarthquake;

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
    placeholder: "location, e.g. California or Japan", debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });
  const cycleMinMagnitude = useCallback(() => {
    const index = MIN_MAGNITUDE_OPTIONS.indexOf(minMagnitude as (typeof MIN_MAGNITUDE_OPTIONS)[number]);
    setMinMagnitude(MIN_MAGNITUDE_OPTIONS[(index + 1) % MIN_MAGNITUDE_OPTIONS.length]!);
    setSelectedId(null);
    setOpenItemId(null);
  }, [minMagnitude, setMinMagnitude, setSelectedId]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
      return;
    }
    if (isPlainKey(event, "m")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      cycleMinMagnitude();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && !data;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const items = useMemo(() => toFeedItems(earthquakes), [earthquakes]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);

  const detailUrl = detailEarthquake?.url || null;

  usePaneStatusLinkFooter({
    registrationId: USGS_EARTHQUAKES_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: [
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!detailUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
      { id: "minmag", key: "m", label: `in mag ${minMagnitude.toFixed(1)}+`, onPress: cycleMinMagnitude },
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
      if (isPlainKey(event, "m")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        cycleMinMagnitude();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh, cycleMinMagnitude],
  );

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;
  if (loading || (error && !data)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Earthquakes" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedEarthquake?.id ?? null}
      onSelect={(index) => setSelectedId(earthquakes[index]?.id ?? null)}
      openItemId={openItemId}
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
      tableExport: true,
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
