import { Box, Text } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GloomPlugin,
  PaneProps,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
import {
  ErrorState,
  FeedDataTableStackView,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { colors } from "../../../theme/colors";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { registerConnectionSource } from "../connections/register";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { SpaceWeatherClient } from "./client";
import {
  SPACE_WEATHER_CONNECTION_ID,
  SPACE_WEATHER_PLUGIN_ID,
  type KpReading,
  type SolarWindReading,
  type SpaceWeatherData,
  type XrayFlare,
} from "./types";

const SWPC_URL = "https://www.swpc.noaa.gov/";
const REFRESH_INTERVAL_MINUTES = 3;
const MAX_KP_READINGS = 24;
const MAX_SOLAR_WIND_READINGS = 24;
const MAX_FLARES = 24;

type TabId = "kp" | "solar" | "flares";

const TABS: { id: TabId; label: string; key: string }[] = [
  { id: "kp", label: "K-Index", key: "1" },
  { id: "solar", label: "Solar Wind", key: "2" },
  { id: "flares", label: "X-Ray Flares", key: "3" },
];

// ---------------------------------------------------------------------------
// Unified row type for the data table across all three tabs.
// ---------------------------------------------------------------------------

interface SpaceWeatherRow {
  id: string;
  time: Date;
  kp?: number;
  estimatedKp?: number;
  kpShort?: string;
  bx?: number;
  by?: number;
  bz?: number;
  bt?: number;
  classType?: string;
  intensity?: number;
  beginTime?: Date | null;
  maxTime?: Date | null;
  endTime?: Date | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function formatNumber(value: number | undefined, decimals = 1): string {
  if (value == null) return "\u2014";
  return value.toFixed(decimals);
}

function formatIntensity(intensity: number): string {
  return intensity.toExponential(2);
}

function kpColor(kp: number): string {
  if (kp >= 5) return colors.negative;
  if (kp >= 4) return colors.warning;
  return colors.positive;
}

function kpStatusLabel(kp: number): string {
  if (kp >= 5) return "Storm";
  if (kp >= 4) return "Active";
  return "Quiet";
}

function bzColor(bz: number): string {
  return bz < 0 ? colors.negative : colors.positive;
}

function flareColor(classType: string): string {
  if (classType.startsWith("X")) return colors.negative;
  if (classType.startsWith("M")) return colors.warning;
  if (classType.startsWith("C")) return colors.text;
  return colors.textDim;
}

// ---------------------------------------------------------------------------
// Data → rows
// ---------------------------------------------------------------------------

function lastNReversed<T>(items: T[], n: number): T[] {
  const start = items.length > n ? items.length - n : 0;
  const out: T[] = [];
  for (let i = items.length - 1; i >= start; i--) out.push(items[i]!);
  return out;
}

function kpToRows(readings: KpReading[]): SpaceWeatherRow[] {
  return lastNReversed(readings, MAX_KP_READINGS).map((r, i) => ({
    id: `kp-${i}`,
    time: r.timeTag,
    kp: r.kp,
    estimatedKp: r.estimatedKp,
    kpShort: r.kpShort,
  }));
}

function solarToRows(readings: SolarWindReading[]): SpaceWeatherRow[] {
  return lastNReversed(readings, MAX_SOLAR_WIND_READINGS).map((r, i) => ({
    id: `solar-${i}`,
    time: r.timeTag,
    bx: r.bx,
    by: r.by,
    bz: r.bz,
    bt: r.bt,
  }));
}

function flaresToRows(flares: XrayFlare[]): SpaceWeatherRow[] {
  return lastNReversed(flares, MAX_FLARES).map((f, i) => ({
    id: `flare-${i}`,
    time: f.timeTag,
    classType: f.classType,
    intensity: f.intensity,
    beginTime: f.beginTime,
    maxTime: f.maxTime,
    endTime: f.endTime,
  }));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function buildDetailMeta(row: SpaceWeatherRow, tab: TabId): string[] {
  const meta: string[] = [formatTime(row.time)];
  switch (tab) {
    case "kp":
      if (row.kpShort) meta.push(row.kpShort);
      break;
    case "solar":
      meta.push(`Bz ${formatNumber(row.bz)}`);
      break;
    case "flares":
      if (row.classType) meta.push(row.classType);
      break;
  }
  return meta;
}

function buildDetailBody(row: SpaceWeatherRow, tab: TabId): string {
  const lines: string[] = [`Time: ${formatTime(row.time)}`];
  switch (tab) {
    case "kp":
      lines.push(`Kp: ${row.kp ?? "\u2014"}`);
      lines.push(`Estimated Kp: ${row.estimatedKp != null ? row.estimatedKp.toFixed(1) : "\u2014"}`);
      lines.push(`Label: ${row.kpShort ?? "\u2014"}`);
      if (row.kp != null) lines.push(`Status: ${kpStatusLabel(row.kp)}`);
      break;
    case "solar":
      lines.push(`Bx: ${formatNumber(row.bx)} nT`);
      lines.push(`By: ${formatNumber(row.by)} nT`);
      lines.push(`Bz: ${formatNumber(row.bz)} nT`);
      lines.push(`Bt: ${formatNumber(row.bt)} nT`);
      if (row.bz != null) {
        lines.push(
          row.bz < 0
            ? "Bz southward \u2014 geomagnetic storm risk"
            : "Bz northward \u2014 low storm risk",
        );
      }
      break;
    case "flares":
      lines.push(`Class: ${row.classType ?? "\u2014"}`);
      lines.push(
        `Intensity: ${row.intensity != null ? formatIntensity(row.intensity) : "\u2014"} W/m\u00b2`,
      );
      if (row.beginTime) lines.push(`Begin: ${formatTime(row.beginTime)}`);
      if (row.maxTime) lines.push(`Max: ${formatTime(row.maxTime)}`);
      if (row.endTime) lines.push(`End: ${formatTime(row.endTime)}`);
      break;
  }
  return lines.join("\n");
}

function toFeedItems(rows: SpaceWeatherRow[], tab: TabId): FeedDataTableItem[] {
  return rows.map((row) => ({
    id: row.id,
    eyebrow: tab === "kp" ? row.kpShort ?? "Kp" : tab === "flares" ? row.classType ?? "Flare" : "Solar wind",
    title: tab === "kp" ? `Kp ${formatNumber(row.kp)} · Est ${formatNumber(row.estimatedKp)}` : tab === "flares" ? `${row.classType ?? "Flare"} · ${row.intensity != null ? formatIntensity(row.intensity) : "—"}` : `Bz ${formatNumber(row.bz)} nT · Bt ${formatNumber(row.bt)} nT`,
    timestamp: row.time,
    detailTitle: `${TABS.find((t) => t.id === tab)?.label ?? "Reading"} Reading`,
    detailMeta: buildDetailMeta(row, tab),
    detailBody: buildDetailBody(row, tab),
  }));
}

// ---------------------------------------------------------------------------
// Current value summaries for the header
// ---------------------------------------------------------------------------

function currentKpDisplay(
  readings: KpReading[],
): { text: string; color: string; status: string } | null {
  const latest = readings[readings.length - 1];
  if (!latest) return null;
  return {
    text: `${latest.kpShort} (${latest.estimatedKp.toFixed(1)})`,
    color: kpColor(latest.kp),
    status: kpStatusLabel(latest.kp),
  };
}

function currentBzDisplay(
  readings: SolarWindReading[],
): { text: string; color: string; status: string } | null {
  const latest = readings[readings.length - 1];
  if (!latest) return null;
  return {
    text: `${latest.bz.toFixed(1)} nT`,
    color: bzColor(latest.bz),
    status: latest.bz < 0 ? "southward \u2014 storm risk" : "northward \u2014 low risk",
  };
}

function latestFlareDisplay(
  flares: XrayFlare[],
): { text: string; color: string } | null {
  const latest = flares[flares.length - 1];
  if (!latest) return null;
  return {
    text: `${latest.classType} (${formatIntensity(latest.intensity)})`,
    color: flareColor(latest.classType),
  };
}

// ---------------------------------------------------------------------------
// Pane component
// ---------------------------------------------------------------------------

function SpaceWeatherPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new SpaceWeatherClient(), []);

  const [activeTab, setActiveTab] = usePluginPaneState<TabId>("activeTab", "kp");
  const [data, setData] = useState<SpaceWeatherData>({
    kpReadings: [],
    solarWind: [],
    flares: [],
  });
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>(
    "selectedIdx",
    0,
  );
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void client
      .getAll()
      .then((result) => {
        if (abortRef.current !== controller) return;
        setData(result);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setData({ kpReadings: [], solarWind: [], flares: [] });
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // Reset selection and sort when the tab changes.
  useEffect(() => {
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [activeTab, setSelectedIdx]);

  const rows = useMemo<SpaceWeatherRow[]>(() => {
    switch (activeTab) {
      case "kp":
        return kpToRows(data.kpReadings);
      case "solar":
        return solarToRows(data.solarWind);
      case "flares":
        return flaresToRows(data.flares);
    }
  }, [activeTab, data]);
  const feedItems = useMemo(() => toFeedItems(rows, activeTab), [rows, activeTab]);

  useEffect(() => {
    if (rows.length > 0 && selectedIdx >= rows.length) {
      setSelectedIdx(Math.max(0, rows.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, rows.length]);

  // Keyboard: tab switching (1/2/3) and refresh (r).
  useShortcut(
    (event) => {
      if (!focused || openItemId) return;
      if (event.targetEditable) return;
      if (isPlainKey(event, "1")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setActiveTab("kp");
        return;
      }
      if (isPlainKey(event, "2")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setActiveTab("solar");
        return;
      }
      if (isPlainKey(event, "3")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setActiveTab("flares");
        return;
      }
      if (isPlainKey(event, "r")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        load();
      }
    },
    { allowEditable: true, enabled: focused },
  );

  const loading = status === "loading" && rows.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    load,
    REFRESH_INTERVAL_MINUTES,
  );

  usePaneStatusLinkFooter({
    registrationId: SPACE_WEATHER_PLUGIN_ID,
    focused,
    url: error ? null : SWPC_URL,
    source: "NOAA SWPC",
    label: "website",
    loading,
    error,
    info: [
      { id: "live", parts: [{ text: "live", tone: "value" as const }] },
      ...(updatedAgo
        ? [
            {
              id: "updated",
              parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }],
            },
          ]
        : []),
    ],
    showOpenHint: !error,
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: load },
    ],
  });

  const handleRootKeyDown = useCallback(
    (event: {
      name?: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }) => {
      if (event.name === "1") {
        event.preventDefault?.();
        event.stopPropagation?.();
        setActiveTab("kp");
        return true;
      }
      if (event.name === "2") {
        event.preventDefault?.();
        event.stopPropagation?.();
        setActiveTab("solar");
        return true;
      }
      if (event.name === "3") {
        event.preventDefault?.();
        event.stopPropagation?.();
        setActiveTab("flares");
        return true;
      }
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        load();
        return true;
      }
      return false;
    },
    [load, setActiveTab],
  );

  // Compute current value summaries once for the header.
  const kpDisplay = activeTab === "kp" ? currentKpDisplay(data.kpReadings) : null;
  const bzDisplay = activeTab === "solar" ? currentBzDisplay(data.solarWind) : null;
  const flareDisplay = activeTab === "flares" ? latestFlareDisplay(data.flares) : null;

  // Tab bar + current value display, rendered above the data table.
  const rootBefore = (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" width={width}>
        {TABS.map((tab, index) => {
          const isActive = tab.id === activeTab;
          return (
            <Box key={tab.id} flexDirection="row">
              {index > 0 ? <Text fg={colors.textMuted}>  </Text> : null}
              <Text
                fg={isActive ? colors.textBright : colors.textMuted}
                onPress={() => setActiveTab(tab.id)}
              >
                {`[${tab.key}] ${tab.label}`}
              </Text>
            </Box>
          );
        })}
      </Box>
      {kpDisplay && (
        <Box flexDirection="row" width={width}>
          <Text fg={colors.textMuted}>Current Kp: </Text>
          <Text fg={kpDisplay.color}>{kpDisplay.text}</Text>
          <Text fg={colors.textMuted}>  </Text>
          <Text fg={kpDisplay.color}>{kpDisplay.status}</Text>
        </Box>
      )}
      {bzDisplay && (
        <Box flexDirection="row" width={width}>
          <Text fg={colors.textMuted}>Current Bz: </Text>
          <Text fg={bzDisplay.color}>{bzDisplay.text}</Text>
          <Text fg={colors.textMuted}>  </Text>
          <Text fg={bzDisplay.color}>{bzDisplay.status}</Text>
        </Box>
      )}
      {flareDisplay && (
        <Box flexDirection="row" width={width}>
          <Text fg={colors.textMuted}>Latest flare: </Text>
          <Text fg={flareDisplay.color}>{flareDisplay.text}</Text>
        </Box>
      )}
    </Box>
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading space weather data..." />
        </Box>
      </Box>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <ErrorState kind="space weather" error={error} />
      </Box>
    );
  }

  const tabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "Reading";

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      rootBefore={rootBefore}
      items={feedItems}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Type"
      titleLabel={tabLabel}
      markdown
      emptyStateTitle="No space weather data available."
    />
  );
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

