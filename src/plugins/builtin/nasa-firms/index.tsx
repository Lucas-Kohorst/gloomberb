import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GloomPlugin,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
import {
  EmptyState,
  ErrorState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { useDebouncedPluginPaneState, usePluginPaneState, usePluginConfigState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { FirmsClient, loadFires } from "./client";
import {
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
  const brightC = kelvinToCelsius(d.brightness);
  const time = formatAcqTime(d.acqTime);
  const dn = d.dayNight === "D" ? "Day" : "Night";
  return [
    `**Location:** ${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`,
    `**Date:** ${d.acqDate}`,
    `**Time:** ${time} UTC`,
    `**Satellite:** ${d.satellite}`,
    `**Brightness:** ${brightC.toFixed(1)}°C (${d.brightness.toFixed(2)} K)`,
    `**Confidence:** ${confidenceLabel(d.confidence)}`,
    `**FRP:** ${d.frp.toFixed(1)} MW`,
    `**Scan / Track:** ${d.scan} / ${d.track}`,
    `**Day / Night:** ${dn}`,
  ].join("\n\n");
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
        `${d.acqDate} ${time}`,
        d.satellite,
        `${brightC.toFixed(1)}°C`,
        confidenceLabel(d.confidence),
        `${d.frp.toFixed(1)} MW`,
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

function FirePane({ width, height, focused }: PaneProps) {
  const [mapKey] = usePluginConfigState<string>(NASA_FIRMS_MAP_KEY_CONFIG, "");
  const hasKey = !!mapKey;
  const client = useMemo(
    () => new FirmsClient({ mapKey: mapKey || undefined }),
    [mapKey],
  );

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim() || "USA";
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [detections, setDetections] = useState<FireDetection[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string) => {
      if (!hasKey) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      void loadFires(client, nextQuery, DEFAULT_DAYS, (partial) => {
        if (abortRef.current !== controller) return;
        setDetections(partial);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
        .then((page) => {
          if (abortRef.current !== controller) return;
          setDetections(page.detections);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (abortRef.current !== controller) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setDetections([]);
          setStatus("error");
        });
    },
    [client, hasKey],
  );

  useEffect(() => {
    if (!hasKey) return;
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query, hasKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const openDetection = openItemId
    ? detections.find((d) => detectionId(d) === openItemId) ?? null
    : null;
  const selectedDetection = detections[selectedIdx] ?? null;
  const detailDetection = openDetection ?? selectedDetection;

  useEffect(() => {
    if (detections.length > 0 && selectedIdx >= detections.length) {
      setSelectedIdx(Math.max(0, detections.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, detections.length]);

  const loading = hasKey && status === "loading" && detections.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(detections), [detections]);

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

  useShortcut(
    (event) => {
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
        load(query);
      }
    },
    { allowEditable: true, enabled: focused },
  );

  usePaneStatusLinkFooter({
    registrationId: NASA_FIRMS_PLUGIN_ID,
    focused,
    url: hasKey && !error && detailDetection ? fireUrl(detailDetection) : null,
    source: detailDetection ? detailDetection.satellite : undefined,
    label: "fire",
    loading,
    error: hasKey ? error : null,
    info: [
      ...(!hasKey
        ? [{ id: "auth", parts: [{ text: "MAP_KEY required", tone: "muted" as const }] }]
        : []),
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: hasKey && !error && !!detailDetection,
    hints: hasKey
      ? [
          { id: "search", key: "/", label: "search", onPress: focusSearch },
          { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
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
    },
    [focusSearch, load, query],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="country code (USA, BRA, AUS) or bbox (W,S,E,N)"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={trimSearchValue}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (!hasKey) {
    return (
      <EmptyState
        title="NASA FIRMS key missing"
        message="Add a free MAP_KEY to load fire detections."
        hint={FIRMS_REGISTER_URL}
      />
    );
  }

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner
            label={
              query.trim()
                ? `Searching fires for ${query.trim()}...`
                : "Loading fire detections..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && detections.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <ErrorState kind="FIRMS" error={error} />
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

  setup() {
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
