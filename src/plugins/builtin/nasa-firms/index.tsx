import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type {
  GloomPlugin,
  GloomPluginContext,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
import {
  EmptyState,
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
import { useDebouncedPluginPaneState, usePluginPaneState, usePluginConfigState } from "../../runtime";
import { useAppSelector, usePaneSettingValue } from "../../../state/app/context";
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { byokKeysConfigSelector } from "../account-management/ai-providers";
import { FirmsClient, loadFires, resolveNasaFirmsMapKey, setNasaFirmsMapKeyResolver } from "./client";
import {
  NASA_FIRMS_API_BASE_URL,
  NASA_FIRMS_BYOK_SERVICE_ID,
  NASA_FIRMS_CONNECTION_ID,
  NASA_FIRMS_MAP_KEY_CONFIG,
  NASA_FIRMS_PLUGIN_ID,
  type FireDetection,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_DAYS = 1;
const REFRESH_INTERVAL_MINUTES = 15;
const FIRMS_REGISTER_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/";

const trimSearchValue = (value: string) => value.trim();

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function detectionId(d: FireDetection): string {
  return `${d.latitude},${d.longitude},${d.acqDate},${d.acqTime},${d.satellite}`;
}

/** Convert FIRMS acq_time (HHMM) to a readable HH:MM string. */
function formatAcqTime(time: string): string {
  if (time.length === 4 && /^\d{4}$/.test(time)) {
    return `${time.slice(0, 2)}:${time.slice(2)}`;
  }
  return time;
}

/** Combine acq_date and acq_time into a UTC Date for sorting and display. */
function fireTimestamp(d: FireDetection): Date {
  const time = formatAcqTime(d.acqTime);
  return new Date(`${d.acqDate}T${time}:00Z`);
}

function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

/** Confidence is a 0-100 number (MODIS) or a letter l/n/h (VIIRS). */
function confidenceLabel(confidence: string): string {
  const lower = confidence.toLowerCase();
  if (lower === "h") return "High";
  if (lower === "n") return "Nominal";
  if (lower === "l") return "Low";
  const n = Number(confidence);
  if (Number.isFinite(n)) {
    if (n >= 80) return `High (${n})`;
    if (n >= 50) return `Nominal (${n})`;
    return `Low (${n})`;
  }
  return confidence;
}

function fireUrl(d: FireDetection): string {
  return `https://www.google.com/maps?q=${d.latitude},${d.longitude}`;
}

function buildFireDetailBody(d: FireDetection): string {
  return `**Scan / Track:** ${d.scan} / ${d.track}`;
}

function toFeedItems(detections: FireDetection[]): FeedDataTableItem[] {
  return detections.map((d) => {
    const brightC = kelvinToCelsius(d.brightness);
    const time = formatAcqTime(d.acqTime);
    return {
      id: detectionId(d),
      eyebrow: d.satellite,
      title: `${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)}`,
      timestamp: fireTimestamp(d),
      detailTitle: `Fire at ${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`,
      detailMeta: [
        `${d.acqDate} ${time} UTC`,
        d.satellite,
        `Brightness: ${brightC.toFixed(1)}°C (${d.brightness.toFixed(2)} K)`,
        `Confidence: ${confidenceLabel(d.confidence)}`,
        `FRP: ${d.frp.toFixed(1)} MW`,
        d.dayNight === "D" ? "Day" : "Night",
      ],
      detailBody: buildFireDetailBody(d),
    };
  });
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createFireInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query.toUpperCase()).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query.toUpperCase()}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

// ---------------------------------------------------------------------------
// Pane component
// ---------------------------------------------------------------------------

export function FirePane({ width, height, focused }: PaneProps) {
  const [pluginKey] = usePluginConfigState<string>(NASA_FIRMS_MAP_KEY_CONFIG, "");
  const byokKeys = useAppSelector(byokKeysConfigSelector);
  const mapKey = byokKeys.find((entry) => entry.serviceId === NASA_FIRMS_BYOK_SERVICE_ID)?.apiKey?.trim()
    || pluginKey?.trim()
    || resolveNasaFirmsMapKey()
    || "";
  const hasKey = !!mapKey;
  const client = useMemo(
    () => new FirmsClient({ mapKey: mapKey || undefined }),
    [mapKey],
  );

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || "USA";
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const loader = useCallback(async (_force: boolean, signal: AbortSignal, publishPreview: (data: FireDetection[]) => void) => {
    const page = await loadFires(client, query, DEFAULT_DAYS, publishPreview, signal);
    return page.detections;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt, reload: refresh } = useAsyncResource(hasKey && query.trim() ? loader : null);
  const detections = data ?? [];

  const openDetection = openItemId
    ? detections.find((d) => detectionId(d) === openItemId) ?? null
    : null;
  const selectedDetection = detections.find((d) => detectionId(d) === selectedId) ?? detections[0] ?? null;
  const detailDetection = openDetection ?? selectedDetection;

  const loading = refreshing && !data;
  const updatedAgo = useUpdatedAgo(updatedAt);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(!refreshing && !error ? updatedAt : null, refresh, poll.intervalMinutes);
  const items = useMemo(() => toFeedItems(detections), [detections]);

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && hasKey && !openItemId, value: query, onQueryChange: updateQuery,
    placeholder: "country code (USA, BRA, AUS) or bbox (W,S,E,N)",
    debounceMs: SEARCH_DEBOUNCE_MS, normalizeValue: trimSearchValue,
  });
  useShortcut(
    (event) => {
      if (!focused || searchFocused || event.targetEditable) return;
      if (isPlainKey(event, "r")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        refresh();
      }
    },
    { allowEditable: true, enabled: focused },
  );

  usePaneStatusLinkFooter({
    registrationId: NASA_FIRMS_PLUGIN_ID,
    focused: focused && !searchFocused,
    url: hasKey && detailDetection ? fireUrl(detailDetection) : null,
    loading: refreshing,
    error: hasKey ? error : null,
    info: [
      ...(!hasKey
        ? [{ id: "auth", parts: [{ text: "MAP_KEY required", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: hasKey && !!detailDetection,
    hints: hasKey && !openItemId
      ? [
          { id: "search", key: "/", label: "search", onPress: focusSearch },
        ]
      : [],
  });

  const handleRootKeyDown = useCallback(
    (event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void }, context: { selectedIndex: number }) => {
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
      return false;
    },
    [focusSearch, handleSearchKey, refresh],
  );

  const rootBefore = <PaneListChrome width={width} focused={focused && !openItemId} search={search} />;

  if (!hasKey) {
    return (
      <EmptyState
        title="NASA FIRMS key missing"
        message="Add a free MAP_KEY in Account Management → BYOK to load fire detections."
        hint={FIRMS_REGISTER_URL}
      />
    );
  }

  if (loading || (error && !data)) {
    return <Box flexDirection="column" width={width} height={height}>
      {rootBefore}
      <PaneStatusBody loading={loading} error={error} subject="Fire detections" onRetry={refresh} />
    </Box>;
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedDetection ? detectionId(selectedDetection) : null}
      onSelect={(index) => setSelectedId(detections[index] ? detectionId(detections[index]!) : null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      markdown
      sourceLabel="Sat"
      titleLabel="Location"
      emptyStateTitle={
        query.trim()
          ? `No fire detections for ${query.trim()}.`
          : "Enter a country code to search for fire detections."
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

let disposeConnection: (() => void) | null = null;

export const nasaFirmsPlugin: GloomPlugin = {
  id: NASA_FIRMS_PLUGIN_ID,
  name: "NASA FIRMS",
  version: "1.0.0",
  description:
    "Near-real-time active fire detection from NASA MODIS and VIIRS satellites.",
  toggleable: true,

  panes: [
    {
      id: "fire-detection",
      name: "Fire Detection",
      icon: "F",
      component: FirePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "fire-detection-pane",
      paneId: "fire-detection",
      label: "Fire Detection",
      description:
        "Near-real-time active fire detection from NASA MODIS and VIIRS satellites. Search by country code (USA, BRA, AUS) or bounding box.",
      keywords: [
        "nasa",
        "firms",
        "fire",
        "modis",
        "viirs",
        "satellite",
        "detection",
        "wildfire",
        "hotspot",
      ],
      category: "Data",
      shortcut: {
        prefix: "FIRE",
        argPlaceholder: "country code or bbox",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createFireInstance("fire-detection", "Fire Detection", options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: NASA_FIRMS_BYOK_SERVICE_ID,
      name: "NASA FIRMS",
      apiUrl: NASA_FIRMS_API_BASE_URL,
      authType: "none",
      envVar: "NASA_FIRMS_MAP_KEY",
      description:
        "Free MAP_KEY from firms.modaps.eosdis.nasa.gov/api/area/. Required for fire detections; ~20 requests/min per key.",
    });
    setNasaFirmsMapKeyResolver(() => (
      ctx.getApiKey(NASA_FIRMS_BYOK_SERVICE_ID)
      ?? ctx.configState?.get<string>(NASA_FIRMS_MAP_KEY_CONFIG)
      ?? undefined
    ));
    disposeConnection = registerConnectionSource({
      id: NASA_FIRMS_CONNECTION_ID,
      name: "NASA FIRMS",
      kind: "api",
      pluginId: NASA_FIRMS_PLUGIN_ID,
      authRequired: true,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default nasaFirmsPlugin;
