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
import { mergeAircraft, OpenSkyClient } from "./client";
import {
  OPENSKY_CONNECTION_ID,
  OPENSKY_PLUGIN_ID,
  type AircraftPage,
  type AircraftState,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 2;
const METERS_TO_FEET = 3.28084;
const MPS_TO_KNOTS = 1.94384;

const trimSearchValue = (value: string) => value.trim().toUpperCase();

function formatAltitude(meters: number | null): string {
  if (meters == null) return "—";
  return `${Math.round(meters * METERS_TO_FEET).toLocaleString()} ft`;
}

function formatSpeed(mps: number | null): string {
  if (mps == null) return "—";
  return `${Math.round(mps * MPS_TO_KNOTS)} kt`;
}

function formatHeading(heading: number | null): string {
  if (heading == null) return "—";
  return `${Math.round(heading)}°`;
}

function formatPosition(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return "—";
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function formatTimestamp(value: number | null): string {
  if (value == null || value <= 0) return "—";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString();
}

function buildDetailBody(aircraft: AircraftState): string {
  const lines: string[] = [
    `ICAO24: ${aircraft.icao24.toUpperCase()}`,
    `Callsign: ${aircraft.callsign || "—"}`,
    `Country: ${aircraft.originCountry || "—"}`,
    `Position: ${formatPosition(aircraft.latitude, aircraft.longitude)}`,
    `Altitude: ${formatAltitude(aircraft.altitude)}`,
    `Speed: ${formatSpeed(aircraft.velocity)}`,
    `Heading: ${formatHeading(aircraft.heading)}`,
    `Vertical rate: ${aircraft.verticalRate != null ? `${Math.round(aircraft.verticalRate)} m/s` : "—"}`,
    `On ground: ${aircraft.onGround ? "yes" : "no"}`,
    `Last contact: ${formatTimestamp(aircraft.lastContact)}`,
  ];
  return lines.join("\n");
}

function buildDetailMeta(aircraft: AircraftState): string[] {
  return [
    aircraft.originCountry,
    formatPosition(aircraft.latitude, aircraft.longitude),
    `${formatAltitude(aircraft.altitude)} · ${formatSpeed(aircraft.velocity)} · ${formatHeading(aircraft.heading)}`,
  ].filter(Boolean);
}

function aircraftUrl(aircraft: AircraftState | null): string | null {
  if (!aircraft) return null;
  return `https://globe.adsbexchange.com/?icao=${encodeURIComponent(aircraft.icao24)}`;
}

function toFeedItems(aircraft: AircraftState[]): FeedDataTableItem[] {
  return aircraft.map((state) => ({
    id: state.icao24,
    eyebrow: state.originCountry || "Unknown",
    title: state.callsign || state.icao24.toUpperCase(),
    timestamp: state.lastContact ? new Date(state.lastContact * 1000) : null,
    detailTitle: state.callsign || state.icao24.toUpperCase(),
    detailMeta: buildDetailMeta(state),
    detailBody: buildDetailBody(state),
  }));
}

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createAircraftPaneInstance(
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

function AircraftPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new OpenSkyClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void client
      .listAircraft(nextQuery, (partial) => {
        if (abortRef.current !== controller) return;
        setAircraft((current) => mergeAircraft(current, partial));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .then((page: AircraftPage) => {
        if (abortRef.current !== controller) return;
        setAircraft((current) => mergeAircraft(current, page.aircraft));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setAircraft([]);
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (aircraft.length > 0 && selectedIdx >= aircraft.length) {
      setSelectedIdx(Math.max(0, aircraft.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, aircraft.length]);

  const selectedAircraft = aircraft[selectedIdx] ?? null;
  const openAircraft = openItemId
    ? aircraft.find((state) => state.icao24 === openItemId) ?? null
    : null;
  const detailAircraft = openAircraft ?? selectedAircraft;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
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
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && aircraft.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(query), REFRESH_INTERVAL_MINUTES);
  const items = useMemo(() => toFeedItems(aircraft), [aircraft]);

  const detailUrl = aircraftUrl(detailAircraft);

  usePaneStatusLinkFooter({
    registrationId: OPENSKY_PLUGIN_ID,
    focused,
    url: error ? null : detailUrl,
    source: detailAircraft?.callsign || detailAircraft?.icao24.toUpperCase(),
    label: "aircraft",
    loading,
    error,
    info: [
      { id: "live", parts: [{ text: "live", tone: "value" as const }] },
      ...(updatedAgo
        ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
        : []),
    ],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
    ],
  });

  const handleRootKeyDown = useCallback((event: {
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
      placeholder="callsign, e.g. UAL or DAL"
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
          <Spinner label={query.trim() ? `Searching aircraft for ${query.trim()}...` : "Loading aircraft..."} />
        </Box>
      </Box>
    );
  }

  if (error && aircraft.length === 0) {
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
      sourceLabel="Country"
      titleLabel="Callsign"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No aircraft match ${query.trim()}.`
          : "No aircraft available."
      }
    />
  );
}

let disposeConnection: (() => void) | null = null;

export const openskyPlugin: GloomPlugin = {
  id: OPENSKY_PLUGIN_ID,
  name: "OpenSky Network",
  version: "1.0.0",
  description: "Live global aircraft positions from OpenSky Network. Track flights by callsign.",
  toggleable: true,

  panes: [
    {
      id: "aircraft",
      name: "Aircraft",
      icon: "A",
      component: AircraftPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "aircraft-pane",
      paneId: "aircraft",
      label: "Aircraft",
      description: "Live global aircraft positions from OpenSky Network. Track flights by callsign.",
      keywords: ["opensky", "aircraft", "flight", "plane", "tracking", "ads-b", "adsb"],
      category: "Data",
      shortcut: {
        prefix: "SKY",
        argPlaceholder: "callsign",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createAircraftPaneInstance("aircraft", "Aircraft", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: OPENSKY_CONNECTION_ID,
      name: "OpenSky Network",
      kind: "api",
      pluginId: OPENSKY_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default openskyPlugin;