let disposeConnection: (() => void) | null = null;

export const spaceWeatherPlugin: GloomPlugin = {
  id: SPACE_WEATHER_PLUGIN_ID,
  name: "Space Weather",
  version: "1.0.0",
  description:
    "Real-time space weather from NOAA SWPC. K-index, solar wind, and X-ray flare data.",
  toggleable: true,

  panes: [
    {
      id: "space-weather",
      name: "Space Weather",
      icon: "S",
      component: SpaceWeatherPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "space-weather-pane",
      paneId: "space-weather",
      label: "Space Weather",
      description:
        "Real-time space weather from NOAA SWPC. K-index, solar wind, and X-ray flare data.",
      keywords: [
        "noaa",
        "swpc",
        "space",
        "weather",
        "solar",
        "flare",
        "kp",
        "geomagnetic",
        "storm",
        "x-ray",
        "wind",
      ],
      category: "Data",
      shortcut: {
        prefix: "SWX",
        argPlaceholder: "",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, _options?: PaneTemplateCreateOptions) {
        return {
          instanceId: "space-weather:latest",
          title: "Space Weather",
          placement: "floating" as const,
          binding: { kind: "none" as const },
          settings: {},
        };
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: SPACE_WEATHER_CONNECTION_ID,
      name: "NOAA SWPC",
      kind: "api",
      pluginId: SPACE_WEATHER_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default spaceWeatherPlugin;
